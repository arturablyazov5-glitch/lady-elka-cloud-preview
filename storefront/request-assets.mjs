// Final build pass: preserve the CSS cascade and owned runtime order while
// publishing only content-addressed resources in page markup.
import { readFile, writeFile, readdir, mkdir, copyFile } from 'node:fs/promises';
import { join, extname } from 'node:path';
import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import * as esbuild from 'esbuild';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
export async function optimizeRequests(target) {
  await mkdir(join(target, 'assets'), { recursive: true });
  const mapping = new Map();
  const posters = JSON.parse(await readFile(new URL('./public/f/video-posters/map.json', import.meta.url), 'utf8'));
  const oldFont = '/t/images/mosaic/fonts/Soyuz Grotesk-700-normal-1.woff';
  async function asset(url) {
    if (!url.startsWith('/') || url.startsWith('//') || !/\.(?:svg|png|jpe?g|webp|gif|ico|woff2?)$/i.test(url)) return url;
    if (/\/[a-f0-9]{64}\.[a-z0-9]+$/.test(url)) return url;
    if (mapping.has(url)) return mapping.get(url);
    const bytes = await readFile(join(target, decodeURIComponent(url))).catch(() => null);
    if (!bytes) return url;
    const ext = extname(url);
    let result;
    if (ext === '.svg' && bytes.length <= 16384) result = `data:image/svg+xml,${encodeURIComponent(bytes.toString('utf8')).replace(/[!'()*]/g, c => '%' + c.charCodeAt(0).toString(16))}`;
    else {
      result = `/assets/${hash(bytes)}${ext}`;
      await copyFile(join(target, decodeURIComponent(url)), join(target, result), constants.COPYFILE_FICLONE);
    }
    mapping.set(url, result); return result;
  }
  async function rewrite(text) {
    text = text.replaceAll(oldFont, '/f/fonts/Soyuz-Grotesk-700.woff2').replaceAll(oldFont.replaceAll(' ', '%20'), '/f/fonts/Soyuz-Grotesk-700.woff2')
      .replace(/format\(['"]woff['"]\)/g, "format('woff2')").replaceAll('type="font/woff"', 'type="font/woff2"');
    // HTML, CSS url(), JSON and srcset share root-relative owned asset URLs.
    const urls = [...new Set(text.match(/\/(?:f|d|t|media|thumb|g)\/[^\s'"()<>;,]+\.(?:svg|png|jpe?g|webp|gif|ico|woff2?)/gi) || [])];
    for (const url of urls.sort((a,b) => b.length - a.length)) text = text.split(url).join(await asset(url));
    return text.replaceAll('/favicon.png', await asset('/favicon.png'));
  }
  async function emit(text, ext) {
    const url = `/assets/${hash(text)}.${ext}`;
    await writeFile(join(target, url), text); return url;
  }
  const reads = {};
  for (const name of ['trees', 'decor', 'promos']) reads[`/__offline/catalog/${name}.csv`] = { type: 'text/csv', body: await readFile(join(target, '__offline/catalog', `${name}.csv`), 'utf8') };
  for (const path of ['/product-routes.json', '/media/catalog-pinned/map.json']) reads[path] = { type: 'application/json', body: await readFile(join(target, path), 'utf8') };
  const demandPath = await emit(await rewrite(await readFile(join(target, 'f/checkout-demand.js'), 'utf8')), 'js');
  const catalog = (await rewrite(await readFile(join(target, 'f/catalog.js'), 'utf8'))).replaceAll('/f/checkout-demand.js', demandPath);
  const config = await rewrite(await readFile(join(target, 'f/storefront-config.js'), 'utf8'));
  const snapshot = `window.__LE_SNAPSHOT_READS__=${JSON.stringify(reads).replaceAll('<', '\\u003c')};\n`;
  const runtime = await emit([config, await readFile(join(target, 'local-guard.js'), 'utf8'), snapshot,
    await readFile(new URL('./client/snapshot-fetch.js', import.meta.url), 'utf8'), catalog,
    await readFile(join(target, 'f/site-runtime.js'), 'utf8'), await readFile(join(target, 'f/metrika.js'), 'utf8')].join('\n;\n'), 'js');
  const scriptPaths = new Set(['/f/storefront-config.js', '/local-guard.js', '/f/catalog.js', '/f/site-runtime.js', '/f/metrika.js']);
  const searchPath = await emit(await readFile(join(target, 'search.js'), 'utf8'), 'js');
  for (const file of await readdir(target, { recursive: true })) {
    if (!file.endsWith('.html') || file === '404.html') continue;
    let html = await readFile(join(target, file), 'utf8');
    // Retain native video controls and first-frame presentation; preload=none
    // means no metadata/Range request before the visitor presses play.
    html = html.replace(/<video\b[^>]*>/gi, tag => {
      const src = /\bsrc=['"]([^'"]+)/.exec(tag)?.[1];
      if (posters[src] && !/\bposter=['"][^'"]+/.test(tag)) tag = tag.replace(/\sposter=['"][^'"]*['"]/i, '').replace(/>$/, ` poster="${posters[src]}">`);
      return tag.replace(/\sautoplay(?:=(['"])[^'"]*\1)?/gi, '').replace(/\spreload=(['"])[^'"]*\1/gi, '').replace(/>$/, ' preload="none">');
    });
    html = await rewrite(html);
    const styles = []; let marker = false;
    html = html.replace(/<link\b[^>]*rel=['"]stylesheet['"][^>]*>|<style\b[^>]*>[\s\S]*?<\/style>/gi, tag => {
      styles.push(tag);
      if (!marker) { marker = true; return '<!-- request-budget-css -->'; }
      return '';
    });
    let css = '';
    for (const tag of styles) {
      const url = /^<link/i.test(tag) && /\bhref=['"]([^'"]+)['"]/.exec(tag)?.[1];
      if (url) {
        if (!url.startsWith('/')) throw new Error(`Unowned stylesheet ${url}`);
        let content = await rewrite(await readFile(join(target, url.split('?')[0]), 'utf8'));
        const media = /\bmedia=['"]([^'"]+)['"]/.exec(tag)?.[1];
        css += media ? `\n@media ${media}{${content}}` : `\n${content}`;
      } else css += '\n' + tag.replace(/^<style\b[^>]*>/i, '').replace(/<\/style>$/i, '');
    }
    // Encoding/minifying only: no coverage-based rule removal (hidden modals,
    // responsive rules and keyboard states remain part of the stylesheet).
    css = (await esbuild.transform(css, { loader: 'css', minify: true, charset: 'utf8', legalComments: 'none' })).code;
    html = html.replace('<!-- request-budget-css -->', `<link rel="stylesheet" href="${await emit(css, 'css')}">`);
    html = html.replace(/<script\b[^>]*src=['"]([^'"]+)['"][^>]*><\/script>/gi, (tag, url) => scriptPaths.has(url) ? '' : url === '/search.js' ? `<script src="${searchPath}" defer></script>` : tag);
    // The same shared bundle (config/data/runtime) is reused across every page.
    html = html.replace(/<\/head>/i, `<script src="${runtime}" defer></script></head>`);
    await writeFile(join(target, file), html);
  }
  await writeFile(join(target, 'request-assets.json'), JSON.stringify({ runtime, demand: demandPath, search: searchPath, assets: Object.fromEntries(mapping) }, null, 2));
}
