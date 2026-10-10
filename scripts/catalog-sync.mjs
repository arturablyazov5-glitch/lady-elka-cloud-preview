// No external writes unless --publish is explicitly selected. Dry-run builds but never switches active.json or notifies.
import { readFile, mkdir, rm, mkdtemp, statfs, stat, rename } from 'node:fs/promises';
import { resolve, join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { acquireLock } from './catalog-sync/lock.mjs';
import { throttledNotify } from './catalog-sync/notify.mjs';
import { fetchPublic, accept, readCandidate } from '../storefront/catalog-import/import.mjs';
import { readPointer, defaultPointerPath, repoRoot, snapshotsRoot } from '../storefront/products/snapshot-acceptance.mjs';
import { validateActiveSnapshot } from '../storefront/products/build-feed.mjs';
import { resolveRoutes, savedRoutes } from '../storefront/products/routes.mjs';
import { treeProducts, decorProducts } from '../storefront/products/model.mjs';
import { validateCSV } from '../storefront/catalog-import/import.mjs';
import { checkCatalog } from './catalog-sync/guards.mjs';
import { pinMedia } from './catalog-sync/media.mjs';
import { readFeedsOf, feedsDigest, writeSnapshot, pointerFor, writePointer } from './catalog-sync/snapshot.mjs';
import { publish } from './catalog-sync/publish.mjs';
import { notify, formatMessage, telegramTarget } from './catalog-sync/notify.mjs';
import { prepareBlog, activateBlog } from '../storefront/blog/sync.mjs';
const names = ['trees', 'decor', 'promos'];
const hash = value => createHash('sha256').update(value).digest('hex');
export const mediaDigest = media => hash(JSON.stringify(media.assets.map(a => [a.rawURL, a.sha256]).sort((a,b) => a[0].localeCompare(b[0]))));
export async function diskGuard(path = tmpdir(), min = 1.5 * 1024 ** 3) {
  const s = await statfs(path), free = s.bavail * s.bsize;
  if (free < min) throw new Error('Свободно меньше 1.5 ГБ: синхронизация остановлена');
  return free;
}
export async function fetchInputs({ inputDir, fetchImpl = fetch } = {}) {
  if (inputDir) {
    const saved = await readFeedsOf(join(resolve(inputDir), 'manifest.json'));
    return Object.fromEntries(names.map(n => [n, { ...saved.manifest.feeds[n], text: saved.feeds[n] }]));
  }
  // Direct exporter reads the database; avoids stale Storage CSV after an interrupted publishFeeds().
  // Two identical rounds reject a catalog changing during our independent GET requests.
  const first = {}, second = {};
  for (const n of names) first[n] = await fetchPublic(n, { direct: true, fetchImpl });
  for (const n of names) second[n] = await fetchPublic(n, { direct: true, fetchImpl });
  if (names.some(n => hash(first[n].text) !== hash(second[n].text))) throw Object.assign(new Error('Каталог изменился во время чтения; повтор на следующем запуске'), {code:'CATALOG_CHANGING'});
  return second;
}
export async function buildSnapshot({ pointerPath, output, mode, blogSnapshot, previousAssets, signal }) {
  await new Promise((ok, fail) => {
    const child = spawn(process.execPath, ['--import', 'data:text/javascript,globalThis.fetch=()=>{throw new Error("Offline build network forbidden")}', 'storefront/build.mjs', `--mode=${mode}`, `--output=${output}`, ...(previousAssets ? [`--previous-assets=${resolve(previousAssets)}`] : [])], {
      cwd: repoRoot, signal, env: { ...process.env, LE_CATALOG_ACTIVE_POINTER: pointerPath, ...(blogSnapshot ? { LE_BLOG_SNAPSHOT: blogSnapshot } : {}) }, stdio: ['ignore', 'inherit', 'inherit'],
    });
    child.once('error', fail); child.once('exit', code => code === 0 ? ok() : fail(new Error(`Catalog build failed (${code})`)));
  });
}
// Dependencies are injectable for fault tests; CLI always uses real validation/build/publication.
export async function syncCatalog(options = {}, deps = {}) {
  const dryRun = options.dryRun ?? true, method = options.method || 'none', mode = options.mode || 'production';
  if (!['preview','production'].includes(mode)) throw new Error('Invalid build mode');
  if (!dryRun && method === 'none') throw new Error('Activation requires a publication adapter');
  if (!dryRun && !deps.notify && !telegramTarget().ok) throw new Error('Private Telegram notification configuration required');
  if (options.inputDir && !dryRun) throw new Error('Fixture input is dry-run only');
  const pointerPath = options.pointerPath || defaultPointerPath;
  // Persistent runner state: retain the last successfully published artifact,
  // independent of the temporary build directory and remote adapter.
  const retainedRoot = `${pointerPath}.previous-assets`;
  const previousAssets = options.previousAssets || process.env.LE_PREVIOUS_ASSETS || (method === 'dir' ? process.env.LE_DEPLOY_DIR : undefined) || retainedRoot;
  const lock = `${pointerPath}.sync-lock`;
  await mkdir(dirname(lock), { recursive: true });
  let work, stage = 'preflight';
  const send = async (title, lines, key) => {
    if (dryRun) return { sent: false, reason: 'dry-run' };
    try { return await throttledNotify(formatMessage({ title, lines }), {statePath: `${pointerPath}.notifications.json`, send: deps.notify || notify, key}); }
    catch { return { sent: false, reason: 'notification transport failed' }; }
  };
  let lease;
  try {lease=await acquireLock(lock);}catch(error){await send('Каталог: запуск заблокирован', ['Другой запуск удерживает lock. Проверьте журнал раннера.']);throw error;}
  const abort = new AbortController();
  const onSignal = async signal => { abort.abort(); if(work) await rm(work,{recursive:true,force:true}); await lease.release(); process.exit(signal === 'SIGINT' ? 130 : 143); };
  const int = () => void onSignal('SIGINT'), term = () => void onSignal('SIGTERM');
  process.once('SIGINT', int); process.once('SIGTERM', term);
  try {
    await (deps.diskGuard || diskGuard)(); await (deps.diskGuard || diskGuard)(repoRoot);
    const pointer = readPointer(pointerPath), baseline = await readFeedsOf(pointer.manifestPath);
    const accepted = await (deps.validate || validateActiveSnapshot)(pointer);
    stage = 'fetch';
    const inputs = await (deps.fetchInputs || fetchInputs)(options);
    const next = Object.fromEntries(names.map(n => [n, inputs[n].text]));
    let guards = checkCatalog({ prev: baseline.feeds, next, thresholds: options.thresholds });
    if (!guards.passed) return { status: 'blocked', guards, notification: await send('Каталог: обновление заблокировано', guards.blocked) };
    const feedHash = feedsDigest(Object.fromEntries(names.map(n => [n, { sha256: hash(next[n]) }])));
    const feedUnchanged = feedHash === feedsDigest(baseline.manifest.feeds);
    stage = 'media';
    const media = await (deps.pinMedia || pinMedia)(next, { refreshRemote: !options.inputDir });
    guards = checkCatalog({ prev: baseline.feeds, next, mediaFailures: media.failures, thresholds: options.thresholds });
    if (!guards.passed) return { status: 'blocked', guards, notification: await send('Каталог: обновление заблокировано', guards.blocked) };
    const mediaHash = mediaDigest(media);
    // Blog (le_blog_posts → storefront/blog/snapshot.json) rides the same trigger/run. Its failure never blocks the catalog.
    stage = 'blog';
    work = await mkdtemp(join('/tmp', 'le-catalog-sync-'));
    await lease.setWork(work);
    let blog = { status: 'skipped', warnings: [] };
    if (!options.inputDir) {
      try { blog = await (deps.prepareBlog || prepareBlog)({ output: join(work, 'blog-snapshot.json') }); }
      catch (error) { blog = { status: 'failed', warnings: [`Блог не обновлён, на сайте прежние статьи: ${error.message}`] }; }
    }
    const blogChanged = blog.status === 'changed', blogInfo = { status: blog.status, posts: blog.posts, warnings: blog.warnings };
    const catalogUnchanged = feedUnchanged && mediaHash === mediaDigest({ assets: [...accepted.mapping].map(([rawURL, entry]) => ({ rawURL, sha256: /\/([a-f0-9]{64})\./.exec(entry.url)[1] })) });
    if (options.rebuildCurrent && (!catalogUnchanged || blogChanged)) throw new Error('Current-version rehearsal requires identical live inputs');
    if (catalogUnchanged && !blogChanged && !options.rebuildCurrent) return { status: 'unchanged', id: pointer.id, feedsSha256: feedHash, blog: blogInfo };
    stage = 'snapshot';
    let id = pointer.id, newPointer = null, proposed = pointerPath;
    if (!catalogUnchanged) {
    id = `auto-${hash(feedHash + mediaHash + feedsDigest(baseline.manifest.feeds)).slice(0,32)}`;
    const candidateDir = join(repoRoot, 'storefront/catalog-import/candidates', id);
    try { await readCandidate(join(candidateDir, 'manifest.json')); } catch (error) {
      try { await stat(candidateDir); await rename(candidateDir, `${candidateDir}.incomplete-${randomUUID()}`); } catch (e) { if (e.code !== 'ENOENT') throw e; }
      await (deps.accept || accept)(inputs, { output: candidateDir });
    }
    let carried = [];
    try { carried = JSON.parse(await readFile(join(dirname(pointer.manifestPath), 'auto-routes.json'), 'utf8')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    const routes = resolveRoutes([...await savedRoutes(join(repoRoot, 'storefront')), ...carried], { tree: treeProducts(validateCSV('trees', next.trees)), decor: decorProducts(validateCSV('decor', next.decor)) });
    let snapshot;
    try { snapshot = { dir: join(snapshotsRoot, id), manifest: JSON.parse(await readFile(join(snapshotsRoot, id, 'manifest.json'), 'utf8')), feedsSha256: feedHash }; }
    catch (error) { if (error.code !== 'ENOENT') throw error; snapshot = await (deps.writeSnapshot || writeSnapshot)({ id, candidateDir, media, autoRoutes: routes.filter(r => r.auto), acceptance: { kind: 'auto', guards, checkedAt: new Date().toISOString() } }); }
    proposed = join(work, 'active.json');
    newPointer = pointerFor(snapshot, { activatedAt: new Date().toISOString(), previousId: pointer.id });
    await writePointer(proposed, newPointer);
    await (deps.validate || validateActiveSnapshot)(readPointer(proposed));
    }
    const output = join(work, 'dist');
    stage = 'build';
    let retainedAssets = previousAssets;
    if (retainedAssets) {
      try { await stat(retainedAssets); } catch (error) {
        if (error.code === 'ENOENT' && !options.previousAssets && !process.env.LE_PREVIOUS_ASSETS) {
          // Bootstrap from the retained local production artifact on first SW rollout.
          const initial = join(repoRoot, 'storefront/production/dist');
          try { await stat(join(initial, 'immutable-manifest.json')); retainedAssets = initial; }
          catch (missing) { if (missing.code === 'ENOENT') retainedAssets = undefined; else throw missing; }
        }
        else throw error;
      }
    }
    await (deps.build || buildSnapshot)({ pointerPath: proposed, output, mode, previousAssets: retainedAssets, signal: abort.signal, blogSnapshot: blogChanged ? blog.file : undefined });
    await (deps.diskGuard || diskGuard)();
    const builtRoutes = JSON.parse(await readFile(join(output, 'product-routes.json'), 'utf8'));
    stage = 'publish';
    const publication = dryRun ? { skipped: true, method } : await (deps.publish || publish)(output, { method, signal: abort.signal, pointer: newPointer || readPointer(pointerPath), blogSnapshot: blogChanged ? blog.file : undefined });
    if (!dryRun && mode === 'production' && method !== 'git-timeweb') {
      stage = 'retain-assets';
      await publish(output, { method: 'dir', env: { LE_DEPLOY_DIR: retainedRoot, LE_DEPLOY_KEEP_RELEASES: '2' }, signal: abort.signal });
    }
    // A failed uploader never reaches activation. If interrupted after upload, next run republishes and repairs pointer.
    stage = 'activate';
    if (!dryRun && newPointer) await writePointer(pointerPath, newPointer);
    if (!dryRun && blogChanged) await (deps.activateBlog || activateBlog)(blog.file);
    const blogLines = blogChanged ? [`Блог: ${blog.posts} опубликованных статей (было ${blog.previousPosts})`] : [];
    return { status: dryRun ? 'dry-run' : 'published', id, catalogChanged: !catalogUnchanged, feedsSha256: feedHash, mediaSha256: mediaHash, guards, publication, routes: builtRoutes.length, blog: blogInfo,
      notification: await send(catalogUnchanged ? 'Блог на сайте обновлён' : 'Каталог обновлён', [...(catalogUnchanged ? [] : [`Снимок ${id}`, `${guards.stats.activeProducts} активных товаров`, ...guards.warnings]), ...blogLines, ...(blog.warnings || [])]) };
  } catch (error) {
    if(error.code === 'CATALOG_CHANGING') return {status:'retry',reason:'catalog-changing'};
    error.catalogSyncStage = stage;
    await send('Каталог: ошибка обновления', ['Прежний снимок сохранён. Проверьте локальный журнал и запуск.'], hash(`${stage}:${error.code || ''}:${error.message}`));
    throw error;
  } finally {
    if (work) await rm(work, { recursive: true, force: true });
    process.removeListener('SIGINT', int); process.removeListener('SIGTERM', term);
    await lease.release();
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const opt = key => process.argv.find(a => a.startsWith(`--${key}=`))?.slice(key.length + 3);
  try {
    if (process.argv.includes('--apply') && process.argv.includes('--dry-run')) throw new Error('Conflicting apply/dry-run options');
    const result = await syncCatalog({ dryRun: !process.argv.includes('--apply'), method: opt('publish') || 'none', mode: opt('mode') || 'production', inputDir: opt('input-dir'), previousAssets: opt('previous-assets'), rebuildCurrent: process.argv.includes('--rebuild-current') });
    console.log(JSON.stringify(result, null, 2));
    if (result.status === 'blocked') process.exitCode = 2;
  } catch (error) { console.error(`Catalog sync failed at ${error.catalogSyncStage || 'preflight'}; no new active pointer. Check configuration/state; secrets are not logged.`); process.exitCode = 1; }
}
