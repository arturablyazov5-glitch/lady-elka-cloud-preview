// Блог: Supabase (le_blog_posts через публичный le-admin-blog/published) → проверенный снимок storefront/blog/snapshot.json.
// Обложки скачиваются в контентно-адресуемое хранилище storefront/public/media/blog/<sha256>.<ext> (без хотлинков на сайте).
// Вызывается из scripts/catalog-sync.mjs (тот же запуск/триггер, что и каталог): prepareBlog() до сборки, activateBlog() после публикации.
// Ничего не удаляет и не пишет во внешние системы; только GET.
import { readFile, writeFile, mkdir, rename, rm } from 'node:fs/promises';
import { resolve, join, dirname, relative } from 'node:path';
import { randomUUID } from 'node:crypto';
import { isIP } from 'node:net';
import { pathToFileURL } from 'node:url';
import { createSnapshot, loadSnapshot, validateExport, legacySlugs, checksum, defaultSnapshot, publicRoot } from './snapshot.mjs';

export const PUBLISHED_URL = 'https://mgnotvaahftrbifqtahf.supabase.co/functions/v1/le-admin-blog/published';
export const MEDIA_SUBDIR = 'media/blog';
const MAX_BYTES = 8 * 1024 * 1024, MAX_JSON = 20 * 1024 * 1024;
const TYPES = { 'image/webp': '.webp', 'image/jpeg': '.jpg', 'image/png': '.png' };
const sniff = b => b.length > 12 && b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WEBP' ? 'image/webp'
  : b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff ? 'image/jpeg'
  : b.length > 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) ? 'image/png' : null;

async function readLimited(response, limit) {
  const reader = response.body.getReader(), chunks = []; let length = 0;
  try { for (;;) { const { done, value } = await reader.read(); if (done) break; length += value.length; if (length > limit) throw new Error('Превышен размер ответа'); chunks.push(Buffer.from(value)); } }
  finally { await reader.cancel().catch(() => {}); }
  return Buffer.concat(chunks);
}

// Два одинаковых чтения подряд: не собираем статью, которую владелец как раз сохраняет.
export async function fetchPublished({ fetchImpl = fetch, url = process.env.LE_BLOG_PUBLISHED_URL || PUBLISHED_URL } = {}) {
  const once = async () => {
    const r = await fetchImpl(url, { redirect: 'error', signal: AbortSignal.timeout(20000), headers: { Accept: 'application/json', 'Cache-Control': 'no-cache' } });
    if (r.status !== 200) throw new Error(`Блог: le-admin-blog/published ответил HTTP ${r.status}`);
    return (await readLimited(r, MAX_JSON)).toString('utf8');
  };
  const first = await once(), second = await once();
  if (checksum(first) !== checksum(second)) throw new Error('Блог изменился во время чтения; повтор на следующем запуске');
  const raw = JSON.parse(second);
  if (!raw || raw.version !== 1 || raw.format !== 'plain-text' || !Array.isArray(raw.posts)) throw new Error('Блог: неожиданный формат ответа');
  const posts = raw.posts.filter(p => p && p.status === 'published')
    .map(p => ({ ...p, url: `/blog/${p.slug}.html` }))
    .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)) || String(a.id).localeCompare(String(b.id)));
  return { exported: { version: 1, format: 'plain-text', posts }, sha256: checksum(second) };
}

function coverSource(value) {
  let u; try { u = new URL(value); } catch { throw new Error('некорректный адрес обложки'); }
  const host = u.hostname.replace(/^\[|\]$/g, '');
  if (u.protocol !== 'https:' || u.username || u.password || (u.port && u.port !== '443') || isIP(host) || host === 'localhost' || host.endsWith('.localhost') || !host.includes('.'))
    throw new Error('обложка должна быть по публичному адресу https://');
  return u.href;
}

