// Yandex Enhanced Ecommerce. Never include customer/contact data.
const sentPurchases = new Set();
export function sendEcommerce(action, products, actionField) {
  try {
    if (!products.length || typeof window === 'undefined') return false;
    window.dataLayer = window.dataLayer || [];
    window.dataLayer.push({ ecommerce: { currencyCode: 'RUB', [action]: action === 'impressions'
      ? products : { products, ...(actionField ? { actionField } : {}) } } });
    return true;
  } catch { return false; } // Analytics must never interrupt checkout.
}
export function ecommerceProduct(item, quantity) {
  return { id: String(item.productId || item.id), ...(item.title ? { name: item.title } : {}),
    brand: 'Lady Elka', category: item.kind === 'decor' ? 'Декор' : 'Ёлки',
    variant: String(item.variantId || ''), price: Number(item.price),
    ...(quantity === undefined ? {} : { quantity }) };
}
export function trackPurchase(payload, orderId = payload.orderId) {
  try {
    const key = 'lady_elka_ecommerce_purchase:' + orderId;
    if (!orderId || sentPurchases.has(key)) return;
    try { if (globalThis.localStorage?.getItem(key)) return; } catch {}
    const field = { id: String(orderId), revenue: Number(payload.amount) };
    if (payload.promoCode) field.coupon = payload.promoCode;
    if (!sendEcommerce('purchase', payload.items.map(item => ecommerceProduct(item, item.quantity)), field)) return;
    sentPurchases.add(key);
    try { globalThis.localStorage?.setItem(key, '1'); } catch {}
  } catch {}
}
