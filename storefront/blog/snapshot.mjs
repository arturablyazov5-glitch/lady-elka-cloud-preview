import { readFile, readdir, realpath, stat } from 'node:fs/promises';
import { resolve, join, sep } from 'node:path';
import { createHash } from 'node:crypto';
export const defaultSnapshot = resolve(import.meta.dirname, 'snapshot.json');
export const publicRoot = resolve(import.meta.dirname, '../public');
export const checksum = value => createHash('sha256').update(typeof value === 'string' || Buffer.isBuffer(value) ? value : JSON.stringify(value)).digest('hex');
const fail = message => { throw new Error(`Blog publication: ${message}`); };
export const escapeHtml = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export async function legacySlugs(root = publicRoot) {
 return (await readdir(join(root, 'blog'))).filter(n => n.endsWith('.html')).map(n => n.slice(0, -5));
}
function validatePlainExport(raw, legacy = []) {
 if (!raw || raw.version !== 1 || raw.format !== 'plain-text' || !Array.isArray(raw.posts)) fail('expected version 1 plain-text export');
 if (raw.posts.length > 10000) fail('too many posts');
 const slugs = new Set(['index', ...legacy]), ids = new Set();
 return raw.posts.map(rawPost => {
  if (!rawPost || typeof rawPost !== 'object' || Array.isArray(rawPost)) fail('invalid post');
  const post = {};
  for (const [key, max] of Object.entries({title:200,slug:160,excerpt:1000,cover:2000,alt:300,text:100000,seoTitle:200,seoDescription:500})) {
   if (typeof rawPost[key] !== 'string' || rawPost[key].length > max || /\u0000/.test(rawPost[key])) fail(`invalid ${key}`);
   post[key] = key === 'text' ? rawPost[key] : rawPost[key].trim();
  }
  if (!post.title || !post.excerpt || !post.text.trim() || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(post.slug)) fail('missing title/body/excerpt or unsafe slug');
  if (rawPost.status !== 'published') fail('export must contain only published posts');
  if (slugs.has(post.slug)) fail(`route collision: ${post.slug}`);
  slugs.add(post.slug);
  if (typeof rawPost.id !== 'string' || !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(rawPost.id) || ids.has(rawPost.id.toLowerCase())) fail('invalid or duplicate id');
  ids.add(rawPost.id.toLowerCase());
  if (!Number.isSafeInteger(rawPost.revision) || rawPost.revision < 1) fail('invalid revision');
  for (const key of ['createdAt','updatedAt']) if (typeof rawPost[key] !== 'string' || !/^\d{4}-\d{2}-\d{2}T/.test(rawPost[key]) || !Number.isFinite(Date.parse(rawPost[key]))) fail(`invalid ${key}`);
  if (Date.parse(rawPost.updatedAt) < Date.parse(rawPost.createdAt)) fail('invalid timestamps');
  const url = `/blog/${post.slug}.html`;
  if (rawPost.url !== url) fail('url must match exported slug and .html route');
  if (post.cover) {
   let safe = /^\/images\/[a-zA-Z0-9_/-]+\.(png|jpg|jpeg|webp)$/i.test(post.cover);
   try { const u = new URL(post.cover); safe ||= u.protocol === 'https:' && !u.username && !u.password; } catch {}
   if (!safe || !post.alt) fail('unsafe cover or missing alt');
  }
  if (rawPost.content !== undefined || rawPost.contentFormat !== undefined) {
   if (rawPost.contentFormat !== 'le-richtext-v1' || rawPost.content === undefined) fail('unknown or missing rich-text document');
   post.contentFormat = rawPost.contentFormat; post.content = rawPost.content;
  }
  return {...post,id:rawPost.id,revision:rawPost.revision,status:'published',createdAt:rawPost.createdAt,updatedAt:rawPost.updatedAt,url};
 });
}
async function assetFile(url, root) {
 if (typeof url !== 'string' || !/^\/(?:[a-zA-Z0-9_-]+\/)*[a-zA-Z0-9_.-]+\.(?:png|jpe?g|webp)$/i.test(url) || url.split('/').some(p => p === '..' || p === '.')) fail('unsafe local asset path');
 const base = await realpath(root), file = await realpath(resolve(root, url.slice(1))).catch(() => fail(`missing local cover: ${url}`));
 if (!file.startsWith(base + sep) || !(await stat(file)).isFile()) fail('cover escapes public root');
 return file;
}
async function validateRichPosts(posts) {
 if (!posts.some(p => p.content !== undefined)) return posts;
 // Use the admin-owned canonical schema, never a second interpretation of rich content.
 const {validateContent,contentText} = await import('../../app/public/js/blog-model.js');
 for (const post of posts) if (post.content !== undefined) {
  post.content = validateContent(post.content);
  const text = contentText(post.content);
  if (text !== post.text || /\u0000/.test(text)) fail('rich document and plain fallback differ');
 }
 return posts;
}
export async function validateExport(raw, legacy = []) {
 return validateRichPosts(validatePlainExport(raw, legacy));
}
export async function createSnapshot(raw, {root = publicRoot, mapping = {}, source = 'local-file', importedAt = new Date().toISOString(), exportChecksum} = {}) {
 if (!mapping || typeof mapping !== 'object' || Array.isArray(mapping)) fail('invalid cover mapping');
 const posts = await validateExport(raw, await legacySlugs(root)), assets = {};
 for (const post of posts) if (post.cover) {
  const url = Object.hasOwn(mapping, post.cover) ? mapping[post.cover] : post.cover;
  const file = await assetFile(url, root);
  assets[post.cover] = {url,sha256:checksum(await readFile(file))};
 }
 const payload = {version:1,format:'plain-text',posts,assets,provenance:{source,importedAt,exportSha256:exportChecksum || checksum(raw)},productionReady:false};
 return {...payload,sha256:checksum(payload)};
}
export async function loadSnapshot({file = process.env.LE_BLOG_SNAPSHOT || defaultSnapshot, root = publicRoot} = {}) {
 let raw;
 try { raw = JSON.parse(await readFile(file, 'utf8')); } catch (e) { if (e.code === 'ENOENT' && file === defaultSnapshot) return null; throw e; }
 if (!raw || !raw.assets || typeof raw.assets !== 'object' || Array.isArray(raw.assets) || raw.productionReady !== false || !raw.provenance || typeof raw.provenance.source !== 'string' || !Number.isFinite(Date.parse(raw.provenance.importedAt)) || !/^[a-f0-9]{64}$/.test(raw.provenance.exportSha256)) fail('invalid snapshot provenance');
 const payload = {version:raw.version,format:raw.format,posts:raw.posts,assets:raw.assets,provenance:raw.provenance,productionReady:raw.productionReady};
 if (checksum(payload) !== raw.sha256) fail('snapshot checksum mismatch');
 const posts = await validateExport(raw, await legacySlugs(root));
 for (const post of posts) if (post.cover) {
  const asset = raw.assets[post.cover];
  if (!asset || checksum(await readFile(await assetFile(asset.url, root))) !== asset.sha256) fail(`cover checksum mismatch: ${post.cover}`);
 }
 return {...raw,posts};
}