async function storeBytes(bytes, type, root) {
  const dir = resolve(root, MEDIA_SUBDIR), digest = checksum(bytes), file = join(dir, `${digest}${TYPES[type]}`);
  await mkdir(dir, { recursive: true });
  try { if (checksum(await readFile(file)) === digest) return { file, digest }; throw new Error(`Файл обложки повреждён: ${relative(root, file)}`); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const temp = join(dir, `.tmp-${randomUUID()}`);
  try { await writeFile(temp, bytes, { flag: 'wx' }); await rename(temp, file); } finally { await rm(temp, { force: true }); }
  return { file, digest };
}

export async function downloadCover(value, { fetchImpl = fetch, root = publicRoot } = {}) {
  const url = coverSource(value);
  const r = await fetchImpl(url, { redirect: 'error', signal: AbortSignal.timeout(20000), headers: { Accept: 'image/webp,image/jpeg,image/png', 'User-Agent': 'LadyElka-blog-sync/1' } });
  if (r.status !== 200) throw new Error(`обложка недоступна (HTTP ${r.status})`);
  const declared = (r.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
  const bytes = await readLimited(r, MAX_BYTES), type = sniff(bytes);
  if (!type || (declared && declared !== 'application/octet-stream' && declared !== type)) throw new Error('обложка — не изображение JPEG/PNG/WebP');
  const { file } = await storeBytes(bytes, type, root);
  return '/' + relative(root, file).split('\\').join('/');
}

const contentDigest = snapshot => snapshot ? checksum({ posts: snapshot.posts, assets: snapshot.assets }) : checksum({ posts: [], assets: {} });

// Готовит снимок-кандидат. Битые статьи/обложки не валят каталог и остальные статьи: статья пропускается с предупреждением.
// status: 'unchanged' | 'changed'. Исключения (сеть/формат) пробрасываются — вызывающий оставляет прежний снимок.
export async function prepareBlog({ output, fetchImpl = fetch, current = process.env.LE_BLOG_SNAPSHOT || defaultSnapshot, root = publicRoot } = {}) {
  const { exported, sha256 } = await fetchPublished({ fetchImpl });
  const legacy = await legacySlugs(root), warnings = [], accepted = [], mapping = {};
  let previous = null;
  try { previous = await loadSnapshot({ file: current, root }); } catch (error) { if (error.code !== 'ENOENT') warnings.push(`Прежний снимок блога не прочитан: ${error.message}`); }
  for (const post of exported.posts) {
    const label = `«${String(post.title || post.slug).slice(0, 80)}»`;
    try { await validateExport({ ...exported, posts: [post] }, legacy); }
    catch (error) { warnings.push(`Статья ${label} не опубликована: ${error.message}`); continue; }
    if (post.cover && !post.cover.startsWith('/')) {
      try { mapping[post.cover] = await downloadCover(post.cover, { fetchImpl, root }); }
      catch (error) {
        const prior = previous?.assets?.[post.cover];
        if (prior) { mapping[post.cover] = prior.url; warnings.push(`Статья ${label}: ${error.message}; оставлена ранее сохранённая обложка`); }
        else { warnings.push(`Статья ${label} не опубликована: ${error.message}`); continue; }
      }
    }
    try { await createSnapshot({ ...exported, posts: [post] }, { root, mapping: post.cover && mapping[post.cover] ? { [post.cover]: mapping[post.cover] } : {} }); }
    catch (error) { warnings.push(`Статья ${label} не опубликована: ${error.message}`); continue; }
    accepted.push(post);
  }
  let snapshot;
  try { snapshot = await createSnapshot({ ...exported, posts: accepted }, { root, mapping, source: 'supabase:le-admin-blog/published', exportChecksum: sha256 }); }
  catch (error) { throw new Error(`Блог: снимок не собран: ${error.message}`); }
  const digest = contentDigest(snapshot);
  const result = { posts: snapshot.posts.length, contentSha256: digest, warnings, previousPosts: previous?.posts.length || 0 };
  if (digest === contentDigest(previous)) return { ...result, status: 'unchanged' };
  if (!output) throw new Error('Блог: не указан путь кандидата');
  await mkdir(dirname(output), { recursive: true });
  const temp = `${output}.${randomUUID()}.tmp`;
  try { await writeFile(temp, JSON.stringify(snapshot, null, 2) + '\n', { flag: 'wx' }); await rename(temp, output); } finally { await rm(temp, { force: true }); }
  await loadSnapshot({ file: output, root }); // тот же контроль, что в сборке
  return { ...result, status: 'changed', file: output, sha256: snapshot.sha256 };
}

// Атомарно делает кандидат активным снимком (вызывать только после успешной публикации сайта).
export async function activateBlog(candidate, { target = defaultSnapshot, root = publicRoot } = {}) {
  await loadSnapshot({ file: candidate, root });
  const temp = `${target}.${randomUUID()}.tmp`;
  try { await writeFile(temp, await readFile(candidate), { flag: 'wx' }); await rename(temp, target); } finally { await rm(temp, { force: true }); }
  return target;
}

// CLI для ручной проверки: node storefront/blog/sync.mjs [--apply]
// Без --apply — только отчёт (кандидат во временном файле удаляется). --apply меняет ТОЛЬКО локальный snapshot.json (без деплоя).
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const output = join(dirname(defaultSnapshot), `.candidate-${randomUUID()}.json`);
  try {
    const result = await prepareBlog({ output });
    if (result.status === 'changed' && process.argv.includes('--apply')) result.activated = relative(process.cwd(), await activateBlog(output));
    console.log(JSON.stringify({ ...result, file: undefined }, null, 2));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
  finally { await rm(output, { force: true }); }
}
