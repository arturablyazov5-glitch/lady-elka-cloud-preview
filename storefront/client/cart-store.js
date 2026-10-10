import { cartSubtotal } from '../../supabase/functions/_shared/product-rules.mjs';

const KEY = 'lady_elka_cart_v2';
const valid = item => item && typeof item.productId === 'string' && typeof item.variantId === 'string'
  && Number.isFinite(item.price) && item.price > 0 && Number.isInteger(item.quantity) && item.quantity > 0;
const read = () => {
  try {
    const saved = localStorage.getItem(KEY);
    if (saved) return JSON.parse(saved).filter(valid);
    const legacy = JSON.parse(localStorage.getItem('cart') || '[]');
    const migrated = legacy.filter(item => item.productId && item.variantId && Number(item.price) > 0)
      .map(item => ({ productId: String(item.productId), variantId: String(item.variantId),
        kind: item.category === 'Декор' ? 'decor' : 'tree', title: item.name,
        options: item.category === 'Декор' ? { category: item.variantType || '', size: String(item.height || '') }
          : { category: item.category || '', height: String(item.height || '') },
        price: Number(item.price), quantity: Math.max(1, Number(item.qty) || 1), image: item.photo || '', path: '' }));
    if (migrated.length) localStorage.setItem(KEY, JSON.stringify(migrated));
    return migrated;
  } catch { return []; }
};
let items = read();
const listeners = new Set();
function commit() {
  localStorage.setItem(KEY, JSON.stringify(items));
  listeners.forEach(listener => listener(getItems()));
}
export const getItems = () => items.map(item => ({ ...item, options: { ...item.options } }));
export const total = () => cartSubtotal(items);
export const subscribe = listener => { listeners.add(listener); return () => listeners.delete(listener); };
export function add(product, variant) {
  if (!variant || !(variant.price > 0)) return;
  const existing = items.find(item => item.productId === product.id && item.variantId === variant.id);
  if (existing) existing.quantity = Math.min(99, existing.quantity + 1);
  else items.push({ productId: product.id, variantId: variant.id, kind: product.kind,
    title: product.title, options: { ...variant.options }, price: variant.price,
    quantity: 1, image: variant.image || '', path: product.path || '' });
  commit();
}
export function setQuantity(productId, variantId, quantity) {
  const item = items.find(row => row.productId === productId && row.variantId === variantId);
  if (!item || !Number.isFinite(quantity)) return;
  if (quantity <= 0) items = items.filter(row => row !== item);
  else item.quantity = Math.min(99, Math.floor(quantity));
  commit();
}
export function remove(productId, variantId) { setQuantity(productId, variantId, 0); }
export function increment(productId, variantId) {
  const item = items.find(row => row.productId === productId && row.variantId === variantId);
  if (item) setQuantity(productId, variantId, item.quantity + 1);
}
export function decrement(productId, variantId) {
  const item = items.find(row => row.productId === productId && row.variantId === variantId);
  if (item) setQuantity(productId, variantId, item.quantity - 1);
}
export function clear() { items = []; commit(); }
// Re-price the cart from a fresh catalog: lookup(item) returns the current variant or null (gone).
export function reprice(lookup) {
  let changed = 0, removed = 0;
  const next = [];
  for (const item of items) {
    const current = lookup(item);
    if (!current || !(current.price > 0)) { removed++; continue; }
    if (current.price !== item.price) { changed++; next.push({ ...item, price: current.price }); }
    else next.push(item);
  }
  if (changed || removed) { items = next; commit(); }
  return { changed, removed };
}
