import { snapshotAcceptance } from './products/snapshot-acceptance.mjs';
import { ownerBuildStatus } from './products/owner-confirmation.mjs';
import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { readFile, stat, realpath } from 'node:fs/promises';
import { resolve, extname, sep, join } from 'node:path';

import { createHash } from 'node:crypto';
import { csvRecords } from '../supabase/functions/_shared/product-rules.mjs';
import { readFeedText } from './products/build-feed.mjs';
import { configScript } from './config/runtime.mjs';
if (!process.argv.includes('--mode=preview')) throw new Error('Explicit --mode=preview required; capture and upstream fallback are disabled');
const artifact = process.argv.find(arg => arg.startsWith('--artifact='))?.slice(11) || 'preview';
if (!['preview', 'production'].includes(artifact)) throw new Error('Unknown artifact');
const args = process.argv.slice(2);
const roots = args.filter(arg => arg === '--root' || arg.startsWith('--root='));
if (roots.length > 1) throw new Error('Only one --root allowed');
const rootArg = roots[0] === '--root' ? args[args.indexOf('--root') + 1] : roots[0]?.slice(7);
if (roots.length && (!rootArg || rootArg.startsWith('--'))) throw new Error('--root requires an artifact directory');
if (roots.length && args.some(arg => arg.startsWith('--artifact='))) throw new Error('--root and --artifact cannot be combined');
const root = await realpath(resolve(rootArg || resolve(import.meta.dirname, artifact === 'production' ? 'production/dist' : 'dist')));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
async function containedFile(base, relative) {
  const file = resolve(base, relative);
  if (!file.startsWith(base + sep)) throw new Error('Path escapes artifact root');
  const actual = await realpath(file);
  if (!actual.startsWith(base + sep) || !(await stat(actual)).isFile()) throw new Error('Path escapes artifact root or is not a file');
  return actual;
}
let bundledFeeds = null;
const bundledAssets = new Map();
let manifestSha256;
const artifactManifestBytes = await readFile(await containedFile(root, 'build-manifest.json'));
const artifactManifest = JSON.parse(artifactManifestBytes);
if (rootArg || artifactManifest.bundled) {
  const manifestBytes = artifactManifestBytes;
  manifestSha256 = hash(manifestBytes);
  const manifest = JSON.parse(manifestBytes);
  if (!['preview','production'].includes(manifest.mode) || manifest.offlineBuild !== true || manifest.productionReady !== false
      || !/^[a-zA-Z0-9._-]+$/.test(manifest.snapshot?.id || '')) throw new Error('Invalid offline build manifest');
  if (manifest.activeSnapshot) {
    const active = manifest.activeSnapshot;
    const status = snapshotAcceptance(active.manifest, active.provenance, active.guardsText ? Buffer.from(active.guardsText) : null);
    if (!status.accepted || active.pointer !== manifest.snapshot.id || active.manifest.id !== active.pointer
        || status.notice !== manifest.catalogNotice || manifest.candidatePreview) throw new Error('Invalid active snapshot proof');
  } else {
    if (manifest.mode !== 'preview' || manifest.endpoints?.mode !== 'preview' || manifest.endpoints.payment !== null
        || ![false,true].includes(manifest.candidatePreview?.ownerAccepted)) throw new Error('Invalid candidate preview build manifest');
  const candidateStatus = manifest.candidatePreview;
  if (candidateStatus.ownerAccepted) {
    const entry = candidateStatus.ownerProvenance;
    if (entry?.path !== '__offline/catalog/owner-provenance.json' || !Number.isSafeInteger(entry.bytes) || entry.bytes < 1 || !/^[a-f0-9]{64}$/.test(entry.sha256 || '') || entry.sha256 !== candidateStatus.ownerProvenanceSha256)
      throw new Error('Invalid owner confirmation provenance');
    const bytes = await readFile(await containedFile(root, entry.path));
    if (bytes.length !== entry.bytes || hash(bytes) !== entry.sha256) throw new Error('Owner confirmation provenance checksum mismatch');
    const status = ownerBuildStatus({ ...manifest.snapshot, ownerAccepted: true, ownerConfirmation: candidateStatus.ownerConfirmation, productionReady: manifest.productionReady }, JSON.parse(bytes));
    if (status.notice !== manifest.catalogNotice || status.notice !== candidateStatus.notice) throw new Error('Owner confirmation notice mismatch');
  } else if (candidateStatus.ownerConfirmation !== undefined || candidateStatus.ownerProvenance || manifest.snapshot.freshness === 'current-fetch-owner-confirmed') {
    throw new Error('Invalid unaccepted owner confirmation');
  }
  }
  bundledFeeds = new Map();
  const proof = manifest.bundled;
  if (!proof || !Array.isArray(proof.assets) || proof.assets.length !== proof.assetCount
      || hash(JSON.stringify(proof.assets)) !== proof.assetInventorySha256
      || proof.assets.reduce((sum, asset) => sum + asset.bytes, 0) !== proof.assetBytes)
    throw new Error('Invalid bundled asset inventory');
  const paths = new Set();
  async function verify(entry) {
    if (!entry || typeof entry.path !== 'string' || !/^[a-f0-9]{64}$/.test(entry.sha256)
        || !Number.isSafeInteger(entry.bytes) || entry.bytes < 0 || paths.has(entry.path))
      throw new Error('Invalid bundled file manifest');
    paths.add(entry.path);
    const bytes = await readFile(await containedFile(root, entry.path));
    if (bytes.length !== entry.bytes || hash(bytes) !== entry.sha256) throw new Error(`${entry.path} checksum mismatch`);
    return bytes;
  }
  for (const name of ['trees', 'decor', 'promos']) {
    const relative = `__offline/catalog/${name}.csv`, entry = proof.feeds?.[name];
    if (entry?.path !== relative || manifest.endpoints.catalog?.[name] !== '/' + relative)
      throw new Error(`Invalid ${name} feed manifest/path`);
    const bytes = await verify(entry);
    const rows = csvRecords(bytes.toString('utf8'));
    if (rows.length !== entry.records) throw new Error(`${name} record count mismatch`);
    bundledFeeds.set(name, { relative, sha256: entry.sha256 });
    for (const row of rows) for (const photo of String(row.photos || '').split('|').filter(Boolean)) {
      if (!proof.assets.some(asset => '/' + asset.path === photo)) throw new Error('Missing bundled image inventory');
    }
  }
  for (const entry of proof.assets) {
    await verify(entry);
    bundledAssets.set(entry.path, entry);
  }

}
const port = Number(process.env.STOREFRONT_PORT || 4174);
const redirects = new Map(Object.entries(JSON.parse(await readFile(new URL('./config/redirects.json', import.meta.url), 'utf8'))));
const mime = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.ico': 'image/x-icon',
  '.xml': 'application/xml; charset=utf-8', '.txt': 'text/plain; charset=utf-8',
  '.mp4': 'video/mp4',
};

