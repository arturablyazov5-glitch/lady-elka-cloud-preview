// Automated acceptance checks that replace a manual owner confirmation for every catalog update.
// blocked → nothing is published, the previous snapshot stays active; warnings → published, owner is notified.
import { validateCSV } from '../../storefront/catalog-import/import.mjs';
import { parseCSV, isCatalogActive, normalizePromoCode, treeProducts, decorProducts } from '../../supabase/functions/_shared/product-rules.mjs';
import { catalogPhotos } from '../../storefront/products/presentation.mjs';

export const DEFAULT_THRESHOLDS = Object.freeze({
  maxActiveProductDropPct: 20,  // block when active products fall by more than this share...
  maxActiveProductDropAbs: 5,   // ...or by more than this many products
  maxActiveVariantDropPct: 35,  // block when active variants (sizes/branches) fall by more than this share
  minPrice: 100,                // ₽, block outside [minPrice, maxPrice] for active variants
  maxPrice: 1_000_000,
  maxPriceJumpPct: 50,         // block when a variant price changes by more than this vs the active snapshot
  promoRubWarn: 5000,           // warn on new/changed promo codes with a large discount
  promoPctWarn: 20,
});

const variantKey = (name, row) => name === 'trees' ? `${row.id}:${row.category}:${row.height_cm}` : `${row.id}:${row.category}:${row.variants === '-' ? '' : row.variants}`;
const headers = text => parseCSV(text)[0] || [];
const activeRows = rows => rows.filter(row => isCatalogActive(row.active));

function stats(feeds) {
  const rows = { trees: validateCSV('trees', feeds.trees), decor: validateCSV('decor', feeds.decor) };
  const products = { trees: treeProducts(rows.trees), decor: decorProducts(rows.decor) };
  const activeProducts = Object.values(products).reduce((sum, map) => sum + [...map.values()].filter(p => p.variants.length).length, 0);
  return { rows, products, activeProducts, activeVariants: activeRows(rows.trees).length + activeRows(rows.decor).length };
}

// prev/next: {trees, decor, promos} CSV texts. prev may be null (first run). mediaFailures: from pinMedia.
export function checkCatalog({ prev, next, mediaFailures = [], thresholds = {}, acceptDrop = false }) {
  const t = { ...DEFAULT_THRESHOLDS, ...thresholds };
  const blocked = [], warnings = [];
  let after, before = null;
  // Schema: every feed parses with the import contract; no column disappears.
  try {
    after = stats(next);
    validateCSV('promos', next.promos);
  } catch (error) {
    blocked.push(`Схема фида сломана: ${error.message}`);
    return { passed: false, blocked, warnings, stats: null };
  }
  if (prev) {
    try { before = stats(prev); } catch (error) { blocked.push(`Предыдущий снимок не читается для сравнения: ${error.message}`); }
    for (const name of ['trees', 'decor', 'promos']) {
      const lost = headers(prev[name]).filter(column => !headers(next[name]).includes(column));
      if (lost.length) blocked.push(`${name}.csv: пропали колонки ${lost.join(', ')}`);
    }
  }
  if (!after.activeProducts) blocked.push('Нет ни одного активного товара');
  if (before) {
    const drop = before.activeProducts - after.activeProducts;
    if (drop > 0 && (drop > t.maxActiveProductDropAbs || drop / before.activeProducts * 100 > t.maxActiveProductDropPct))
      (acceptDrop ? warnings : blocked).push(`Число активных товаров упало ${before.activeProducts} → ${after.activeProducts} (−${drop})`);
    const vdrop = before.activeVariants - after.activeVariants;
    if (vdrop > 0 && vdrop / before.activeVariants * 100 > t.maxActiveVariantDropPct)
      (acceptDrop ? warnings : blocked).push(`Число активных вариантов упало ${before.activeVariants} → ${after.activeVariants}`);
  }
  // Active products: title, price in bounds, at least one photo.
  for (const name of ['trees', 'decor']) {
    for (const product of after.products[name].values()) {
      if (!product.variants.length) continue;
      const label = `${name === 'trees' ? 'Ёлка' : 'Декор'} ${product.id} «${product.title || ''}»`;
      if (!String(product.title || '').trim()) blocked.push(`${label}: пустое название`);
      const rows = activeRows(after.rows[name]).filter(row => row.id === product.id);
      for (const row of rows) {
        const price = Number(row.price);
        if (!(price >= t.minPrice && price <= t.maxPrice)) blocked.push(`${label}, вариант ${variantKey(name, row)}: цена ${row.price} ₽ вне пределов ${t.minPrice}–${t.maxPrice}`);
      }
      const photos = rows.flatMap(row => catalogPhotos(String(row.photos || '').split('|')));
      if (!photos.length) blocked.push(`${label}: нет ни одного фото у активных вариантов`);
      else for (const row of rows) if (!catalogPhotos(String(row.photos || '').split('|')).length) blocked.push(`${label}, вариант ${variantKey(name, row)}: без фото`);
    }
  }
  // Price jumps vs the active snapshot block publication.
  if (before) {
    for (const name of ['trees', 'decor']) {
      const old = new Map(before.rows[name].map(row => [variantKey(name, row), row]));
      for (const row of activeRows(after.rows[name])) {
        const prior = old.get(variantKey(name, row));
        if (!prior || !isCatalogActive(prior.active)) continue;
        const a = Number(prior.price), b = Number(row.price);
        if (a > 0 && Math.abs(b - a) / a * 100 > t.maxPriceJumpPct) blocked.push(`Резкое изменение цены: ${row.title} (${variantKey(name, row)}) ${a} → ${b} ₽ (${b > a ? '+' : ''}${Math.round((b - a) / a * 100)}%)`);
      }
    }
    const promos = text => new Map(parseCSV(text).slice(1).map(cells => [normalizePromoCode(cells[0]), cells.join('\u0001')]));
    const oldPromos = promos(prev.promos);
    for (const cells of parseCSV(next.promos).slice(1)) {
      const code = normalizePromoCode(cells[0]);
      if (oldPromos.get(code) === cells.join('\u0001')) continue;
      const [_, __, rub, pct] = cells;
      if (Number(rub) > t.promoRubWarn || Number(pct) > t.promoPctWarn) warnings.push(`Новый/изменённый промокод ${cells[0]}: −${rub} ₽ / −${pct}%`);
    }
  }
  for (const failure of mediaFailures) blocked.push(`Фото не удалось закрепить локально: ${failure.rawURL} (${failure.error})`);
  return {
    passed: blocked.length === 0, blocked, warnings,
    stats: { activeProducts: after.activeProducts, activeVariants: after.activeVariants, previousActiveProducts: before?.activeProducts ?? null, previousActiveVariants: before?.activeVariants ?? null },
    thresholds: t,
  };
}
