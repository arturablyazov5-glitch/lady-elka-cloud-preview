// Final build pass: preserve the CSS cascade and owned runtime order while
// publishing only content-addressed resources in page markup.
import { readFile, writeFile, readdir, mkdir, copyFile } from 'node:fs/promises';
import { join, extname } from 'node:path';
import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import * as esbuild from 'esbuild';
import sharp from 'sharp';
import { deferPageImages, deferBackgroundCSS } from './products/lazy-images.mjs';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
export async function optimizeRequests(target) {
  await mkdir(join(target, 'assets'), { recursive: true });
  const mapping = new Map();
  const thumbnails = new Set(await readdir(join(target, 'media/catalog-thumbs')));
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
    return text.replaceAll('/favicon.png', await asset('/favicon.png'))
      .replace(/\/assets\/([a-f0-9]{64}\.webp)\b/g, (url, name) =>
        thumbnails.has(name) ? `/media/catalog-thumbs/${name}` : url);
  }
  const inlineImages = new Map();
  function inlineImage(url, icon) {
    const key = `${icon}:${url}`;
    if (!inlineImages.has(key)) {
      const source = sharp(join(target, url));
      const encoded = icon
        ? source.resize(48, 48, { fit: 'inside', withoutEnlargement: true }).png().toBuffer()
        : source.webp({ lossless: true }).toBuffer();
      inlineImages.set(key, encoded.then(bytes => `data:image/${icon ? 'png' : 'webp'};base64,${bytes.toString('base64')}`));
    }
    return inlineImages.get(key);
  }
  async function emit(text, ext) {
    const url = `/assets/${hash(text)}.${ext}`;
    await writeFile(join(target, url), text); return url;
  }
  async function replaceBrandImages(html) {
    const favicon = /<link rel="icon" href="(\/assets\/[a-f0-9]{64}\.png)"/.exec(html);
    if (favicon) html = html.replace(favicon[0], favicon[0].replace(favicon[1], await inlineImage(favicon[1], true)));
    const logos = new Set();
    for (const match of html.matchAll(/<div\b[^>]*\blogo__img__header\b[^>]*>\s*<img\b[^>]*?\ssrc=['"](\/assets\/[a-f0-9]{64}\.png)['"]/gi)) logos.add(match[1]);
    for (const url of logos) html = html.replaceAll(url, await inlineImage(url, false));
    return html;
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
  const index = await rewrite(await readFile(join(target, 'search-index.json'), 'utf8'));
  const searchScript = await readFile(join(target, 'search.js'), 'utf8');
  const searchPath = await emit(`const LE_SEARCH_INDEX = ${index};\n${searchScript}`, 'js');
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
    html = await replaceBrandImages(html);
    const iconStyles = [];
    for (const prefix of ['a6bbc36f', '79e27635', '8c834189']) {
      const pattern = new RegExp(`(<img\\b[^>]*?\\s)src=(['"])(/assets/${prefix}[a-f0-9]+\\.png)\\2`, 'gi');
      const url = [...html.matchAll(pattern)][0]?.[3];
      if (!url) continue;
      const contents = await inlineImage(url, false);
      html = html.replace(pattern, `$1data-le-icon="${prefix}" src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7"`);
      iconStyles.push(`img[data-le-icon="${prefix}"]{content:url("${contents}")}`);
    }
    // The browser fetches video posters even when video preload is disabled.
    html = html.replace(/<video\b[^>]*><\/video>/gi, video => {
      if (!/\bvideo__reviews\b/.test(video)) return video;
      const deferred = video.replace(/\sposter=/i, ' data-le-poster=')
        .replace(/\ssrc=/i, ' data-le-video-src=')
        .replace(/\scontrols(?:=(['"]).*?\1)?/i, '');
      return deferred + '<button type="button" data-le-video-play aria-label="Воспроизвести видеоотзыв">▶</button>' +
        `<noscript>${video}</noscript>`;
    });
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
    css = deferBackgroundCSS(css) + iconStyles.join('\n');
    if (html.includes('data-le-video-play')) {
      html = html.replace('</head>', '<noscript><style>video[data-le-video-src],button[data-le-video-play]{display:none}</style></noscript></head>');
      css += '.card__reviews{position:relative}button[data-le-video-play]{position:absolute;top:1rem;left:1rem;z-index:1;width:44px;height:44px;border:0;border-radius:50%;background:#222;color:#fff;cursor:pointer}';
    }
    html = html.replace('<!-- request-budget-css -->', `<link rel="stylesheet" href="${await emit(css, 'css')}">`);
    html = html.replace(/<script\b[^>]*src=['"]([^'"]+)['"][^>]*><\/script>/gi, (tag, url) => scriptPaths.has(url) ? '' : url === '/search.js' ? `<script src="${searchPath}" defer></script>` : tag);
    // The same shared bundle (config/data/runtime) is reused across every page.
    html = html.replace(/<\/head>/i, `<script src="${runtime}" defer></script></head>`);
    await writeFile(join(target, file), deferPageImages(html));
  }
  await writeFile(join(target, 'request-assets.json'), JSON.stringify({ runtime, demand: demandPath, search: searchPath, assets: Object.fromEntries(mapping) }, null, 2));
}