const server = createServer(async (req, res) => {
  if (process.argv.includes('--qa-request-log') && process.send) {
    const started = Date.now();
    res.on('finish', () => process.send?.({ type: 'qa-request', url: req.url, method: req.method, range: req.headers.range || null, status: res.statusCode, started }));
  }
  try {
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https://trace-logos.ru https://mgnotvaahftrbifqtahf.supabase.co https://lady-elka.ru https://sale-elka.ru; font-src 'self' data:; media-src 'self' blob:; connect-src 'self' https://mgnotvaahftrbifqtahf.supabase.co; form-action 'self'; frame-src 'none'; worker-src 'self'; object-src 'none'; base-uri 'self'");
    res.setHeader('Cache-Control', process.argv.includes('--cache=production')
      ? (/^\/(?:assets\/[0-9a-f]{64}\.|media\/catalog-pinned\/[0-9a-f]{64}\.)/.test(req.url.split('?')[0])
        ? 'public, max-age=31536000, immutable'
        : /\.(?:webp|avif|jpe?g|png|gif|svg|ico|mp4|webm|woff2?)(?:\?|$)/i.test(req.url) ? 'public, max-age=2592000' : 'no-cache')
      : process.argv.includes('--cache=revalidate') ? 'no-cache' : 'no-store');
    if (req.url.split('?')[0] === '/sw.js') res.setHeader('Cache-Control', 'no-cache');
    if (!['GET', 'HEAD'].includes(req.method)) { res.writeHead(405, { Allow: 'GET, HEAD' }); return res.end('Orders disabled in offline preview'); }
    if (decodeURIComponent(req.url.split('?')[0]).split(/[\\/]/).some(part => part === '..' || part === '.') || req.url.startsWith('//')) { res.writeHead(403); return res.end(); }
    if (manifestSha256) {
      try { if (hash(await readFile(await containedFile(root, 'build-manifest.json'))) !== manifestSha256) throw new Error('Manifest checksum mismatch'); }
      catch { res.writeHead(503); return res.end(req.method === 'HEAD' ? undefined : 'Offline manifest missing or changed'); }
    }
    const url = new URL(req.url, `http://localhost:${port}`);
    const pathname = decodeURIComponent(url.pathname).replace(/\/+$/, '') || '/';
    // A candidate artifact (--root) serves its own config that points at its bundled /__offline feeds.
    if (pathname === '/f/storefront-config.js') { res.writeHead(200, { 'Content-Type': mime['.js'] }); const saved = JSON.parse((await readFile(join(root, 'build-manifest.json'), 'utf8'))).endpoints; return res.end(req.method === 'HEAD' ? undefined : `window.__LE_STOREFRONT_CONFIG__=${JSON.stringify({...saved, mode: 'preview', lead: null, payment: null})};\n`); }
    const feed = /^\/__offline\/catalog\/(trees|decor|promos)\.csv$/.exec(pathname);
    if (feed) {
      try { const pinned = bundledFeeds?.get(feed[1]); const csv = pinned ? await readFile(await containedFile(root, pinned.relative), 'utf8') : await readFeedText(feed[1]); if (pinned && hash(csv) !== pinned.sha256) throw new Error(`${feed[1]} bundled CSV checksum mismatch`); res.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8' }); return res.end(req.method === 'HEAD' ? undefined : csv); }
      catch (error) { res.writeHead(503, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end(req.method === 'HEAD' ? undefined : 'Offline feed unavailable: ' + (error.message.includes('checksum') ? 'checksum mismatch' : 'missing or invalid CSV')); }
    }
    if (redirects.has(pathname)) {
      res.writeHead(301, { Location: redirects.get(pathname) + url.search });
      return res.end();
    }
    const relative = pathname === '/' ? 'index.html' : pathname.slice(1);
    const candidates = mime[extname(relative)]
      ? [relative]
      : [`${relative}/index.html`, `${relative}.html`, relative];
    for (const candidate of pathname === '/404.html' ? [] : candidates) {
      let file = resolve(root, candidate);
      if (!file.startsWith(root + sep)) continue;
      try {
        file = await containedFile(root, candidate);
        const pinned = bundledAssets.get(candidate);
        if (pinned) { const bytes = await readFile(file); if (bytes.length !== pinned.bytes || hash(bytes) !== pinned.sha256) throw new Error('Asset checksum mismatch'); }
        const info = await stat(file);
        if (!info.isFile()) continue;
        // Opt-in Timeweb directory redirect; ordinary preview behavior stays unchanged.
        if (process.argv.includes('--emulate-host') && candidate.endsWith('/index.html') && url.pathname !== '/' && !url.pathname.endsWith('/')) {
          res.writeHead(308, { Location: url.pathname + '/' + url.search });
          return res.end();
        }
        if (extname(file) === '.mp4') {
          const headers = { 'Content-Type': mime['.mp4'], 'Accept-Ranges': 'bytes' };
          const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
          if (range) {
            const start = range[1] ? Number(range[1]) : 0;
            const end = range[2] ? Math.min(Number(range[2]), info.size - 1) : info.size - 1;
            if (start > end || start >= info.size) {
              res.writeHead(416, { ...headers, 'Content-Range': `bytes */${info.size}` });
              return res.end();
            }
            res.writeHead(206, { ...headers, 'Content-Range': `bytes ${start}-${end}/${info.size}`,
              'Content-Length': end - start + 1 });
            if (req.method === 'HEAD') return res.end();
            return createReadStream(file, { start, end }).pipe(res);
          }
          res.writeHead(200, { ...headers, 'Content-Length': info.size });
          if (req.method === 'HEAD') return res.end();
          return createReadStream(file).pipe(res);
        }
        let body = await readFile(file);
        res.writeHead(200, { 'Content-Type': mime[extname(file)] || 'application/octet-stream' });
        return res.end(req.method === 'HEAD' ? undefined : body);
      } catch (error) {
        if (error.code !== 'ENOENT' && error.code !== 'ENOTDIR') throw error;
      }
    }
    const body = await readFile(await containedFile(root, '404.html'));
    res.writeHead(404, { 'Content-Type': mime['.html'], 'X-Robots-Tag': 'noindex, nofollow' });
    res.end(req.method === 'HEAD' ? undefined : body);
  } catch (error) {
    res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end(req.method === 'HEAD' ? undefined : 'Preview request failed');
  }
}).listen(port, '127.0.0.1', () => console.log(`Lady Elka storefront: http://localhost:${server.address().port}/`));
