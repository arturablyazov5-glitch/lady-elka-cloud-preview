import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { treeProducts, decorProducts } from './model.mjs';
import { loadFeed } from './build-feed.mjs';
import { cardHtml, decorCardHtml, setImageSizeResolver } from './card-renderer.mjs';
import { localImageSize } from './image-size.mjs';
import { buildRoutes, isLandscapePath } from './routes.mjs';

const root = join(import.meta.dirname, '..');
const routes = await buildRoutes();
const routeById = new Map(routes.filter(route => route.kind === 'tree').map(route => [route.id, route]));
const products = treeProducts(await loadFeed('trees'));
const decor = decorProducts(await loadFeed('decor'));
const buildRoot = process.env.LE_BUILD_TARGET || join(root, 'dist');
setImageSizeResolver(url => localImageSize(url, buildRoot));
// Catalog pages: the first row of cards is above the fold (LCP candidate), the rest load lazily.
const EAGER_CARDS = 3;
function eagerFirstCards(html) {
  let index = 0;
  return html.replace(/(<div\b[^>]*data-storefront-image[^>]*>)(<img\b[^>]*>)/g, (match, container, image) => {
    if (index++ >= EAGER_CARDS) return match;
    return container + image.replace(/\sloading="lazy"/, '').replace(/\sdecoding="async"/, index === 1 ? ' fetchpriority="high" decoding="async"' : ' decoding="async"');
  });
}

function closingDiv(html, from) {
  const tags = /<\/?div\b[^>]*>/g;
  tags.lastIndex = from;
  let depth = 1;
  for (let tag; (tag = tags.exec(html));) {
    depth += tag[0].startsWith('</') ? -1 : 1;
    if (!depth) return tags.lastIndex;
  }
  throw new Error('Unclosed catalog card');
}

for (const path of ['catalog', 'catalog/landscape-gardening', 'catalog-tree', '', 'main', 'catalog-decor', 'catalog-tree-1']) {
  const file = join(process.env.LE_BUILD_TARGET || join(root, 'dist'), path, 'index.html');
  const html = await readFile(file, 'utf8');
  const starts = [...html.matchAll(/<div\b[^>]*\bclass=['"][^'"]*\bproduct-card\b[^'"]*['"][^>]*>/g)];
  let result = '';
  let cursor = 0;
  let generated = 0, lastEnd = 0, template = null;
  const shown = new Set();
  for (const start of starts) {
    if (start.index < cursor) continue;
    const end = closingDiv(html, start.index + start[0].length);
    const original = html.slice(start.index, end);
    const isDecor = ['catalog-tree', 'catalog-decor', 'catalog-tree-1'].includes(path);
    const id = new RegExp(`<div\\b[^>]*data-product-id${isDecor ? '-decor' : ''}\\b[^>]*>\\s*<span[^>]*>([^<]+)<\\/span>`).exec(original)?.[1]?.trim();
    const product = (isDecor ? decor : products).get(id);
    const route = isDecor ? routes.find(item => item.kind === 'decor' && item.id === id) : routeById.get(id);
    if (!id || !route) throw new Error(`Catalog card has no Snapshot product/route: ${id || start.index}`);
    if (!template) template = { opening: start[0], html: original, isDecor };
    result += html.slice(cursor, start.index);
    // Deleted (absent) or fully inactive products disappear from the list, as in the live catalog-sync.
    result += product?.variants.length ? (isDecor ? decorCardHtml(start[0], product, route, original) : cardHtml(start[0], product, route, original)) : '';
    if (product) shown.add(id);
    cursor = end;
    lastEnd = result.length;
    generated++;
  }
  if (!generated) throw new Error(`No catalog cards found: ${path}`);
  // Products added in the cabinet after the template capture: append to the same list (same rules as client catalog-sync).
  const landscapePage = path === 'catalog/landscape-gardening', decorPage = ['catalog-tree', 'catalog-decor', 'catalog-tree-1'].includes(path);
  const appended = [];
  if (['', 'main', 'catalog', 'catalog/landscape-gardening', 'catalog-tree', 'catalog-decor', 'catalog-tree-1'].includes(path)) {
    for (const product of (decorPage ? decor : products).values()) {
      const route = routes.find(item => item.kind === (decorPage ? 'decor' : 'tree') && item.id === product.id);
      if (!route || shown.has(product.id) || !product.variants.length) continue;
      if (!decorPage && landscapePage !== isLandscapePath(route.path)) continue;
      appended.push(template.isDecor ? decorCardHtml(template.opening, product, route, template.html) : cardHtml(template.opening, product, route, template.html));
    }
  }
  result = result.slice(0, lastEnd) + appended.join('') + result.slice(lastEnd) + html.slice(cursor);
  if (appended.length) console.log(`${path}: ${appended.length} new catalog cards appended`);
  if (['catalog', 'catalog/landscape-gardening', 'catalog-tree', 'catalog-decor', 'catalog-tree-1'].includes(path)) result = eagerFirstCards(result);
  await writeFile(file, result);
  console.log(`${path}: ${generated} catalog cards generated from offline snapshot`);
}
