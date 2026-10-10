import { ownerBuildStatus } from './owner-confirmation.mjs';
import { pinPhotos } from './presentation.mjs';
import { readFile, realpath, stat } from 'node:fs/promises';
import { resolve, dirname, sep } from 'node:path';
import { createHash } from 'node:crypto';
import { csvRecords, isCatalogActive } from '../../supabase/functions/_shared/product-rules.mjs';
import { readPointer, snapshotAcceptance } from './snapshot-acceptance.mjs';
// Active accepted snapshot (catalog-snapshots/active.json, or LE_CATALOG_ACTIVE_POINTER). Legacy 2026-10-01 derived snapshot is kept for history only.
export const legacyManifest = resolve(import.meta.dirname, '../catalog-snapshots/2026-10-01-derived-build/manifest.json');
export const activePointer = readPointer();
export const defaultManifest = activePointer.manifestPath;
export async function readManifest(path = previewInput?.manifestPath || defaultManifest) {
  const manifest = JSON.parse(await readFile(path, 'utf8'));
  if (manifest.schemaVersion !== 1 || !manifest.id || !manifest.snapshotDate || !manifest.feeds) throw new Error('Invalid offline catalog manifest');
  return { ...manifest, manifestPath: resolve(path) };
}
export async function readFeedText(name, manifestPath = defaultManifest) {
  const manifest = await readManifest(manifestPath);
  const entry = manifest.feeds[name];
  if (!entry?.path) throw new Error(`Offline ${name} feed unavailable: ${entry?.reason || 'not in manifest'}`);
  const root = dirname(manifest.manifestPath);
  const file = resolve(root, entry.path);
  if (!file.startsWith(root + sep)) throw new Error('Catalog feed path escapes snapshot');
  const csv = await readFile(await contained(root, entry.path), 'utf8');
  if (createHash('sha256').update(csv).digest('hex') !== entry.sha256) throw new Error(`Offline ${name} snapshot checksum mismatch`);
  if (csvRecords(csv).length !== entry.records) throw new Error(`Offline ${name} snapshot record count mismatch`);
  return csv;
}
let previewInput = null;
export async function loadFeed(name, manifestPath = previewInput?.manifestPath || defaultManifest) {
  const rows = csvRecords(await readFeedText(name, manifestPath));
  if (!previewInput?.mapping || manifestPath !== previewInput.manifestPath) return rows;
  // Candidate preview: photos are served from verified local copies (copied by build.mjs), never hotlinked.
  // Order/placeholder filtering follows catalogPhotos on the raw URLs, then each URL is replaced by its pinned path.
  return rows.map(row => row.photos === undefined ? row : {
    ...row,
    photos: pinPhotos(row.photos, url => previewInput.mapping.get(url)?.url),
  });
}
export async function pinnedPreviewMedia() {
  return previewInput?.mapping ? [...new Map([...previewInput.mapping.values()].map(entry => [entry.url, entry.file])).entries()] : [];
}
export function setPreviewInput(input) { previewInput = input; }
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
async function contained(root, path) {
  const absolute = resolve(root, path);
  const realRoot = await realpath(root), realFile = await realpath(absolute);
  if (!absolute.startsWith(resolve(root) + sep) || !realFile.startsWith(realRoot + sep) || !(await stat(realFile)).isFile())
    throw new Error(`Preview path escapes root: ${path}`);
  return realFile;
}
export async function validatePreviewInput(manifestPath, mediaPath, repoRoot = resolve(import.meta.dirname, '../..')) {
  await contained(repoRoot, resolve(manifestPath));
  await contained(repoRoot, resolve(mediaPath));
  const { validateCSV } = await import('../catalog-import/import.mjs');
  const manifest = await readManifest(manifestPath);
  if (manifest.productionReady !== false || manifest.source?.kind !== 'public-read-only-catalog-export') throw new Error('Unaccepted candidate is preview only');
  const mediaBytes = await readFile(mediaPath);
  const media = JSON.parse(mediaBytes);
  if (media.schemaVersion !== 1 || media.productionReady !== false || media.failures?.length || !media.assets?.length || !media.references?.length) throw new Error('Invalid preview media manifest');
  const candidateRoot = dirname(manifest.manifestPath);
  const hasConfirmation = Object.hasOwn(manifest, 'ownerConfirmation') || manifest.ownerAccepted === true || manifest.freshness === 'current-fetch-owner-confirmed';
  const provenanceBytes = hasConfirmation ? await readFile(await contained(candidateRoot, 'provenance.json')) : null;
  const ownerStatus = ownerBuildStatus(manifest, provenanceBytes ? JSON.parse(provenanceBytes) : undefined);
  for (const [path, checksum] of Object.entries(media.candidateFiles || {})) {
    if (sha256(await readFile(await contained(candidateRoot, path))) !== checksum) throw new Error(`Candidate provenance checksum mismatch: ${path}`);
  }
  for (const path of ['manifest.json', 'review.json', ...Object.values(manifest.feeds).map(entry => entry.path)])
    if (!media.candidateFiles?.[path]) throw new Error(`Missing candidate provenance: ${path}`);
  if (sha256(await readFile(manifest.manifestPath)) !== media.candidateFiles['manifest.json']) throw new Error('Input manifest provenance checksum mismatch');
  if (media.candidateReviewSha256 !== media.candidateFiles['review.json']) throw new Error('Review provenance mismatch');
  const mapping = new Map();
  for (const asset of media.assets) {
    if (mapping.has(asset.rawURL) || !asset.provenance || !/^[a-f0-9]{64}$/.test(asset.sha256)) throw new Error('Invalid media provenance or duplicate mapping');
    const file = await contained(repoRoot, asset.localPath);
    const bytes = await readFile(file);
    if (bytes.length !== asset.bytes || sha256(bytes) !== asset.sha256) throw new Error(`Media checksum mismatch: ${asset.rawURL}`);
    const extension = { 'image/webp': '.webp', 'image/jpeg': '.jpg', 'image/png': '.png' }[asset.contentType];
    if (!extension) throw new Error('Unsupported preview media MIME');
    mapping.set(asset.rawURL, { file, url: `/media/catalog-pinned/${asset.sha256}${extension}` });
  }
  const expected = [];
  for (const name of ['trees', 'decor']) {
    for (const row of validateCSV(name, await readFeedText(name, manifest.manifestPath))) {
      const variantId = name === 'trees' ? `${row.id}:${row.category}:${row.height_cm}` : `${row.id}:${row.category || ''}:${row.variants === '-' ? '' : row.variants || ''}`;
      String(row.photos || '').split('|').map(url => url.trim()).filter(Boolean).forEach((url, index) => {
        if (!mapping.has(url) && isCatalogActive(row.active)) throw new Error(`Missing preview media mapping: ${url}`);
        expected.push({ feed: name, productId: row.id, variantId, active: isCatalogActive(row.active), index, url });
      });
    }
  }
  if (expected.length !== media.references.length || expected.some((ref, i) => Object.entries(ref).some(([key, value]) => media.references[i][key] !== value) || media.references[i].localPath !== (media.assets.find(asset => asset.rawURL === ref.url)?.localPath ?? null))) throw new Error('Media references differ from exact raw CSV order');
  validateCSV('promos', await readFeedText('promos', manifest.manifestPath));
  return { manifestPath: manifest.manifestPath, mediaPath: resolve(mediaPath), mediaSha256: sha256(mediaBytes), manifest, mapping, references: expected.length, ownerStatus, ownerProvenancePath: provenanceBytes ? resolve(candidateRoot, 'provenance.json') : null, ownerProvenanceBytes: provenanceBytes?.length ?? null, ownerProvenanceSha256: provenanceBytes ? sha256(provenanceBytes) : null };
}
// Default (non-candidate) builds: the active snapshot with its pinned local media, accepted by owner or by automated guards.
export async function validateActiveSnapshot(pointer = activePointer) {
  const input = await validatePreviewInput(pointer.manifestPath, pointer.mediaPath);
  const root = dirname(input.manifest.manifestPath);
  const optional = async name => { try { return await readFile(await contained(root, name)); } catch (error) { if (error.code === 'ENOENT') return null; throw error; } };
  const provenanceBytes = await optional('provenance.json'), guardsBytes = await optional('guards.json');
  const acceptance = snapshotAcceptance(input.manifest, provenanceBytes ? JSON.parse(provenanceBytes) : undefined, guardsBytes);
  if (!acceptance.accepted) throw new Error(`Active catalog snapshot ${pointer.id} is not accepted: ${acceptance.notice}`);
  if (input.manifest.id !== pointer.id) throw new Error('Active pointer id differs from snapshot manifest id');
  return { ...input, active: true, pointer, acceptance, ownerStatus: { ...input.ownerStatus, ownerAccepted: acceptance.kind === 'owner-confirmation', notice: acceptance.notice } };
}
