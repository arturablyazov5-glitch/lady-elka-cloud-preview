/** @typedef {Record<string, string>} CatalogRow */

const ACTIVE_VALUES = new Set(['1', 'true', 't', 'да', 'yes', 'y', 'on', 'ok', '✓']);
const TREE_CATEGORY_ORDER = ['Зелёная', 'С освещением', 'Заснеженная', 'Заснеженная с освещением'];

const PROMO_COLUMNS = Object.freeze({
  code: ['promocode', 'promo', 'code', 'код', 'промокод'],
  rub: ['ruble-offer', 'ruble', 'rub-off', 'rub', 'руб'],
  pct: ['percent-offer', 'percent', 'pct', '%'],
  gift: ['gift-offer', 'gift', 'подарок'],
});

/** Parse RFC 4180 style CSV, retaining empty cells and quoted line endings. @param {string} text @returns {string[][]} */
export function parseCSV(text) {
  const source = String(text ?? '').replace(/^\uFEFF/, '');
  if (!source) return [];

  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  let fieldStarted = false;

  for (let index = 0; index < source.length; index++) {
    const character = source[index];
    if (quoted) {
      if (character === '"' && source[index + 1] === '"') {
        cell += '"';
        index++;
      } else if (character === '"') {
        quoted = false;
      } else {
        cell += character;
      }
      continue;
    }

    if (character === '"' && !fieldStarted) {
      quoted = true;
      fieldStarted = true;
    } else if (character === ',') {
      row.push(cell);
      cell = '';
      fieldStarted = false;
    } else if (character === '\r' || character === '\n') {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
      fieldStarted = false;
      if (character === '\r' && source[index + 1] === '\n') index++;
    } else {
      cell += character;
      fieldStarted = true;
    }
  }

  if (quoted) throw new Error('Unterminated quoted CSV field');
  if (fieldStarted || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

/** @param {string} text @returns {CatalogRow[]} */
export function csvRecords(text) {
  const [headers = [], ...records] = parseCSV(text);
  return records.map(values => Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ''])));
}

/** @param {unknown} value */
export function isCatalogActive(value) {
  return ACTIVE_VALUES.has(String(value ?? '').trim().toLowerCase());
}

/** Keep the existing catalog normalization for prices and other numeric CSV fields. @param {unknown} value */
export function catalogNumber(value) {
  return Number(String(value ?? '').replace(/[^\d.,-]/g, '').replace(',', '.')) || 0;
}

/** @param {CatalogRow[]} rows */
export function treeProducts(rows) {
  const products = new Map();
  for (const row of rows) {
    const id = String(row.id || '').trim();
    if (!id) continue;
    if (!products.has(id)) products.set(id, { id, title: row.title, variants: [] });
    if (!isCatalogActive(row.active)) continue;
    const variant = {
      id: `${id}:${row.category}:${row.height_cm}`,
      category: row.category,
      height: catalogNumber(row.height_cm),
      diameter: catalogNumber(row.diameter_cm),
      branches: catalogNumber(row.branches),
      price: catalogNumber(row.price),
      oldPrice: catalogNumber(row.offer),
      discount: catalogNumber(row.discount_pct),
      description: row.description === '-' ? '' : (row.description || ''),
      photos: String(row.photos || '').split('|').map(photo => photo.trim()).filter(Boolean),
    };
    if (variant.price > 0 && variant.height > 0) {
      const product = products.get(id);
      if (product.variants.some(item => item.id === variant.id)) throw new Error(`Duplicate tree variant: ${variant.id}`);
      product.variants.push(variant);
    }
  }
  for (const product of products.values()) {
    product.variants.sort((left, right) =>
      (TREE_CATEGORY_ORDER.indexOf(left.category) + 1 || 99) - (TREE_CATEGORY_ORDER.indexOf(right.category) + 1 || 99)
      || left.height - right.height);
  }
  return products;
}

/** @param {CatalogRow[]} rows */
export function decorProducts(rows) {
  const products = new Map();
  for (const row of rows) {
    const id = String(row.id || '').trim();
    if (!id) continue;
    if (!products.has(id)) products.set(id, { id, title: row.title, variants: [] });
    if (!isCatalogActive(row.active)) continue;
    const label = row.variants === '-' ? '' : (row.variants || '');
    const dimensions = label.match(/\d+[хxХX]\d+[хxХX]\d+/);
    const variant = {
      id: `${id}:${row.category || ''}:${label}`,
      category: row.category || '',
      size: dimensions ? dimensions[0].replace(/[xХX]/g, 'х') : label,
      label,
      price: catalogNumber(row.price),
      description: row.description === '-' ? '' : (row.description || ''),
      photos: String(row.photos || '').split('|').map(photo => photo.trim()).filter(Boolean),
    };
    if (variant.price > 0) {
      const product = products.get(id);
      if (product.variants.some(item => item.id === variant.id)) throw new Error(`Duplicate decor variant: ${variant.id}`);
      product.variants.push(variant);
    }
  }
  return products;
}

/** @param {unknown} value */
export function normalizePromoCode(value) {
  return String(value ?? '').trim().toLowerCase().replaceAll('ё', 'е').replace(/\s+/g, ' ');
}

function promoField(row, aliases) {
  for (const alias of aliases) {
    const key = Object.keys(row).find(name => name.toLowerCase() === alias);
    if (key !== undefined && String(row[key] ?? '').trim() !== '') return row[key];
  }
  return '';
}

/** @param {CatalogRow[]} rows @param {unknown} value */
export function findPromo(rows, value) {
  const wanted = normalizePromoCode(value);
  if (!wanted) return null;
  return rows.find(row => normalizePromoCode(promoField(row, PROMO_COLUMNS.code)) === wanted) ?? null;
}

/** @param {CatalogRow} row */
export function promoDetails(row) {
  const giftText = String(promoField(row, PROMO_COLUMNS.gift) ?? '').trim();
  return {
    rub: catalogNumber(promoField(row, PROMO_COLUMNS.rub)),
    pct: catalogNumber(promoField(row, PROMO_COLUMNS.pct)),
    gift: /сумк/i.test(giftText),
    giftText,
  };
}

/** @param {{rub?: unknown, pct?: unknown, gift?: unknown}} promo */
export function hasPromoBenefit(promo) {
  return catalogNumber(promo.rub) > 0 || catalogNumber(promo.pct) > 0 || Boolean(promo.gift);
}

/** @param {{price: number, quantity: number}} item */
export function lineTotal(item) {
  return item.price * item.quantity;
}

/** @param {{price: number, quantity: number}[]} items */
export function cartSubtotal(items) {
  return items.reduce((sum, item) => sum + lineTotal(item), 0);
}

/** @param {{kind: string, price: number, quantity: number}[]} items @param {{rub?: unknown, pct?: unknown}|null} promo */
export function checkoutTotal(items, promo) {
  const subtotal = cartSubtotal(items);
  if (!promo || items.every(item => item.kind === 'decor')) return subtotal;
  const rub = catalogNumber(promo.rub);
  const pct = catalogNumber(promo.pct);
  const discount = rub > 0
    ? Math.min(subtotal, rub)
    : pct > 0
      ? subtotal - Math.max(0, Math.round(subtotal * (1 - pct / 100)))
      : 0;
  return subtotal - discount;
}
