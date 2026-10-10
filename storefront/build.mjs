import { pagePath } from './url-path.mjs';
import { buildThumbnails } from './products/build-thumbnails.mjs';
import { setPreviewImages, imagePreviewAttributes } from './products/image-preview.mjs';
import { applySEO, filterSitemap, canonicalPath } from './seo.mjs';
import { annotateLeadForms } from './client/lead-schema.js';
import { cp, mkdir, copyFile, readdir, rm, readFile, writeFile, realpath } from 'node:fs/promises';
import { join, relative, dirname, extname, resolve, sep } from 'node:path';
import * as esbuild from 'esbuild';
import { createHash } from 'node:crypto';
import { parseCSV } from '../supabase/functions/_shared/product-rules.mjs';
import { validateBuildAssets } from './products/build-assets.mjs';
import { loadFeed, readFeedText, validatePreviewInput, validateActiveSnapshot, setPreviewInput, pinnedPreviewMedia } from './products/build-feed.mjs';
import { buildRoutes } from './products/routes.mjs';
import { constants as fsConstants } from 'node:fs';
import { runtimeConfig } from './config/runtime.mjs';
import { loadSnapshot } from './blog/snapshot.mjs';
import { buildBlog, extendSitemap } from './blog/build.mjs';
const blogSnapshot = await loadSnapshot();
const mode = process.argv.find(arg => arg.startsWith('--mode='))?.slice(7);
if (!['preview', 'production'].includes(mode)) throw new Error('Explicit --mode=preview or --mode=production required; build is offline only');
const option = name => process.argv.find(arg => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
const inputManifest = option('input-manifest'), mediaManifest = option('media-manifest'), output = option('output');
if (Boolean(inputManifest) !== Boolean(mediaManifest)) throw new Error('Preview requires both --input-manifest and --media-manifest');
if (inputManifest && (mode !== 'preview' || !output)) throw new Error('Candidate requires preview mode and isolated --output');
const preview = inputManifest ? await validatePreviewInput(resolve(inputManifest), resolve(mediaManifest)) : null;
// Normal preview/production builds use the active accepted snapshot (catalog-snapshots/active.json) with pinned local photos.
const active = preview ? null : await validateActiveSnapshot();
setPreviewInput(preview || active);
const snapshot = (preview || active).manifest;
await Promise.all([loadFeed('trees'), loadFeed('decor')]);
const catalogOwnerStatus = (preview || active).ownerStatus;
console.log(`Offline catalog: ${snapshot.id}; ${catalogOwnerStatus.notice}; productionReady=false`);
const cloneMode = fsConstants.COPYFILE_FICLONE; // copy-on-write where the filesystem supports it (APFS/btrfs), plain copy otherwise

const source = join(import.meta.dirname, 'public');
const target = output ? resolve(output) : join(import.meta.dirname, mode === 'production' ? 'production/dist' : 'dist');
const previousAssets = option('previous-assets');
if (previousAssets) {
  const previousRoot = await realpath(resolve(previousAssets));
  const targetRoot = await realpath(target).catch(error => { if (error.code === 'ENOENT') return target; throw error; });
  if (previousRoot === targetRoot || previousRoot.startsWith(targetRoot + sep)) throw new Error('Previous assets must be outside the rebuilt output');
}
const sharedComponents = [
  ['<!-- storefront-component:installment-section -->', await readFile(join(import.meta.dirname, 'components', 'installment-section.html'), 'utf8')],
  ['<!-- storefront-component:reviews-section -->', await readFile(join(import.meta.dirname, 'components', 'reviews-section.html'), 'utf8')],
  ['<!-- storefront-component:faq-section -->', await readFile(join(import.meta.dirname, 'components', 'faq-section.html'), 'utf8')],
  ['<!-- storefront-component:question-form-section -->', await readFile(join(import.meta.dirname, 'components', 'question-form-section.html'), 'utf8')],
];
if (output && (target === resolve(import.meta.dirname, '..') || target.startsWith(resolve(import.meta.dirname, '..') + sep))) throw new Error('Isolated output must be outside repository');
if (output) {
  const parent = await realpath(dirname(target)), repo = await realpath(resolve(import.meta.dirname, '..'));
  if (parent === repo || parent.startsWith(repo + sep)) throw new Error('Output parent resolves inside repository');
  if (preview) {
    try { await realpath(target); throw new Error('Candidate output already exists; choose a new isolated output'); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
}
process.env.LE_BUILD_TARGET = target;
process.env.LE_BUILD_ISOLATED_REPORT = output ? '1' : '0';
const ownedStyles = join(import.meta.dirname, 'styles');
const endpointConfig = runtimeConfig(mode);
const productRoutes = JSON.parse(await readFile(join(import.meta.dirname, 'product-routes.json'), 'utf8'));
// Multiple saved URLs for one product must resolve to a single primary URL.
const productCanonicals = new Map();
for (const route of productRoutes) {
  const key = `${route.kind}:${route.id}`, canonical = canonicalPath(route.path);
  if (productCanonicals.has(key) && productCanonicals.get(key) !== canonical) throw new Error(`Conflicting product canonicals: ${key}`);
  if (!productRoutes.some(primary => pagePath(primary.path) === canonical && primary.kind === route.kind && primary.id === route.id)) throw new Error(`Canonical changes product identity: ${route.path}`);
  productCanonicals.set(key, canonical);
}
const feedByGid = { '0': 'trees.csv', '500105078': 'decor.csv', '301234033': 'promos.csv' };
const headingByRoute = new Map([
  ['/', 'ia8a1z4nc_0'], ['/main', 'ia8a1z4nc_0'],
  ['/catalog', 'ivecjsoy8_0'], ['/catalog/landscape-gardening', 'iqa3bsbmh_0'],
  ['/catalog-tree', 'id9eyp3pd_0'], ['/catalog-decor', 'id9eyp3pd_0'], ['/catalog-tree-1', 'id9eyp3pd_0'],
  ['/blog', 'i1h9sd9le_0'],
  ['/blog/iskusstvennaya-yelka-cena-i-chto-na-nee-vliyaet', 'icduoufky_0'],
  ['/blog/novogodnie-iskusstvennye-yelki-kak-vybrat-idealnuyu-yelku-dlya-doma-na-dolgie-gody', 'icduoufky_0'],
  ['/decor', 'iof93hzbx_0'], ['/o-nas', 'i2yh2hjdd_0'], ['/partneram', 'iifu7bqeq_0'],
  ['/oferta', 'imro0g6q3_0'], ['/privacy', 'i6r9fw1g2_0'], ['/person', 'i6r9fw1g2_0'], ['/spasibo', 'iy1bn6jzc_0'],
  ['/testy', 'ivecjsoy8_0'],
]);

function semanticHeading(html, id) {
  const open = new RegExp(`<div\\b[^>]*\\bid=['"]${id}['"][^>]*>`).exec(html);
  if (!open) throw new Error(`Visible heading ${id} not found`);
  const start = open.index + open[0].length;
  const tags = /<\/?div\b[^>]*>/g;
  tags.lastIndex = start;
  let depth = 1;
  let close;
  for (let tag; (tag = tags.exec(html));) {
    depth += tag[0].startsWith('</') ? -1 : 1;
    if (!depth) { close = tag; break; }
  }
  if (!close) throw new Error(`Visible heading ${id} has no closing tag`);
  return html.slice(0, open.index) + open[0].replace(/^<div/, '<h1').replace(/>$/, ' style="margin:0;font-weight:400">')
    + html.slice(start, close.index) + '</h1>' + html.slice(close.index + close[0].length);
}
await rm(target, { recursive: true, force: true });
await cp(source, target, { recursive: true, mode: cloneMode });
await copyFile(join(ownedStyles, 'legal-documents.css'), join(target, 'f/legal-documents.css'));
// The original forms link to /person, but the original URL returns 404.
// Keep its address with an explicit placeholder in the captured document layout.
let personHtml = await readFile(join(source, 'privacy.html'), 'utf8');
const legalOpening = /<div\b[^>]*\bclass=['"][^'"]*\btt-rich-text\b[^'"]*['"][^>]*>/.exec(personHtml);
if (!legalOpening) throw new Error('Privacy document layout is missing');
personHtml = personHtml.slice(0, legalOpening.index + legalOpening[0].length)
  + await readFile(join(import.meta.dirname, 'components/person-document.html'), 'utf8')
  + '</div>' + personHtml.slice(endOfDiv(personHtml, legalOpening));
personHtml = personHtml.replace(/<title>[\s\S]*?<\/title>/i, '<title>Согласие на обработку персональных данных</title>')
  .replace(/(<div\b[^>]*\bid=['"](?:i6r9fw1g2|i9tcq3pwl)_0['"][^>]*>\s*<span\b[^>]*>)[\s\S]*?(<\/span>)/g,
    '$1Согласие на обработку персональных данных$2');
await writeFile(join(target, 'person.html'), personHtml);
await copyFile(join(import.meta.dirname, 'product-routes.json'), join(target, 'product-routes.json'));
const blogRecords = await buildBlog(blogSnapshot, { source, target });
// Candidate preview reads its bundled feeds; the same endpoints go into build-manifest.json (checked by server.mjs --root).
// Runtime and HTML share guarded bundled data; autosync updates the whole artifact.
const thumbnails = await buildThumbnails(target, await pinnedPreviewMedia());
setPreviewImages(thumbnails);
const artifactEndpoints = (preview || active) ? { ...endpointConfig, thumbnails, mediaMap: '/media/catalog-pinned/map.json', catalog: Object.fromEntries(['trees', 'decor', 'promos'].map(name => [name, `/__offline/catalog/${name}.csv`])) }
  : { ...endpointConfig, mediaMap: '/media/catalog-pinned/map.json' };
await writeFile(join(target, 'f', 'storefront-config.js'), `window.__LE_STOREFRONT_CONFIG__=${JSON.stringify(artifactEndpoints)};\n`);
await mkdir(join(target, 'media/catalog-pinned'), { recursive: true });
for (const [url, file] of await pinnedPreviewMedia()) await copyFile(file, join(target, url.replace(/^\//, '')), cloneMode);
await writeFile(join(target, 'media/catalog-pinned/map.json'), JSON.stringify(Object.fromEntries([...(preview || active).mapping].map(([raw, entry]) => [raw, entry.url]))));
if (active) {
  await writeFile(join(target, 'media/catalog-pinned/map.json'), JSON.stringify(Object.fromEntries([...active.mapping].map(([raw, entry]) => [raw, entry.url]))));
  const feeds = Object.fromEntries(['trees', 'decor', 'promos'].map(name => [name, { sha256: snapshot.feeds[name].sha256, records: snapshot.feeds[name].records, receivedAt: snapshot.feeds[name].receivedAt }]));
  await writeFile(join(target, 'catalog-snapshot.json'), JSON.stringify({ schemaVersion: 1, id: snapshot.id, acceptance: active.acceptance.kind,
    feedsSha256: createHash('sha256').update(['trees', 'decor', 'promos'].map(name => feeds[name].sha256).join('\n')).digest('hex'), feeds, mediaSha256: active.mediaSha256, builtAt: new Date().toISOString(), mode }, null, 2) + '\n');
}
if (preview || active) {
  await mkdir(join(target, '__offline/catalog'), { recursive: true });
  for (const name of ['trees', 'decor', 'promos']) {
    const rows = await loadFeed(name);
    const fields = rows.length ? Object.keys(rows[0]) : parseCSV(await readFeedText(name))[0];
    const quote = value => '"' + String(value ?? '').replaceAll('"', '""') + '"';
    await writeFile(join(target, '__offline/catalog', `${name}.csv`), [fields.map(quote).join(','), ...rows.map(row => fields.map(key => quote(row[key])).join(','))].join('\n'));
  }
}
await cp(join(import.meta.dirname, 'assets', 'widgets'), join(target, 'f', 'widgets'), { recursive: true });

const cartSource = await readFile(join(source, 'index.html'), 'utf8');
const cartOpening = /<div\b[^>]*data-cart-popup[^>]*>/.exec(cartSource);
if (!cartOpening) throw new Error('Owned cart template is missing');
const cartTemplate = cartSource.slice(cartOpening.index, endOfDiv(cartSource, cartOpening));
const styleBundles = new Map();
async function ownStylesAndScripts(html) {
  html = annotateLeadForms(applyAvailabilityTimeStyle(html));
  // Header cart links exist on content/search pages whose captures omit the
  // popup. Reuse the approved cart component and its owned stylesheet.
  if (/\bdata-cart-open(?:\s|[=>])/.test(html) && !/data-cart-popup/.test(html)) {
    html = html.replace(/<body[^>]*>/i, tag => tag + cartTemplate)
      .replace(/<\/head>/i, '<link rel="stylesheet" href="/t/v2164/images/mosaic/symbols/symbol-ier1m2br4_styles.css"></head>');
  }
  // A hash action resolves against the site-wide <base href="/"> and sends
  // nested-page forms to the home page when the runtime is unavailable. Let
  // native fallback target the current document instead.
  html = html.replace(/<form\b[^>]*>/gi, opening => opening.replace(/\saction=(['"])#\1/i, ''));
  // Modal dispatch is owned source markup, including the copied cart component.
  if (/\bdata-action-element\b/.test(html)) throw new Error('Legacy modal action attribute');
  const modalIds = new Set([...html.matchAll(/<[^>]+\bid=['"]([^'"]+)['"][^>]*>/g)]
    .filter(match => /\bclass=['"][^'"]*\bpop-up\b/.test(match[0])).map(match => match[1]));
  for (const tag of html.matchAll(/<[^>]*\bdata-modal-(?:open|close)=[^>]*>/g)) {
    const hooks = [...tag[0].matchAll(/\bdata-modal-(open|close)=['"]([^'"]*)['"]/g)];
    if (hooks.length !== 1 || !modalIds.has(hooks[0][2])) throw new Error('Modal template: expected one valid target');
  }
  const styles = [];
  html = html.replace(/<link\b[^>]*href=['"](\/(?:g\/s3\/mosaic\/css\/[^'"?]+|t\/v2164\/images\/mosaic\/[^'"?]+\.css))['"][^>]*>/gi,
    (tag, url) => { styles.push(url); return ''; });
  if (styles.length) {
    const key = createHash('sha256').update(styles.join('\n')).digest('hex').slice(0, 12);
    if (!styleBundles.has(key)) {
      const chunks = [];
      for (const url of styles) {
        let file;
        if (url.endsWith('tt_default_styles.css')) file = join(ownedStyles, 'base', 'default.css');
        else if (url.endsWith('ms_site_default.css')) file = join(ownedStyles, 'base', 'site.css');
        else if (url.endsWith('/designs/4/shared-design-styles.css')) file = join(ownedStyles, 'designs', 'four-shared-design-styles.css');
        else if (url.endsWith('/designs/shared-design-styles.css')) file = join(ownedStyles, 'designs', 'root-shared-design-styles.css');
        else if (url.includes('/symbols/')) file = join(ownedStyles, 'symbols', url.split('/').at(-1));
        else file = join(ownedStyles, 'designs', url.split('/').at(-1));
        chunks.push((await readFile(file, 'utf8')).replaceAll('/g/s3/mosaic/images/widgets/', '/f/widgets/'));
      }
      await writeFile(join(target, 'f', `site-${key}.css`), chunks.join('\n'));
      styleBundles.set(key, true);
    }
    html = html.replace(/<\/head>/i, `<link rel="stylesheet" href="/f/site-${key}.css"></head>`);
  }
  html = html.replace(/<script\b[^>]*id=['"]data_do_json['"][^>]*>[\s\S]*?<\/script>/gi, '');
  // Captured HTML is a template, never a source of executable behavior. Keep
  // structured SEO/product data and explicit owned entrypoints only. This also
  // removes old fast-search, observer/filter/payment helpers and text patchers.
  const needsApprovedSwap = html.includes('function swapVivianAndBetty');
  const ownedScripts = new Set(['/f/storefront-config.js', '/local-guard.js', '/f/catalog.js', '/search.js']);
  const emittedScripts = new Set();
  html = html.replace(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi, (tag, attrs) => {
    if (/\btype=['"]application\/(?:ld\+json|json)['"]/i.test(attrs)) return tag;
    const src = /\bsrc=['"]([^'"]+)['"]/i.exec(attrs)?.[1]?.split('?')[0];
    if (emittedScripts.has(src)) return '';
    emittedScripts.add(src);
    return ownedScripts.has(src) ? `<script src="${src}"${src === '/f/storefront-config.js' || src === '/local-guard.js' ? '' : ' defer'}></script>` : '';
  });
  // Cart state supplies items/total; captured form fields are obsolete and must
  // disappear with their error/metadata wrappers, rather than be CSS-hidden.
  const fields = [...html.matchAll(/<div\b[^>]*class=['"][^'"]*\bform__field\b[^'"]*['"][^>]*>/g)];
  const removals = [];
  for (const field of fields) {
    const tags = /<\/?div\b[^>]*>/g;
    tags.lastIndex = field.index + field[0].length;
    let depth = 1;
    for (let tag; (tag = tags.exec(html));) {
      depth += tag[0].startsWith('</') ? -1 : 1;
      if (!depth) {
        if (/<input\b[^>]*placeholder=['"](?:Товар|Общая сумма)['"]/i.test(html.slice(field.index, tags.lastIndex))) removals.push([field.index, tags.lastIndex]);
        break;
      }
    }
  }
  for (const [start, end] of removals.reverse()) html = html.slice(0, start) + html.slice(end);
  // Source templates own their checkout contract. Validate without repairing it.
  html = html.replace(/<form\b[^>]*>[\s\S]*?<\/form>/gi, form => {
    if (!/data-pay-now/.test(form)) return form;
    const fields = ['name', 'email', 'phone', 'address', 'contactPref', 'comment', 'paymentMethod', 'consent'];
    const controls = [...form.matchAll(/<(?:input|select|textarea)\b[^>]*>/g)];
    for (const field of fields) {
      const matches = controls.filter(control => new RegExp(`data-checkout-field=["']${field}["']`).test(control[0]));
      if (matches.length !== 1) throw new Error(`Checkout template hook ${field}: expected exactly one`);
    }
    if ([...form.matchAll(/\bdata-checkout-field=/g)].length !== fields.length)
      throw new Error('Checkout template: unexpected hook');
    const payment = /<select\b[^>]*data-checkout-field=["']paymentMethod["'][^>]*>([\s\S]*?)<\/select>/.exec(form);
    const values = payment && [...payment[1].matchAll(/<option\b[^>]*\bvalue=["']([^"']*)["'][^>]*>/g)].map(option => option[1]);
    if (!values || values.length !== 2 || values[0] !== 'card' || values[1] !== 'cash_on_delivery' || [...payment[1].matchAll(/<option\b/g)].length !== 2)
      throw new Error('Checkout template paymentMethod: expected owned values');
    return form;
  });
  html = html.replace(/\sdata-s3-anketa-id=['"][^'"]*['"]/g, '')
    .replace(/<div\b[^>]*class=['"]embed(?:\s[^'"]*)?['"][^>]*>\s*<\/div>/g, '')
    .replace(/<div\b[^>]*id=["']yandex_rtb_[^"']*["'][^>]*>\s*<\/div>/g, '');
  // The mobile menu label is template content, not a post-load text patch.
  html = html.replace(/(<a\b[^>]*href=['"]\/catalog\/landscape-gardening['"][^>]*>[\s\S]*?<span class=['"]text-block-wrap-div['"]>)([^<]*)(<\/span>)/g,
    '$1<span class="storefront-menu-desktop">$2</span><span class="storefront-menu-mobile">Ландшафтное озеленение</span>$3');
  html = html.replace(/<\/head>/i, '<style>.storefront-menu-mobile{display:none}@media(max-width:768px){.storefront-menu-desktop{display:none}.storefront-menu-mobile{display:inline}}</style></head>');
  // Preserve the approved catalog order without a DOMContentLoaded swap.
  const cards = [...html.matchAll(/<div\b[^>]*data-storefront-product=["'][^"']+["'][^>]*>/g)];
  const bounds = title => {
    const id = productRoutes.find(route => route.kind === 'tree' && route.liveTitle === title)?.id;
    const card = cards.find(card => new RegExp(`data-storefront-product=['"]${id}['"]`).test(card[0]));
    if (!card) return null;
    const tags = /<\/?div\b[^>]*>/g;
    tags.lastIndex = card.index + card[0].length;
    let depth = 1;
    for (let tag; (tag = tags.exec(html));) {
      depth += tag[0].startsWith('</') ? -1 : 1;
      if (!depth) return { start: card.index, end: tags.lastIndex };
    }
    throw new Error(`Unclosed catalog card ${title}`);
  };
  const vivian = bounds('Вивиан'), betty = bounds('Бетти');
  if (needsApprovedSwap && vivian && betty) {
    const [a, b] = [vivian, betty].sort((a, b) => a.start - b.start);
    html = html.slice(0, a.start) + html.slice(b.start, b.end) + html.slice(a.end, b.start) + html.slice(a.start, a.end) + html.slice(b.end);
  }
  if (!emittedScripts.has('/f/catalog.js')) html = html.replace(/<\/body>/i, '<script src="/f/catalog.js" defer></script></body>');
  html = html.replace(/(<div\b[^>]*data-storefront-product=["'][^"']+["'][^>]*>)/g, tag => tag.replace(/\sdata-title=["'][^"']*["']/g, ''))
    .replace(/\sdata-tt-widget-version=["'][^"']*["']/g, '');
  return html.replace(/<\/head>/i, '<link rel="stylesheet" href="/f/catalog-cards.css"></head>')
    .replace(/<\/body>/i, '<script src="/f/site-runtime.js" defer></script></body>');
}

async function walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) await walk(path);
    else if (entry.name.endsWith('.html') && entry.name !== 'index.html') {
      const html = await readFile(path, 'utf8');
      await writeFile(path, html.replace(/<head>/i, '<head><base href="/"><script src="/f/storefront-config.js"></script><script src="/local-guard.js"></script>'));
      const route = relative(target, path).slice(0, -5);
      const index = join(target, route, 'index.html');
      await mkdir(dirname(index), { recursive: true });
      await copyFile(path, index);
    }
  }
}
await walk(target);
// The captured site contains a literal filename with a query suffix. Browsers request
// /f/catalog.js with ?v=11; only the newly bundled file belongs in the output.
await rm(join(target, 'f', 'catalog.js?v=11'), { force: true });
const home = join(target, 'index.html');
await writeFile(home, (await readFile(home, 'utf8')).replace(/<head>/i, '<head><base href="/"><script src="/f/storefront-config.js"></script><script src="/local-guard.js"></script>'));
await esbuild.build({ entryPoints: [join(import.meta.dirname, 'client', 'index.js')],
  bundle: true, external: ['/f/checkout-demand.js'], format: 'iife', target: ['es2019'], charset: 'utf8', legalComments: 'none',
  outfile: join(target, 'f', 'catalog.js'), logLevel: 'silent' });
await esbuild.build({ entryPoints: [join(source, '..', '..', 'src', 'styles', 'catalog.css')],
  bundle: true, charset: 'utf8', outfile: join(target, 'f', 'catalog.css'), logLevel: 'silent' });
await esbuild.build({ entryPoints: [join(import.meta.dirname, 'client/checkout-demand.js')],
  bundle: true, format: 'esm', target: ['es2019'], charset: 'utf8', legalComments: 'none',
  outfile: join(target, 'f/checkout-demand.js'), logLevel: 'silent' });
await import('./generate-products.mjs');
await import('./products/catalog-cards.mjs');
// /testy retains its captured layout but uses the same generated Product cards
// as the public catalogs; no second renderer or snapshot DOM hydration.
function endOfDiv(html, opening) {
  const tags = /<\/?div\b[^>]*>/g;
  tags.lastIndex = opening.index + opening[0].length;
  let depth = 1;
  for (let tag; (tag = tags.exec(html));) {
    depth += tag[0].startsWith('</') ? -1 : 1;
    if (!depth) return tags.lastIndex;
  }
  throw new Error('Unclosed card in route template');
}

function applyAvailabilityTimeStyle(html) {
  const blocks = [...html.matchAll(/<div\b[^>]*class=['"][^'"]*\btime__work\b[^'"]*['"][^>]*>/gi)];
  for (const opening of blocks.reverse()) {
    const end = endOfDiv(html, opening);
    let block = html.slice(opening.index, end);
    if (!/ежедневно/i.test(block) || !block.includes('с 08:00') || !block.includes('до 22:00')) continue;
    block = block.replace(/<div\b[^>]*class=['"][^'"]*\bdot-online__work\b[^'"]*['"][^>]*>\s*<div\b[^>]*class=['"][^'"]*\bdot-online-active__work\b[^'"]*['"][^>]*>\s*<\/div>\s*<\/div>/i, '');
    block = block.replace(/<span\b([^>]*\bclass=['"])([^'"]*\btext-block-wrap-div\b[^'"]*)(['"][^>]*)>/i,
      (_, beforeClass, classes, afterClass) => `<span${beforeClass}${classes.includes(' time') ? classes : `${classes} time`}${afterClass}>`);
    html = html.slice(0, opening.index) + block + html.slice(end);
  }
  return html;
}
const socialLogoSpecs = {
  max: {
    src: '/f/widgets/social/max.svg',
    alt: 'Логотип Max',
  },
  telegram: {
    src: '/f/widgets/social/telegram.svg',
    alt: 'Логотип Telegram',
  },
  whatsapp: {
    src: '/f/widgets/social/whatsapp.svg',
    alt: 'Логотип WhatsApp',
  },
  instagram: {
    src: '/f/widgets/social/instagram.svg',
    alt: 'Логотип Instagram',
  },
  youtube: {
    src: '/f/widgets/social/youtube.svg',
    alt: 'Логотип YouTube',
  },
};
function setMarkupAttribute(tag, name, value) {
  if (!new RegExp(`\\s${name}=`).test(tag)) return tag.replace(/\s*\/?\>$/, ` ${name}="${value}">`);
  return tag.replace(
    new RegExp(`(\\b${name}=)(['"])[^'"]*\\2`, 'i'),
    (_, prefix, quote) => `${prefix}${quote}${value}${quote}`,
  );
}
function rewriteSocialLogoSources(html) {
  return html.replace(/<a\b(?=[^>]*\bclass=['"][^'"]*\bsocial__footer\b[^'"]*['"])[^>]*>[\s\S]*?<\/a>/gi, anchor => {
    const image = /<img\b[^>]*>/i.exec(anchor)?.[0];
    const originalAlt = image && /\balt=(['"])(.*?)\1/i.exec(image)?.[2].toLowerCase().replace(/^логотип\s+/, '');
    const spec = socialLogoSpecs[originalAlt];
    if (!spec) return anchor;
    return anchor.replace(/<img\b[^>]*>/i, tag => {
      tag = setMarkupAttribute(tag, 'src', spec.src);
      if (/\bdata-origin-src=/.test(tag)) tag = setMarkupAttribute(tag, 'data-origin-src', spec.src);
      return setMarkupAttribute(tag, 'alt', spec.alt);
    });
  });
}
function rewriteMadeInRussiaLogo(html) {
  const imageSource = '/f/widgets/social/made-in-russia-full.svg';
  return html.replace(/<div\b[^>]*\bmade-in-ru__img\b[^>]*>[\s\S]*?<\/div>/gi, wrapper =>
    wrapper.replace(/<img\b[^>]*\balt=(['"])сделано в россии\1[^>]*>/i, image => {
      image = setMarkupAttribute(image, 'src', imageSource);
      image = setMarkupAttribute(image, 'data-origin-src', imageSource);
      image = setMarkupAttribute(image, 'alt', 'Логотип Сделано в России');
      return image;
    }),
  );
}
const generatedTreeCards = new Map();
for (const route of ['catalog', 'catalog/landscape-gardening', 'catalog-tree']) {
  const html = await readFile(join(target, route, 'index.html'), 'utf8');
  for (const opening of html.matchAll(/<div\b[^>]*data-storefront-product="([^"]+)"[^>]*>/g)) {
    generatedTreeCards.set(`${route === 'catalog-tree' ? 'decor' : 'tree'}:${opening[1]}`, html.slice(opening.index + opening[0].length, endOfDiv(html, opening)));
  }
}
const testPage = join(target, 'testy', 'index.html');
let testHtml = await readFile(testPage, 'utf8');
const testCards = [...testHtml.matchAll(/<div\b[^>]*class=['"][^'"]*\bproduct-card\b[^'"]*['"][^>]*>/g)];
for (const opening of testCards.reverse()) {
  const end = endOfDiv(testHtml, opening);
  const original = testHtml.slice(opening.index, end);
  const kind = /data-product-id-decor=/.test(original) ? 'decor' : 'tree';
  const id = new RegExp(`<div\\b[^>]*data-product-id${kind === 'decor' ? '-decor' : ''}=[^>]*>\\s*<span[^>]*>([^<]+)<\\/span>`).exec(original)?.[1]?.trim();
  if (!productRoutes.some(route => route.kind === kind && route.id === id)) throw new Error(`Unknown testy card ${id}`);
  const content = generatedTreeCards.get(`${kind}:${id}`);
  const root = opening[0].replace(/\s(?:data-tt-collection-item-id|data-title)=(?:"[^"]*"|'[^']*')/g, '').replace(/>$/, ` data-storefront-product="${id}">`);
  testHtml = testHtml.slice(0, opening.index) + (content ? root + content : '') + testHtml.slice(end);
}
await writeFile(testPage, testHtml);
await writeFile(join(target, 'sitemap.xml'), extendSitemap(await readFile(join(source, '..', 'build-inputs', 'original-sitemap.xml'), 'utf8'), blogRecords));
const resolvedRoutes = await buildRoutes(), autoRoutes = resolvedRoutes.filter(route => route.auto);
if (autoRoutes.length) {
  const sitemapFile = join(target, 'sitemap.xml');
  await writeFile(sitemapFile, (await readFile(sitemapFile, 'utf8')).replace('</urlset>', autoRoutes.map(route => `<url><loc>https://lady-elka.ru${route.path}</loc></url>`).join('\n') + '\n</urlset>'));
  console.log(`Auto product routes (new in cabinet): ${autoRoutes.map(route => route.path).join(', ')}`);
}
await writeFile(join(target, 'product-routes.json'), JSON.stringify(resolvedRoutes, null, 2) + '\n');
await (await import('./build-search.mjs')).buildSearch(blogRecords);
await writeFile(join(target, 'robots.txt'), (await readFile(join(source, '..', 'build-inputs', 'original-robots.txt'), 'utf8'))
  .replaceAll('sitemap.7820685.xml.gz', 'sitemap.xml'));

async function removeLiveCounters(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) await removeLiveCounters(path);
    else if (entry.name.endsWith('.html')) {
      let html = await readFile(path, 'utf8');
      for (const [marker, component] of sharedComponents) html = html.replaceAll(marker, component);
      if (entry.name === 'index.html' && !/<link[^>]+rel=["']canonical["']/i.test(html)) {
        const route = relative(target, dirname(path)).split('\\').join('/');
        const pathname = route === '' ? '/' : '/' + route;
        const canonicalPath = new Map([['/main', '/'], ['/catalog-decor', '/catalog-tree']]).get(pathname) || pathname;
        html = html.replace(/<\/head>/i, `<link rel="canonical" href="https://lady-elka.ru${canonicalPath}"></head>`);
      }
      if (entry.name === 'index.html') {
        const route = relative(target, dirname(path)).split('\\').join('/');
        const headingId = headingByRoute.get(route ? '/' + route : '/');
        if (headingId) html = semanticHeading(html, headingId);
      }
      html = html.replace(/<!-- Yandex Autoplacement[^]*?<script[^>]*src="https:\/\/yandex\.ru\/ads\/system\/ap-loader\.js"[^>]*><\/script>/, '')
        .replace(/<!-- Yandex\.Metrika counter -->[^]*?<!-- \/Yandex\.Metrika counter -->/, '')
        .replace(/<script>\s*window\.yaContextCb\.push\([^]*?<\/script>/g, '')
        .replace(/<script[^>]*>\/\*<!\[CDATA\[\*\/\s*var megacounter_key=[^]*?<\/script>/, '')
        .replace(/"onetap":\[\{[^]*?\}\]/, '"onetap":[]')
        .replace(/"captcha":4/, '"captcha":0')
        .replace(/<smart-captcha\b[^>]*><\/smart-captcha>/g, '')
        .replace(/<script src=["']https:\/\/ajax\.googleapis\.com\/ajax\/libs\/webfont\/1\.6\.26\/webfont\.js["'][^>]*><\/script>/g,
          '<link rel="stylesheet" href="/f/fonts.css">')
        .replace(/<script>\s*WebFont\.load\([\s\S]*?\);\s*<\/script>/g, '')
        .replace('<!-- This site was created in Taptop. https://taptop.pro/ -->', '')
        .replace(/<meta content=["']Taptop["'] name=["']generator["']\s*\/?\s*>/, '');
      if (!/href=["']\/f\/fonts\.css(?:\?[^"']*)?["']/i.test(html)) {
        html = html.replace(/<\/head>/i, '<link rel="stylesheet" href="/f/fonts.css"></head>');
      }
      html = html.replace(/(<a\b[^>]*\bhref=)(["'])https?:\/\/(?:www\.)?lady-elka\.(?:ru|ry)\/?\2/gi,
        (_, before, quote) => `${before}${quote}/${quote}`);
      html = html.replace(/https:\/\/docs\.google\.com\/spreadsheets\/d\/e\/[^'"\s<>]+?gid=(\d+)[^'"\s<>]*?output=csv/g,
        (url, gid) => feedByGid[gid] ? endpointConfig.catalog[feedByGid[gid].replace('.csv', '')] : url);
      html = rewriteSocialLogoSources(html);
      html = rewriteMadeInRussiaLogo(html);
      html = html.replace(/src=['"]\/d\/['"]/g, "src='data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs='")
        .replace(/<link[^>]*href=['"]\/t\/v2164\/images\/mosaic\/designs\/cm-i3fjrk8yq-1756033058_styles\.css['"][^>]*>/g, '');
      html = await ownStylesAndScripts(html);
      await writeFile(path, html);
    }
  }
}
await removeLiveCounters(target);
await copyFile(join(import.meta.dirname, 'client/metrika.js'), join(target, 'f/metrika.js'));
// Failure returns must resolve on direct URL/F5 and must never claim payment.
const returnDirectory = join(target, 'pay-return');
await mkdir(returnDirectory, { recursive: true });
let returnHtml = await readFile(join(target, 'spasibo', 'index.html'), 'utf8');
returnHtml = returnHtml.replace(/<title>[\s\S]*?<\/title>/i, '<title>Оплата не завершена — Lady Elka</title>')
  .replace(/(<link\b[^>]*rel=["']canonical["'][^>]*href=["'])[^"']+(["'][^>]*>)/i, '$1https://lady-elka.ru/pay-return$2')
  .replace(/(<h1\b[^>]*>)[\s\S]*?<\/h1>/i, '$1<span class="text-block-wrap-div">Оплата не завершена</span></h1>');
returnHtml = returnHtml.replace('Мы свяжемся с вами в течении 1 часа', 'Вернитесь в корзину, чтобы продолжить оформление заказа.');
await writeFile(join(returnDirectory, 'index.html'), returnHtml);
for (const obsolete of [
  'g/libs', 'g/s3/mosaic/js', 'g/s3/mosaic/css', 'g/s3/mosaic/images/widgets',
  'assets/site',
]) await rm(join(target, obsolete), { recursive: true, force: true });
for (const dir of ['t/v2164/images/mosaic/designs', 't/v2164/images/mosaic/symbols']) {
  const directory = join(target, dir);
  for (const entry of await readdir(directory, { recursive: true, withFileTypes: true })) {
    if (entry.isFile() && entry.name.endsWith('.css')) await rm(join(entry.parentPath, entry.name));
  }
}
// Captured .html aliases must serve the same generated page as clean routes.
async function synchronizeAliases(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) await synchronizeAliases(path);
    else if (entry.name.endsWith('.html') && entry.name !== 'index.html') {
      const generated = join(path.slice(0, -5), 'index.html');
      try { await copyFile(generated, path); }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
  }
}
// Use the generated filesystem, not a blanket slash on every URL (assets and
// published blog .html files are direct file URLs).
const directoryPages = new Set((await readdir(target, { recursive: true })).filter(file => file.endsWith('/index.html')).map(file => '/' + file.slice(0, -11)));
function normalizePageURLs(html) {
  return html.replace(/(["'])(\/[^"'<>\s]*|https?:\/\/(?:www\.)?lady-elka\.ru[^"'<>\s]*)\1/g, (original, quote, value) => {
    if (!value.startsWith('/') && !/^https?:\/\/(?:www\.)?lady-elka\.ru(?:\/|$)/i.test(value)) return original;
    let url;
    try { url = new URL(value, 'https://lady-elka.ru'); } catch { return original; }
    const key = url.pathname.replace(/\/+$/, '') || '/';
    if (directoryPages.has(key) || key === '/' || canonicalPath(key) !== pagePath(key)) url.pathname = canonicalPath(key);
    else return original;
    const normalized = value.startsWith('/') ? url.pathname + url.search + url.hash : url.href;
    return quote + normalized + quote;
  });
}
const indexedTitles = new Map(), pageCanonicals = new Map();
async function finalizePages(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) await finalizePages(path);
    else if (entry.name.endsWith('.html')) {
      const route = '/' + relative(target, path).replace(/(?:\/)?index\.html$/, '').replace(/\.html$/, '').replace(/\/$/, '');
      let html = normalizePageURLs(applySEO(await readFile(path, 'utf8'), route));
      const canonical = /<link rel="canonical" href="([^"]+)">/.exec(html)?.[1];
      pageCanonicals.set(route, canonical);
      if (!/<meta name="robots" content="noindex,/i.test(html) && canonicalPath(route) === pagePath(route)) {
        const title = /<title>([\s\S]*?)<\/title>/.exec(html)?.[1];
        const previous = indexedTitles.get(title);
        if (!title || (previous && previous !== canonical)) throw new Error(`Duplicate or missing indexed title: ${title} (${previous}, ${canonical})`);
        indexedTitles.set(title, canonical);
      }
      if (['/privacy', '/oferta', '/person'].includes(route)) {
        html = html.replace(/(<section\b[^>]*\bclass=['"])([^'"]*\bcatalog\b[^'"]*)(['"])/,
          '$1$2 legal-document$3')
          .replace(/<\/head>/i, '<link rel="stylesheet" href="/f/legal-documents.css"></head>');
      }
      html = html.replace(/https:\/\/trace-logos\.ru\/assets\/logos\/svgs\/(max|telegram|whatsapp|instagram|youtube|made-in-russia-full)\.svg/g, '/f/widgets/social/$1.svg');
      html = html.replace(/<img\b[^>]*>/gi, (tag, offset) => {
        const src = /\bsrc=['"]([^'"]+)['"]/.exec(tag)?.[1];
        if (!thumbnails[src] || /product__img__cms[^>]*data-storefront-image[^>]*>\s*$/.test(html.slice(Math.max(0, offset - 300), offset))) return tag;
        const gallery = /product__img-dop__cms[^>]*>\s*$/.test(html.slice(Math.max(0, offset - 150), offset));
        for (const [name, value] of Object.entries(imagePreviewAttributes(src, gallery))) tag = setMarkupAttribute(tag, name, String(value));
        return tag;
      });
      html = html.replace(/<\/head>/i, '<script src="/f/metrika.js" defer></script></head>');
      await writeFile(path, html);
    }
  }
}
await finalizePages(target);
await synchronizeAliases(target);
const sitemap = filterSitemap(await readFile(join(target, 'sitemap.xml'), 'utf8'));
for (const [, url] of sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)) {
  const route = new URL(url).pathname.replace(/\.html$/, '').replace(/\/$/, '') || '/';
  if (pageCanonicals.get(route) !== new URL(url).href) throw new Error(`Sitemap/canonical conflict: ${url} -> ${pageCanonicals.get(route)}`);
}
await writeFile(join(target, 'sitemap.xml'), sitemap);
await (await import('./hosting/build.mjs')).buildHosting(target);
await writeFile(join(target, '404.html'), normalizePageURLs(await readFile(join(target, '404.html'), 'utf8')));
const serviceWorkerEnabled = mode === 'production' && option('service-worker') !== 'off';
if (serviceWorkerEnabled && option('service-worker') !== 'kill') {
  const runtimePath = join(target, 'f/site-runtime.js');
  await writeFile(runtimePath, (await readFile(runtimePath, 'utf8')) + '\n' + await readFile(new URL('./client/register-service-worker.js', import.meta.url), 'utf8'));
}
await (await import('./request-assets.mjs')).optimizeRequests(target);
await validateBuildAssets(target);
console.log('Static storefront built:', target);

if (preview?.ownerStatus.ownerAccepted) await copyFile(preview.ownerProvenancePath, join(target, '__offline/catalog/owner-provenance.json'));
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
let bundled = null;
if (preview || active) {
  const feeds = {};
  for (const name of ['trees', 'decor', 'promos']) {
    const path = `__offline/catalog/${name}.csv`, bytes = await readFile(join(target, path));
    feeds[name] = { path, sha256: digest(bytes), bytes: bytes.length, records: (await loadFeed(name)).length };
  }
  const assets = [];
  for (const entry of await readdir(target, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile() || !/\.(?:png|jpe?g|webp|gif|svg|ico|mp4|woff2?)$/i.test(entry.name)) continue;
    const path = relative(target, join(entry.parentPath, entry.name)).split(sep).join('/');
    const bytes = await readFile(join(target, path));
    assets.push({ path, sha256: digest(bytes), bytes: bytes.length });
  }
  assets.sort((a, b) => a.path.localeCompare(b.path));
  bundled = { feeds, assets, assetCount: assets.length, assetBytes: assets.reduce((sum, asset) => sum + asset.bytes, 0), assetInventorySha256: digest(JSON.stringify(assets)) };
}
const activeProof = active ? { manifest: snapshot, provenance: JSON.parse(await readFile(join(dirname(active.manifestPath), 'provenance.json'), 'utf8')), guardsText: active.acceptance.kind === 'owner-confirmation' ? null : await readFile(join(dirname(active.manifestPath), 'guards.json'), 'utf8') } : null;
await writeFile(join(target, 'build-manifest.json'), JSON.stringify({ mode, offlineBuild: true, bundled, candidatePreview: preview ? { mediaSha256: preview.mediaSha256, uniqueAssets: preview.mapping.size, references: preview.references, ...catalogOwnerStatus, ownerProvenanceSha256: preview.ownerProvenanceSha256, ownerProvenance: preview.ownerStatus.ownerAccepted ? { path: '__offline/catalog/owner-provenance.json', bytes: preview.ownerProvenanceBytes, sha256: preview.ownerProvenanceSha256 } : null } : null, activeSnapshot: active ? { ...activeProof, pointer: active.pointer.id, acceptance: active.acceptance, mediaSha256: active.mediaSha256, uniqueAssets: active.mapping.size, references: active.references } : null, snapshot: { source: snapshot.source, id: snapshot.id, snapshotDate: snapshot.snapshotDate, artifactGeneratedAt: snapshot.artifactGeneratedAt, dataAsOf: snapshot.dataAsOf, freshness: snapshot.freshness, feeds: snapshot.feeds }, productionReady: false, catalogNotice: catalogOwnerStatus.notice, blog: blogSnapshot ? { sha256: blogSnapshot.sha256, provenance: blogSnapshot.provenance, posts: blogRecords.length, stage: 'prepared-local-publication' } : { posts: 0, stage: 'legacy-only', source: 'no-export' }, limitations: snapshot.limitations, endpoints: artifactEndpoints }, null, 2) + '\n');

if (serviceWorkerEnabled) await (await import('./client/build-service-worker.mjs')).buildServiceWorker(target, { kill: option('service-worker') === 'kill', previous: previousAssets });
