// Product URL map for a build: saved public routes (product-routes.json) plus automatic routes for products that were
// added in the cabinet after the routes were captured. Saved routes never change; a product that disappears from the
// feed keeps its URL and is rendered as unavailable instead of failing the build.
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

const letters = { а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'ye', ж: 'zh', з: 'z', и: 'i', й: 'j', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'c', ч: 'ch', ш: 'sh', щ: 'shch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya' };
export function slugify(title) {
  return [...String(title || '').toLowerCase()].map(char => letters[char] ?? char).join('')
    .replace(/[^a-z0-9.]+/g, '-').replace(/^[-.]+|[-.]+$/g, '').replace(/-{2,}/g, '-').slice(0, 80);
}

export const savedRoutes = async root => JSON.parse(await readFile(join(root, 'product-routes.json'), 'utf8'));

// products: {tree: Map(id -> product), decor: Map(id -> product)} from model.treeProducts/decorProducts.
export function resolveRoutes(saved, products) {
  const routes = saved.map(route => ({ ...route }));
  const taken = new Set(routes.map(route => route.path));
  const known = new Set(routes.map(route => `${route.kind}:${route.id}`));
  for (const kind of ['tree', 'decor']) {
    for (const product of products[kind]?.values() || []) {
      if (known.has(`${kind}:${product.id}`) || !product.variants.length) continue;
      const landscape = kind === 'tree' && product.variants.some(v => /туя|можжевельник|кипарисовик/i.test(v.category));
      const slug = slugify(product.title) || `product-${slugify(product.id)}`;
      const base = `${kind === 'tree' ? '/tree' : '/catalog-tree'}/${landscape && !slug.startsWith('tuya-') ? 'tuya-' : ''}${slug}`;
      let path = base;
      for (let n = 2; taken.has(path); n++) path = `${base}-${n}`;
      taken.add(path);
      known.add(`${kind}:${product.id}`);
      routes.push({ path, id: String(product.id), kind, liveTitle: product.title, liveDescription: '', richTextHtml: '', auto: true });
    }
  }
  return routes;
}

export const isLandscapePath = path => /^\/tree\/(?:tuya-|mozhzhevelnik$|kiparisovik$)/.test(path);

// Routes for the current build: saved + auto routes recorded with the snapshot (stable URLs across title edits) + new ones.
let memo;
export function buildRoutes() {
  memo ||= (async () => {
    const { loadFeed, readManifest } = await import('./build-feed.mjs');
    const { treeProducts, decorProducts } = await import('./model.mjs');
    const { dirname } = await import('node:path');
    const manifest = await readManifest();
    let recorded = [];
    try { recorded = JSON.parse(await readFile(join(dirname(manifest.manifestPath), 'auto-routes.json'), 'utf8')); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    const saved = await savedRoutes(join(import.meta.dirname, '..'));
    const savedKeys = new Set(saved.map(route => `${route.kind}:${route.id}`)), savedPaths = new Set(saved.map(route => route.path));
    const carried = recorded.filter(route => route.auto && !savedKeys.has(`${route.kind}:${route.id}`) && !savedPaths.has(route.path));
    const products = { tree: treeProducts(await loadFeed('trees')), decor: decorProducts(await loadFeed('decor')) };
    // A carried auto route is kept while its product exists in the feed (hidden products render as unavailable).
    const live = carried;
    return resolveRoutes([...saved, ...live], products);
  })();
  return memo;
}
