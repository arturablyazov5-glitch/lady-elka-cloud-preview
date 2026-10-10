import { cartSubtotal, checkoutTotal, lineTotal } from '../../supabase/functions/_shared/product-rules.mjs';

export { cartSubtotal as cartTotal, checkoutTotal as discountTotal };
function paymentItemLabel(item) {
  if (item.kind === 'decor') return [item.title, item.options.size, item.options.category, '(Декор)'].filter(Boolean).join(' ');
  return [item.title, item.options.height ? `${item.options.height} см` : '',
    item.options.category ? `(${item.options.category})` : ''].filter(Boolean).join(' ');
}
export function buildOrderPayload(items, customer, promo = null, origin = location.origin, timestamp = Date.now(), paymentMethod = 'card') {
  if (!items.length) throw new Error('Корзина пуста');
  const amount = checkoutTotal(items, promo);
  const orderId = `LE-${timestamp}-${String(items[0].options.height || '').slice(0, 6)}-${crypto.randomUUID().slice(0, 8)}`;
  const lines = items.map(item => `${paymentItemLabel(item)}${item.quantity > 1 ? ` x${item.quantity}` : ''} — ${lineTotal(item)} ₽`);
  const discountLabel = promo && amount < cartSubtotal(items)
    ? (promo.rub > 0 ? `${promo.rub} ₽` : `${promo.pct}% (${cartSubtotal(items) - amount} ₽)`) : '';
  const description = [lines.join(' | '), `Покупатель: ${customer.name}`, `Почта: ${customer.email}`,
    `Телефон: ${customer.phone}`, `Адрес: ${customer.address}`, `Связь: ${customer.contactPref}`,
    promo?.code ? `Промо: ${promo.code}` : '', discountLabel ? `Скидка по промокоду: ${discountLabel}` : '',
    promo?.gift && items.some(item => item.kind !== 'decor') ? `Подарок по промокоду: ${promo.giftText || 'да'}` : ''].filter(Boolean).join(' | ');
  return { amount, description, email: customer.email, phone: customer.phone,
    paymentMethod, customer: { ...customer }, delivery: { address: customer.address },
    items: items.map(item => ({ productId: item.productId, variantId: item.variantId, kind: item.kind,
      quantity: item.quantity, price: item.price })),
    promo: promo ? { code: promo.code || '', rub: promo.rub || 0, pct: promo.pct || 0,
      gift: !!promo.gift, giftText: promo.giftText || '' } : null,
    orderId, clientId: customer.name || 'Леди Елка',
    successUrl: `${origin}/spasibo/?oid=${encodeURIComponent(orderId)}`, failUrl: `${origin}/pay-return/?fail=1&oid=${encodeURIComponent(orderId)}`, promoCode: promo?.code || '',
    address: customer.address, contactPref: customer.contactPref };
}
