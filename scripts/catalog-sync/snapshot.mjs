// Accepted catalog snapshots: storefront/catalog-snapshots/<id>/ {trees,decor,promos}.csv, review.json, manifest.json,
// provenance.json, media-manifest.json, [guards.json], [auto-routes.json]; the active one is named by active.json.
import { readFile, writeFile, mkdir, rename, rm, stat } from 'node:fs/promises';
import { join, relative, resolve, dirname } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { STANDING_POLICY, snapshotsRoot, repoRoot } from '../../storefront/products/snapshot-acceptance.mjs';

const names = ['trees', 'decor', 'promos'];
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
export const feedsDigest = feeds => sha256(names.map(name => feeds[name].sha256).join('\n'));

// candidateDir: output of catalog-import accept() (CSV + manifest + review.json, all validated there).
// acceptance: {kind:'owner', confirmation} | {kind:'auto', guards (checkCatalog result), checkedAt}
export async function writeSnapshot({ id, candidateDir, acceptance, media, autoRoutes = null }) {
  if (!/^[0-9A-Za-z][0-9A-Za-z._-]{2,100}$/.test(id)) throw new Error('Invalid snapshot id');
  const target = join(snapshotsRoot, id);
  try { await stat(target); throw new Error(`Refusing to overwrite snapshot ${id}`); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (media.failures.length) throw new Error('Snapshot media has failures');
  const candidate = JSON.parse(await readFile(join(candidateDir, 'manifest.json'), 'utf8'));
  const files = {};
  for (const name of names) files[`${name}.csv`] = await readFile(join(candidateDir, candidate.feeds[name].path));
  files['review.json'] = await readFile(join(candidateDir, 'review.json'));
  const feeds = Object.fromEntries(names.map(name => [name, { ...candidate.feeds[name], path: `${name}.csv` }]));
  for (const name of names) if (sha256(files[`${name}.csv`]) !== feeds[name].sha256) throw new Error(`Candidate checksum mismatch ${name}`);
  const provenanceFeeds = Object.fromEntries(names.map(name => [name, { source: feeds[name].source, receivedAt: feeds[name].receivedAt, sha256: feeds[name].sha256, bytes: files[`${name}.csv`].length }]));
  const base = { schemaVersion: 1, id, snapshotDate: feeds.trees.receivedAt.slice(0, 10), artifactGeneratedAt: new Date().toISOString(), dataAsOf: null,
    productionReady: false, source: { kind: 'public-read-only-catalog-export' }, assetCoverage: 'pinned-local-media', feeds, candidate: relative(repoRoot, candidateDir),
    limitations: ['Three separate public GETs do not prove a single merchant revision or atomic snapshot', 'Fetch timestamps are not historical effective dates of prices'] };
  let manifest, provenance;
  if (acceptance.kind === 'owner') {
    manifest = { ...base, freshness: 'current-fetch-owner-confirmed', ownerAccepted: true, ownerConfirmation: acceptance.confirmation };
    provenance = { confirmation: acceptance.confirmation, feeds: provenanceFeeds };
  } else if (acceptance.kind === 'auto') {
    files['guards.json'] = Buffer.from(JSON.stringify(acceptance.guards, null, 2) + '\n');
    const auto = { kind: 'standing-owner-policy+automated-guards', policy: STANDING_POLICY,
      guards: { passed: acceptance.guards.passed, reportSha256: sha256(files['guards.json']), checkedAt: acceptance.checkedAt } };
    manifest = { ...base, freshness: 'current-fetch-auto-accepted', acceptance: auto };
    provenance = { acceptance: auto, feeds: provenanceFeeds };
  } else throw new Error('Unknown acceptance kind');
  files['manifest.json'] = Buffer.from(JSON.stringify(manifest, null, 2) + '\n');
  files['provenance.json'] = Buffer.from(JSON.stringify(provenance, null, 2) + '\n');
  if (autoRoutes) files['auto-routes.json'] = Buffer.from(JSON.stringify(autoRoutes, null, 2) + '\n');
  const candidateFiles = Object.fromEntries(['manifest.json', 'review.json', ...names.map(name => `${name}.csv`)].map(file => [file, sha256(files[file])]));
  const mediaManifest = { schemaVersion: 1, productionReady: false, ownerGalleryOrderConfirmed: false, order: 'unchanged feed CSV order; index is zero-based',
    candidate: relative(repoRoot, target), candidateReviewSha256: candidateFiles['review.json'], candidateFiles,
    limits: { maxBytesPerFile: 8 * 1024 * 1024, timeoutSeconds: 20, redirects: 'blocked' }, assets: media.assets, references: media.references, failures: [], summary: media.summary };
  files['media-manifest.json'] = Buffer.from(JSON.stringify(mediaManifest, null, 2) + '\n');
  await mkdir(snapshotsRoot, { recursive: true });
  const temp = join(snapshotsRoot, `.pending-${randomUUID()}`);
  await mkdir(temp);
  try {
    for (const [file, bytes] of Object.entries(files)) await writeFile(join(temp, file), bytes, { flag: 'wx' });
    await rename(temp, target);
  } finally { await rm(temp, { recursive: true, force: true }); } // our own pending dir only (already renamed on success)
  return { dir: target, manifest, feedsSha256: feedsDigest(feeds) };
}

export function pointerFor(snapshot, extra = {}) {
  return { schemaVersion: 1, id: snapshot.manifest.id, manifest: relative(repoRoot, join(snapshot.dir, 'manifest.json')),
    media: relative(repoRoot, join(snapshot.dir, 'media-manifest.json')), feedsSha256: snapshot.feedsSha256, ...extra };
}

export async function writePointer(path, pointer) {
  await mkdir(dirname(path), { recursive: true });
  const temp = `${path}.${randomUUID()}.tmp`;
  await writeFile(temp, JSON.stringify(pointer, null, 2) + '\n', { flag: 'wx' });
  await rename(temp, path); // atomic switch
}

export async function readFeedsOf(manifestPath) {
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8')), root = dirname(resolve(manifestPath));
  const feeds = {};
  for (const name of names) feeds[name] = await readFile(join(root, manifest.feeds[name].path), 'utf8');
  return { manifest, feeds };
}
