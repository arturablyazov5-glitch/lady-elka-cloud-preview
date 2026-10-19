import test from 'node:test';
import assert from 'node:assert/strict';
import { sendEcommerce, trackPurchase } from '../client/ecommerce.js';
test('purchase includes revenue and safe products, deduplicates, ignores customer data', () => {
  globalThis.window = { dataLayer: [] };
  const payload = { orderId: 'ecommerce-test', amount: 900, promoCode: 'SALE', customer: { email: 'private' },
    items: [{ productId: 'tree', variantId: 'v1', kind: 'tree', price: 1000, quantity: 1 }] };
  trackPurchase(payload); trackPurchase(payload);
  assert.equal(window.dataLayer.length, 1);
  assert.deepEqual(window.dataLayer[0].ecommerce.purchase.actionField, { id: 'ecommerce-test', revenue: 900, coupon: 'SALE' });
  assert.equal(window.dataLayer[0].ecommerce.purchase.products[0].quantity, 1);
  assert.ok(!JSON.stringify(window.dataLayer).includes('private'));
  window.dataLayer = { push() { throw Error('blocked'); } };
  assert.equal(sendEcommerce('add', [{ id: 'tree' }]), false);
  delete globalThis.window;
});
test('cart reports quantity deltas and full removal, but not clear/reprice', async () => {
  globalThis.window = { dataLayer: [] };
  const memory = new Map();
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: key => memory.get(key), setItem: (key, value) => memory.set(key, value) } });
  const cart = await import('../client/cart-store.js');
  cart.add({ id: 'tree', title: 'Ёлка', kind: 'tree' }, { id: 'v1', price: 1000, options: {} });
  cart.setQuantity('tree', 'v1', 3);
  cart.remove('tree', 'v1'); cart.clear();
  assert.deepEqual(window.dataLayer.map(row => { const e = row.ecommerce; const action = e.add ? 'add' : 'remove'; return [action, e[action].products[0].quantity]; }), [['add', 1], ['add', 2], ['remove', 3]]);
  delete globalThis.window;
});
