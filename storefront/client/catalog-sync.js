import { loadTreeProducts, loadDecorProducts } from '../products/model.mjs';
import { cardHtml, decorCardHtml } from '../products/card-renderer.mjs';
import { jsonForHtml, presentProduct } from '../products/presentation.mjs';
import { initProducts } from './product-ui.js';

let liveProducts;
let productRoutes;
function loadLiveProducts() {
  if (!liveProducts) liveProducts = Promise.all([loadTreeProducts(), loadDecorProducts()]);
  return liveProducts;
}

function loadProductRoutes() {
  if (!productRoutes) productRoutes = fetch('/product-routes.json', { cache: 'no-store' })
    .then(response => response.ok ? response.json() : [])
    .catch(() => []);
  return productRoutes;
}

const productId = product => String(product.id);

function rootOpening(card) {
  return /^<div\b[^>]*>/i.exec(card.outerHTML)?.[0] || '';
}

function detailProduct() {
  const script = document.querySelector('[data-storefront-page-product]');
  if (!script) return null;
  try { return { script, product: JSON.parse(script.textContent) }; }
  catch { return null; }
}

async function syncFromSupabase() {
  const cards = [...document.querySelectorAll('[data-storefront-product]')]
    .filter(card => card.querySelector('[data-storefront-variants]'));
  const detail = detailProduct();
  if (!cards.length && !detail) return;

  const [products, routes] = await Promise.all([loadLiveProducts(), loadProductRoutes()]);
  const [trees, decor] = products;
  const byKind = { tree: trees, decor };

  if (detail) {
    const kind = detail.product.kind;
    const source = byKind[kind]?.get(productId(detail.product));
    if (source?.variants.length) {
      const view = presentProduct(source, { kind, path: location.pathname, liveTitle: source.title });
      detail.script.textContent = jsonForHtml(view);
    }
  }

  const existingIds = new Set();
  const templateCard = cards[0] || document.querySelector('.collection__list.list__catalog [data-storefront-product]');
  const templateOpening = templateCard ? rootOpening(templateCard) : '';
  const templateHtml = templateCard?.outerHTML || '';
  const cardList = templateCard?.parentElement || document.querySelector('.collection__list.list__catalog');
  for (const card of cards) {
    const data = card.querySelector('[data-storefront-variants]');
    let previous;
    try { previous = JSON.parse(data.textContent); } catch { card.remove(); continue; }
    const kind = previous.kind || 'tree';
    existingIds.add(`${kind}:${String(previous.id)}`);
    const source = byKind[kind]?.get(productId(previous));
    if (!source?.variants.length) { card.remove(); continue; }
    const opening = rootOpening(card);
    if (!opening) { card.remove(); continue; }
    const path = card.querySelector('a.stroke-catalog__button[href]')?.getAttribute('href') || '/catalog/';
    const route = { id: source.id, kind, path, liveTitle: source.title };
    const template = card.outerHTML;
    const html = kind === 'decor'
      ? decorCardHtml(opening, source, route, template)
      : cardHtml(opening, source, route, template);
    const holder = document.createElement('template');
    holder.innerHTML = html.trim();
    const updated = holder.content.firstElementChild;
    if (updated) card.replaceWith(updated);
  }

  const pathname = location.pathname.replace(/\/+$/, '') || '/';
  const landscapePage = pathname === '/catalog/landscape-gardening';
  const standardCatalogPage = pathname === '/' || pathname === '/main' || pathname === '/catalog';
  const decorPage = ['/catalog-tree', '/catalog-decor', '/catalog-tree-1'].includes(pathname);
  if (cardList && templateOpening && templateHtml && (landscapePage || standardCatalogPage || decorPage)) {
    const kind = decorPage ? 'decor' : 'tree';
    const activeProducts = [...byKind[kind].values()].filter(product => product.variants.length);
    for (const source of activeProducts) {
      const route = routes.find(item => item.kind === kind && String(item.id) === String(source.id));
      if (!route || existingIds.has(`${kind}:${String(source.id)}`)) continue;
      const isLandscape = /^\/tree\/(?:tuya-|mozhzhevelnik$|kiparisovik$)/.test(route.path);
      if ((landscapePage && !isLandscape) || (standardCatalogPage && (kind === 'decor' || isLandscape)) || (decorPage && kind !== 'decor')) continue;
      const html = kind === 'decor'
        ? decorCardHtml(templateOpening, source, route, templateHtml)
        : cardHtml(templateOpening, source, route, templateHtml);
      const holder = document.createElement('template');
      holder.innerHTML = html.trim();
      const updated = holder.content.firstElementChild;
      if (updated) cardList.append(updated);
    }
  }

  initProducts();
}

export function initCatalogSync() {
  const initialLoad = syncFromSupabase().catch(error => console.error('Supabase catalog could not be loaded', error));
  document.addEventListener('storefront:products-added', () => {
    void syncFromSupabase().catch(error => console.error('Supabase catalog could not be loaded', error));
  });
  return initialLoad;
}
