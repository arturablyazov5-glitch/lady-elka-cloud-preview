import { getItems, setQuantity, remove, subscribe } from './cart-store.js';
import { discountTotal } from './order-payload.js';
import { cartSubtotal, lineTotal } from '../../supabase/functions/_shared/product-rules.mjs';
const money = n => `${Number(n || 0).toLocaleString('ru-RU')} ₽`;
const esc = s => String(s ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
const mounted = new WeakMap();
export function initCart(getPromo) {
  const popup = document.querySelector('[data-cart-popup]');
  if (!popup) return;
  if (mounted.has(popup)) return mounted.get(popup);
  popup.querySelectorAll('.item-wrapper__shop').forEach(node => node.remove());
  const totalRow = popup.querySelector('.itogo-wrapper');
  const dividerAfter = totalRow?.nextElementSibling?.classList.contains('divider') ? totalRow.nextElementSibling : null;
  const list = document.createElement('div'); list.dataset.cartItems = '';
  totalRow?.before(list);
  const totalNode = popup.querySelector('.itogo-wrapper [data-cart-title] .text-block-wrap-div');
  const offerBadge = popup.querySelector('[data-cart-sum-offer]');
  const offerNode = popup.querySelector('[data-cart-sum-offer] .text-block-wrap-div');
  const form = popup.querySelector('form');
  function render() {
    const items = getItems(), promo = getPromo();
    list.innerHTML = items.length ? items.map((item, index) => {
      const height = item.options.height ? `${item.options.height} см.` : (item.options.size || '');
      const category = item.options.category || '';
      return `<div class="div div--u-im3bc3u4g item-wrapper__shop" data-cart-index="${index}">
      <div class="div div--u-i09ij701w name-photo__shop"><div class="image shop__img"><img class="image__img" src="${esc(item.image)}" alt=""></div>
      <div class="div div--u-ir8em2vtp title-shop-wrapper"><div class="div div--u-iqlo6zgmt title-wrapper__catalog"><div class="text color__h2 site__h3"><span class="text-block-wrap-div">${esc(item.title)}</span></div>
      <div class="div div--u-ipj03oyjv tex-tovar-wrapper"><div class="text color__h3 size__shop site-catalog__h3"><span class="text-block-wrap-div">${esc(height)}</span></div><div class="text site__h4 color__h3"><span class="text-block-wrap-div">${esc(category)}</span></div></div></div>
      <div class="text text--u-i35a4h7lp site__h2 color__h1"><span class="text-block-wrap-div">${money(lineTotal(item))}</span></div></div></div>
      <div class="div count-summ-wrapper"><button type="button" class="icons-shop" data-cart-down aria-label="Уменьшить количество">−</button>
      <span class="text site__h4 color__h3">${item.quantity} шт.</span><button type="button" class="icons-shop" data-cart-up aria-label="Увеличить количество">+</button>
      <div class="div div--u-igo9ynupl" aria-hidden="true"></div><button type="button" class="icons-shop" data-cart-remove aria-label="Удалить товар">×</button></div></div>`;
    }).join('')
      + (promo?.gift && items.some(item => item.kind !== 'decor') ? `<div class="div item-wrapper__shop" data-cart-gift>Подарок: ${esc(promo.giftText || 'Сумка для хранения')}</div>` : '')
      : '<p class="site__h3" data-cart-empty>Корзина пуста</p>';
    const amount = discountTotal(items, promo);
    if (totalNode) totalNode.textContent = `Итого: ${money(amount)}`;
    const single = items.length === 1 && items[0].quantity === 1 && amount === cartSubtotal(items);
    if (totalRow) totalRow.hidden = single;
    if (dividerAfter) dividerAfter.hidden = single;
    const offerText = promo && amount < cartSubtotal(items) ? 'Промокод применён' : '';
    if (offerNode) offerNode.textContent = offerText;
    if (offerBadge) {
      offerBadge.hidden = !offerText;
      offerBadge.style.display = offerText ? '' : 'none';
    }
  }
  list.addEventListener('click', event => {
    const action = event.target.closest('[data-cart-down],[data-cart-up],[data-cart-remove]');
    if (!action) return;
    const item = getItems()[Number(action.closest('[data-cart-index]').dataset.cartIndex)];
    if (!item) return;
    if (action.matches('[data-cart-remove]')) remove(item.productId, item.variantId);
    else setQuantity(item.productId, item.variantId, item.quantity + (action.matches('[data-cart-up]') ? 1 : -1));
  });
  subscribe(render); render();
  const controller = { render, form };
  mounted.set(popup, controller);
  return controller;
}
