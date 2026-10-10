import { readFile, readdir, stat } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
const allowedExternalResources = new Set(['https://mc.yandex.ru/metrika/tag.js?id=104963244']);
export async function validateBuildAssets(root) {
  const errors = new Set();
  async function check(value, file, css = false) {
    if (!value || /^(data:|blob:|#)/i.test(value)) return;
    if (/^(https?:)?\/\//i.test(value)) {
      if (!allowedExternalResources.has(value)) errors.add(`${file}: external resource ${value}`);
      return;
    }
    const pathname = decodeURIComponent(value.split(/[?#]/)[0]);
    const target = resolve(pathname.startsWith('/') ? root : css ? dirname(file) : root, pathname.replace(/^\//, ''));
    if (!target.startsWith(root + sep)) { errors.add(`${file}: resource escapes build`); return; }
    try { if (!(await stat(target)).isFile()) throw new Error(); }
    catch { errors.add(`${file}: missing local resource ${value}`); }
  }
  for (const name of await readdir(root, { recursive: true })) {
    const file = join(root, name);
    if (!/\.(html|css)$/.test(name)) continue;
    let text = await readFile(file, 'utf8');
    if (name.endsWith('.html')) text = text.replace(/(<script\b[^>]*>)[\s\S]*?<\/script>/gi, '$1</script>');
    if (name.endsWith('.html')) for (const match of text.matchAll(/<(img|script|source|video|audio|link)\b[^>]*>/gi)) {
      if (match[1].toLowerCase() === 'link' && !/rel=["'](?:stylesheet|icon|preload)["']/i.test(match[0])) continue;
      for (const attr of match[0].matchAll(/\b(?:src|poster|href)=["']([^"']+)["']/gi)) await check(attr[1], file);
    }
    if (name.endsWith('.html')) {
      for (const tag of text.matchAll(/<img\b[^>]*>/gi)) {
        const srcset = /\bsrcset=["']([^"']+)["']/i.exec(tag[0])?.[1];
        if (srcset) for (const candidate of srcset.split(',')) await check(candidate.trim().split(/\s+/)[0], file);
      }
      for (const tag of text.matchAll(/<meta\b[^>]*>/gi)) {
        if (!/\bproperty=["']og:image["']/i.test(tag[0])) continue;
        const value = /\bcontent=["']([^"']+)["']/i.exec(tag[0])?.[1];
        if (value) await check(value.replace(/^https:\/\/(?:www\.)?lady-elka\.ru(?=\/)/, ''), file);
      }
    }
    for (const match of text.matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/gi)) await check(match[1].trim(), file, name.endsWith('.css'));
  }
  if (errors.size) throw new Error(`Incomplete offline assets:\n${[...errors].join('\n')}`);
}
