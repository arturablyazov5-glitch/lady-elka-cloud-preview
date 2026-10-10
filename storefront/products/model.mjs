import { catalogEndpoint } from '../client/config.js';
import { pinPhotos } from './presentation.mjs';
import { csvRecords, decorProducts as rawDecorProducts, treeProducts as rawTreeProducts } from '../../supabase/functions/_shared/product-rules.mjs';

export const treeProducts = rows => rawTreeProducts(rows);
export const decorProducts = rows => rawDecorProducts(rows);

// Built artifacts publish /media/catalog-pinned/map.json (raw feed URL -> local copy). Live feeds keep prices current at
// runtime while photos stay local; a photo added after the last build stays remote until the next catalog sync.
let mediaMap;
function pinnedMedia() {
  const url = globalThis.__LE_STOREFRONT_CONFIG__?.mediaMap;
  if (!url) return Promise.resolve(null);
  mediaMap ||= fetch(url).then(response => response.ok ? response.json() : null).catch(() => null);
  return mediaMap;
}

async function loadProducts(url, filename, buildProducts) {
  const [response, map] = await Promise.all([fetch(url, { cache: 'no-store' }), pinnedMedia()]);
  if (!response.ok) throw new Error(`Supabase ${filename}: ${response.status}`);
  const rows = csvRecords(await response.text());
  return buildProducts(map ? rows.map(row => row.photos === undefined ? row : { ...row, photos: pinPhotos(row.photos, raw => map[raw], false) }) : rows);
}

export function loadTreeProducts() {
  return loadProducts(catalogEndpoint('trees'), 'trees.csv', treeProducts);
}

export function loadDecorProducts() {
  return loadProducts(catalogEndpoint('decor'), 'decor.csv', decorProducts);
}
