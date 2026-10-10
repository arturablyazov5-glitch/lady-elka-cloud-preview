// Pin every photo referenced by a snapshot to a verified local file (no hotlinks in the built site).
// Order of resolution: earlier verified pins (any media manifest in the repo) → saved local copy in storefront/public
// (old lady-elka.ru / sale-elka.ru URLs) → download from the allowlisted public Supabase bucket into the content-addressed
// store storefront/catalog-media/store/<sha256>.<ext>. Nothing is overwritten or deleted.
import { readFile, writeFile, mkdir, readdir, rename, rm } from 'node:fs/promises';
import { resolve, join, relative, dirname } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { validateCSV } from '../../storefront/catalog-import/import.mjs';
import { localAsset } from '../../storefront/products/presentation.mjs';
import { isCatalogActive } from '../../supabase/functions/_shared/product-rules.mjs';

export const ROOT = resolve(import.meta.dirname, '../..');
export const STORE = resolve(ROOT, 'storefront/catalog-media/store');
const PREFIX = 'https://mgnotvaahftrbifqtahf.supabase.co/storage/v1/object/public/le-catalog-images/';
const ALLOWED = new RegExp('^' + PREFIX.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&') + '(?:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[0-9a-f]{32,64})\\.webp$');
const MAX_BYTES = 8 * 1024 * 1024;
const MIME = { '.webp': 'image/webp', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png' };
const EXT = { 'image/webp': '.webp', 'image/jpeg': '.jpg', 'image/png': '.png' };
export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

export function webpSize(b) {
  if (b.length < 30 || b.toString('latin1', 0, 4) !== 'RIFF' || b.toString('latin1', 8, 12) !== 'WEBP' || b.readUInt32LE(4) + 8 !== b.length) throw new Error('Truncated/invalid WebP');
  const chunk = b.toString('latin1', 12, 16);
  if (chunk === 'VP8X') return [1 + b.readUIntLE(24, 3), 1 + b.readUIntLE(27, 3)];
  if (chunk === 'VP8L') { const v = b.readUInt32LE(21); return [1 + (v & 0x3fff), 1 + ((v >> 14) & 0x3fff)]; }
  if (chunk === 'VP8 ') return [b.readUInt16LE(26) & 0x3fff, b.readUInt16LE(28) & 0x3fff];
  throw new Error('Unknown WebP chunk');
}

// References in exact raw CSV order (same formula as storefront/products/build-feed.mjs validatePreviewInput).
export function mediaReferences(feeds) {
  const references = [];
  for (const name of ['trees', 'decor']) {
    for (const row of validateCSV(name, feeds[name])) {
      const variantId = name === 'trees' ? `${row.id}:${row.category}:${row.height_cm}` : `${row.id}:${row.category || ''}:${row.variants === '-' ? '' : row.variants || ''}`;
      String(row.photos || '').split('|').map(url => url.trim()).filter(Boolean).forEach((url, index) =>
        references.push({ feed: name, productId: row.id, variantId, active: isCatalogActive(row.active), index, url }));
    }
  }
  return references;
}

async function manifestFiles() {
  const files = [join(STORE, '..', 'remote-cache.json')];
  const scan = async (dir, name) => { try { for (const entry of await readdir(dir, { withFileTypes: true })) if (entry.isDirectory()) files.push(join(dir, entry.name, name)); } catch (error) { if (error.code !== 'ENOENT') throw error; } };
  await scan(resolve(ROOT, 'storefront/catalog-snapshots'), 'media-manifest.json');
  await scan(resolve(ROOT, 'storefront/catalog-media'), 'manifest.json');
  await scan(resolve(ROOT, 'storefront/catalog-import/candidates'), 'media-manifest.json');
  return files;
}

export async function previousAssets(extraManifests = []) {
  const found = new Map();
  for (const file of [...extraManifests, ...await manifestFiles()]) {
    let manifest; try { manifest = JSON.parse(await readFile(file, 'utf8')); } catch { continue; }
    for (const asset of manifest.assets || []) if (asset.sha256 && asset.localPath && !found.has(asset.rawURL)) found.set(asset.rawURL, { ...asset, from: relative(ROOT, file) });
  }
  return found;
}

async function download(url, fetchImpl, prior) {
  const response = await fetchImpl(url, { method: 'GET', redirect: 'error', signal: AbortSignal.timeout(20000), headers: { Accept: 'image/webp', ...(prior?.etag ? {'If-None-Match':prior.etag} : prior?.lastModified ? {'If-Modified-Since':prior.lastModified} : {}), 'Cache-Control': 'no-cache', 'User-Agent': 'LadyElka-catalog-sync/1' } });
  if (response.status === 304 && prior) return {...prior,status:'reused',provenance:'sha256/size verified; HTTP 304'};
  if (response.status !== 200) throw Object.assign(new Error(`HTTP ${response.status}`), {transient:response.status===429 || response.status>=500});
  const mime = (response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
  if (mime !== 'image/webp') throw new Error(`Unexpected MIME ${mime}`);
  const reader = response.body.getReader(), chunks = []; let length = 0;
  try { for (;;) { const {done,value} = await reader.read(); if (done) break; length += value.length; if (length > MAX_BYTES) throw new Error('Maximum size exceeded'); chunks.push(Buffer.from(value)); } } finally { await reader.cancel(); }
  const bytes = Buffer.concat(chunks);
  if (bytes.length > MAX_BYTES) throw new Error('Maximum size exceeded');
  const [width, height] = webpSize(bytes);
  const digest = sha256(bytes), path = join(STORE, `${digest}.webp`);
  await mkdir(STORE, { recursive: true });
  const temp = join(STORE, `.tmp-${randomUUID()}`);
  await writeFile(temp, bytes, { flag: 'wx' });
  try {
    try { const existing = await readFile(path); if (sha256(existing) !== digest) throw new Error(`Store file corrupted: ${path}`); }
    catch (error) { if (error.code !== 'ENOENT') throw error; await rename(temp, path); }
  } finally { await rm(temp, { force: true }); } // temp is our own partial file only
  return { status: 'downloaded', localPath: relative(ROOT, path), sha256: digest, bytes: bytes.length, contentType: 'image/webp', width, height,
    receivedAt: new Date().toISOString(), httpStatus: 200, etag: response.headers.get('etag'), lastModified: response.headers.get('last-modified'),
    provenance: 'exact feed URL; public Supabase Storage GET; no credentials; redirects blocked; content-addressed store' };
}

export async function pinMedia(feeds, { fetchImpl = fetch, extraManifests = [], refreshRemote = true, retryDelay = 100, persistCache = fetchImpl === fetch, cachePath = resolve(STORE,'../remote-cache.json'), log = () => {} } = {}) {
  const references = mediaReferences(feeds);
  const urls = [...new Set(references.map(ref => ref.url))];
  const previous = await previousAssets([...extraManifests,cachePath]);
  const assets = [], failures = [];
  for (let offset = 0; offset < urls.length; offset += 4) await Promise.all(urls.slice(offset, offset + 4).map(async url => {
    try {
      let prior = previous.get(url);
      if (prior) {
        try { const bytes=await readFile(join(ROOT,prior.localPath)); if(bytes.length!==prior.bytes || sha256(bytes)!==prior.sha256) prior=null; } catch { prior=null; }
      }
      const active = references.some(ref=>ref.url===url && ref.active);
      if (!active && !prior) return;
      if (prior && (!active || !(refreshRemote && ALLOWED.test(url)))) {
        const bytes = await readFile(join(ROOT, prior.localPath));
        if (bytes.length !== prior.bytes || sha256(bytes) !== prior.sha256) throw new Error(`Pinned file changed: ${prior.localPath}`);
        const { from, ...rest } = prior;
        assets.push({ ...rest, status: prior.status === 'existing' ? 'existing' : 'reused', provenance: `reused from ${from} after sha256/size verification; no GET` });
        return;
      }
      const mapped = localAsset(url);
      if (mapped.startsWith('/') && !mapped.startsWith('//')) {
        const publicRoot = resolve(ROOT, 'storefront/public'), file = resolve(publicRoot, decodeURIComponent(mapped).replace(/^\//, ''));
        if (!file.startsWith(publicRoot + '/')) throw new Error('Asset traversal');
        const bytes = await readFile(file), contentType = MIME[file.slice(file.lastIndexOf('.')).toLowerCase()];
        if (!contentType) throw new Error('Unsupported local media type');
        assets.push({ rawURL: url, status: 'existing', localPath: relative(ROOT, file), sha256: sha256(bytes), bytes: bytes.length, contentType, receivedAt: null, provenance: 'existing local file, no GET' });
        return;
      }
      if (!ALLOWED.test(url)) throw new Error('Source not allowlisted (only public Supabase le-catalog-images/<uuid-or-hex>.webp)');
      log(`download ${url}`);
      let downloaded, lastError;
      for(let attempt=0;attempt<3;attempt++) {
        try { downloaded=await download(url,fetchImpl,prior); break; } catch(error) { lastError=error; const transient=error.transient ?? !/^HTTP |MIME|WebP|Maximum|Truncated|Unknown|Unexpected/.test(error.message); if(!transient) throw error; if(attempt<2) await new Promise(r=>setTimeout(r,retryDelay*(attempt+1))); }
      }
      if(!downloaded) { if(!prior) throw lastError; downloaded={...prior,status:'reused',provenance:'verified sha256/size fallback after transient transport failure'}; }
      assets.push({ rawURL: url, ...downloaded });
    } catch (error) { failures.push({ rawURL: url, status: 'failed', error: error.message }); }
  }));
  assets.sort((a,b) => urls.indexOf(a.rawURL) - urls.indexOf(b.rawURL));
  for (const asset of assets) if (!EXT[asset.contentType]) failures.push({ rawURL: asset.rawURL, status: 'failed', error: `Unsupported MIME ${asset.contentType}` });
  // Persist validators even on unchanged runs, so cron never repeats an unconditional body GET.
  if(persistCache && assets.length) {
    const cached=new Map(previous); for(const a of assets)cached.set(a.rawURL,a);
    await mkdir(dirname(cachePath),{recursive:true}); const tmp=join(dirname(cachePath),`.cache-${randomUUID()}`);
    try {await writeFile(tmp,JSON.stringify({assets:[...cached.values()]}));await rename(tmp,cachePath);}finally{await rm(tmp,{force:true});}
  }
  const byURL = new Map(assets.map(asset => [asset.rawURL, asset]));
  return {
    assets, failures,
    references: references.map(ref => ({ ...ref, localPath: byURL.get(ref.url)?.localPath ?? null, mediaStatus: byURL.get(ref.url)?.status ?? (ref.active ? 'failed' : 'skipped-inactive') })),
    summary: { totalUnique: urls.length, references: references.length, downloaded: assets.filter(a => a.status === 'downloaded').length,
      reused: assets.filter(a => a.status === 'reused').length, existing: assets.filter(a => a.status === 'existing').length, failed: failures.length,
      downloadBytes: assets.filter(a => a.status === 'downloaded').reduce((sum, a) => sum + a.bytes, 0) },
  };
}
