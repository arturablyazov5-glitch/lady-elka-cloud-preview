// Which offline catalog snapshot the storefront builds from, and why it may be published.
//
// active.json (storefront/catalog-snapshots/active.json) points at one accepted snapshot:
//   {schemaVersion: 1, id, manifest: "<repo-relative manifest.json>", media: "<repo-relative media-manifest.json>", ...}
// LE_CATALOG_ACTIVE_POINTER=<absolute path> overrides the pointer (catalog-sync builds a new snapshot before activating it).
//
// A snapshot is accepted either by an explicit owner confirmation (owner-confirmation.mjs, unchanged scheme) or by the
// owner's standing policy (2026-10-08): current Supabase data is published automatically once automated guards pass.
import { readFileSync } from 'node:fs';
import { resolve, sep } from 'node:path';
import { createHash } from 'node:crypto';
import { ownerBuildStatus } from './owner-confirmation.mjs';

export const repoRoot = resolve(import.meta.dirname, '../..');
export const snapshotsRoot = resolve(repoRoot, 'storefront/catalog-snapshots');
export const defaultPointerPath = resolve(snapshotsRoot, 'active.json');

export const STANDING_POLICY = Object.freeze({
  date: '2026-10-08',
  source: 'Explicit owner decision relayed in task 9 (catalog autosync), 2026-10-08',
  quote: 'на сайте ВСЕГДА должны быть актуальные цены, тексты, размеры, ветки (варианты), фото и любые другие данные каталога — снапшот не должен устаревать и не должен требовать ручного «owner confirmation» на каждое обновление',
  scope: ['prices', 'active', 'descriptions', 'media', 'promos'],
  authoritativeSource: 'Current public Supabase catalog exports',
});

const inRepo = path => { const absolute = resolve(repoRoot, path); if (!absolute.startsWith(repoRoot + sep)) throw new Error(`Snapshot path escapes repository: ${path}`); return absolute; };

export function pointerPath() { return process.env.LE_CATALOG_ACTIVE_POINTER ? resolve(process.env.LE_CATALOG_ACTIVE_POINTER) : defaultPointerPath; }

export function readPointer(path = pointerPath()) {
  const pointer = JSON.parse(readFileSync(path, 'utf8'));
  if (pointer.schemaVersion !== 1 || !/^[0-9A-Za-z][0-9A-Za-z._-]{2,100}$/.test(pointer.id || '') || !pointer.manifest || !pointer.media)
    throw new Error(`Invalid active catalog pointer: ${path}`);
  return { ...pointer, path, manifestPath: inRepo(pointer.manifest), mediaPath: inRepo(pointer.media) };
}

const sameJSON = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

// Returns {accepted, kind, notice}. Throws on malformed acceptance metadata (fail closed).
export function snapshotAcceptance(manifest, provenance, guardsBytes) {
  if (Object.hasOwn(manifest, 'ownerConfirmation') || manifest.ownerAccepted === true || manifest.freshness === 'current-fetch-owner-confirmed') {
    const status = ownerBuildStatus(manifest, provenance);
    return { accepted: status.ownerAccepted, kind: 'owner-confirmation', notice: status.notice };
  }
  const a = manifest.acceptance;
  if (!a) return { accepted: false, kind: null, notice: 'Каталог не принят: нет подтверждения владельца и автоматической приёмки.' };
  const invalid = reason => { throw new Error(`Invalid automatic catalog acceptance: ${reason}`); };
  if (a.kind !== 'standing-owner-policy+automated-guards') invalid('kind');
  if (!sameJSON(a.policy, STANDING_POLICY)) invalid('policy differs from the recorded owner decision');
  if (manifest.productionReady !== false || manifest.dataAsOf !== null || manifest.source?.kind !== 'public-read-only-catalog-export') invalid('manifest contract');
  if (!a.guards || a.guards.passed !== true || !/^[a-f0-9]{64}$/.test(a.guards.reportSha256 || '') || !Number.isFinite(Date.parse(a.guards.checkedAt))) invalid('guards');
  if (!guardsBytes || sha256(guardsBytes) !== a.guards.reportSha256) invalid('guard report checksum');
  const report = JSON.parse(guardsBytes);
  if (report.blocked?.length || report.passed !== true) invalid('guard report not passed');
  if (!provenance || !sameJSON(provenance.acceptance, a)) invalid('provenance');
  for (const name of ['trees', 'decor', 'promos']) {
    const feed = manifest.feeds?.[name], saved = provenance.feeds?.[name];
    if (!feed || !saved || !([`https://mgnotvaahftrbifqtahf.supabase.co/storage/v1/object/public/le-catalog-feeds/${name}.csv`, `https://mgnotvaahftrbifqtahf.supabase.co/functions/v1/catalog/feeds/${name}.csv`].includes(feed.source))
      || !['source', 'receivedAt', 'sha256'].every(k => saved[k] === feed[k])) invalid(`feed provenance ${name}`);
  }
  return { accepted: true, kind: a.kind, notice: `Каталог опубликован автоматически по правилу владельца от ${STANDING_POLICY.date}: данные Supabase получены ${manifest.feeds.trees.receivedAt}, автоматические проверки пройдены.` };
}
