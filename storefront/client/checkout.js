import { getItems, clear, reprice } from './cart-store.js';
import { postJson, describeFailure, showMessage, showFailure, holdSubmit, keepFocus, RequestFailure } from './request-errors.js';
import { buildOrderPayload } from './order-payload.js';
import { loadTreeProducts, loadDecorProducts } from '../products/model.mjs';
import { paymentEndpoint } from './config.js';
import { attachRussianPhoneMask, formatRussianPhone } from './phone-mask.js';
const mounted = new WeakMap();
// Persistent accessible names and autofill hints; placeholders stay as visual hints only.
const checkoutLabels = {
  name: ['Имя и фамилия', 'name'], email: ['Электронная почта', 'email'], phone: ['Телефон', 'tel'],
  address: ['Адрес доставки', 'shipping street-address'], comment: ['Комментарий к заказу', 'off'],
  contactPref: ['Предпочтительный способ связи', null], method: ['Способ оплаты', null],
};
let labelCount = 0;
function describeCheckoutControls(form, controls) {
  const document = form.ownerDocument;
  if (!document?.createElement) return;
  const label = (control, text) => {
    if (!control || control.labels?.length || control.hasAttribute?.('aria-labelledby')) return;
    if (!control.id) control.id = `storefront-checkout-field-${++labelCount}`;
    const node = document.createElement('label');
    node.className = control.hidden ? 'storefront-visually-hidden' : 'storefront-checkout-label';
    node.htmlFor = control.id;
    node.textContent = text;
    control.before(node);
  };
  for (const [key, [text, autocomplete]] of Object.entries(checkoutLabels)) {
    const control = controls[key];
    if (!control) continue;
    label(control, text);
    if (autocomplete && control.setAttribute) control.setAttribute('autocomplete', autocomplete);
    if (['name', 'email', 'phone', 'address'].includes(key)) control.setAttribute?.('aria-required', 'true');
  }
  const promo = form.querySelector?.('[data-promo-input]');
  if (promo) { label(promo, 'Промокод'); promo.setAttribute('autocomplete', 'off'); }
  // The captured consent label text is a hidden "Вариант 1"; name the checkbox by the visible agreement text.
  const consent = controls.consent;
  const agreement = consent?.closest?.('.checkbox-wrapper__form')?.querySelector(':scope > .text');
  if (consent && agreement) {
    if (!agreement.id) agreement.id = `storefront-checkout-consent-${++labelCount}`;
    consent.setAttribute('aria-labelledby', agreement.id);
    consent.setAttribute('aria-required', 'true');
  }
}

export function initCheckout(form, getPromo, cartStore = { getItems, clear, reprice }) {
  // A demand bundle must use the owning entry's in-memory cart/subscribers.
  const { getItems, clear, reprice } = cartStore;
  if (!form) return;
  // Replace our own handlers when mounting again on the same form.
  if (mounted.get(form)?.() === false) return;
  let submitting = false;
  const pendingKey = 'lady_elka_pending_order_v1';
  let pending = null;
  try { pending = JSON.parse(globalThis.sessionStorage?.getItem(pendingKey) || 'null'); } catch {}
  const draftKey = 'lady_elka_checkout_draft_v1';
  const fields = Object.fromEntries(['name', 'email', 'phone', 'address', 'contactPref', 'comment', 'paymentMethod']
    .map(key => [key === 'paymentMethod' ? 'method' : key, `[data-checkout-field="${key}"]`]));
  const controls = {};
  for (const [key, selector] of [...Object.entries(fields), ['consent', '[data-checkout-field="consent"]']]) {
    const matches = [...form.querySelectorAll(selector)];
    if (matches.length !== 1) throw new Error(`Checkout field ${key}: expected exactly one control, found ${matches.length}`);
    controls[key] = matches[0];
  }
  describeCheckoutControls(form, controls);
  const phoneInput = controls.phone;
  const unmaskPhone = attachRussianPhoneMask(phoneInput);
  let draft = null;
  try { draft = JSON.parse(globalThis.sessionStorage?.getItem(draftKey) || 'null'); } catch {}
  if (draft && typeof draft === 'object') {
    for (const key of Object.keys(fields)) {
      const input = controls[key];
      if (typeof draft[key] === 'string') {
        // Migrate the persisted v1 draft only; DOM labels are never an API.
        const oldMethods = { 'Оплата картой': 'card', 'Оплата картой онлайн': 'card', 'Оплата при получении': 'cash_on_delivery' };
        input.value = key === 'method' ? (oldMethods[draft[key]] || draft[key])
          : key === 'phone' ? formatRussianPhone(draft[key]).value : draft[key];
      }
    }
    const consent = controls.consent;
    if (consent) consent.checked = draft.consent === true;
  }
  const saveDraft = () => {
    const values = Object.fromEntries(Object.keys(fields).map(key => [key, controls[key].value || '']));
    values.consent = controls.consent?.checked === true;
    try { globalThis.sessionStorage?.setItem(draftKey, JSON.stringify(values)); } catch {}
  };
  const clearDraft = () => { try { globalThis.sessionStorage?.removeItem(draftKey); } catch {} };
  form.addEventListener('input', saveDraft);
  form.addEventListener('change', saveDraft);
  const savePending = () => {
    // Clearing after confirmed success is best-effort; persistence before POST is mandatory.
    if (!pending) {
      try { globalThis.sessionStorage?.removeItem(pendingKey); } catch {}
      return;
    }
    try {
      const storage = globalThis.sessionStorage;
      const serialized = JSON.stringify(pending);
      storage.setItem(pendingKey, serialized);
      if (storage.getItem(pendingKey) !== serialized) throw new Error('Pending order readback mismatch');
    } catch {
      throw new Error('Не удалось сохранить номер заказа в браузере. Отправка остановлена. Разрешите хранение данных в этой вкладке и повторите попытку; форма и корзина не очищены.');
    }
  };
  const button = form.querySelector('[data-pay-now]');
  const label = button?.querySelector('.text-block-wrap-div') || button;
  const originalLabel = label?.textContent || 'купить';
  const notice = document.createElement('p');
  notice.setAttribute('role', 'status');
  notice.dataset && (notice.dataset.checkoutNotice = '');
  notice.style.margin = '12px 0';
  notice.style.width = '100%';
  if (button?.parentElement && button.parentElement !== form) button.parentElement.after(notice);
  else button?.after(notice);
  const show = (message, error = false) => showMessage(notice, message, error);
  if (!notice.id) notice.id = `storefront-checkout-status-${++labelCount}`;
  // The submit button is described by the live region, so focus returning to it re-reads the last outcome.
  button?.setAttribute?.('aria-describedby', notice.id);
  let cancelHold = () => {};
  // Fresh feeds are fetched with no-store; the cart is re-priced in place (cart UI re-renders via subscribe).
  const lookupFresh = async () => {
    const [trees, decor] = await Promise.all([loadTreeProducts(), loadDecorProducts()]);
    return item => (item.kind === 'decor' ? decor : trees).get(item.productId)?.variants.find(v => v.id === item.variantId) || null;
  };
  const refreshCart = async () => {
    let result;
    try { result = reprice(await lookupFresh()); }
    catch { return reportFailure(new RequestFailure('network')); }
    pending = null; savePendingQuietly();
    if (!getItems().length) return show('Товары из корзины больше недоступны. Корзина пересчитана — выберите товары заново.', true);
    if (result.changed || result.removed) return show(`Цены обновились, корзина пересчитана${result.removed ? ' (недоступные товары удалены)' : ''}. Проверьте сумму и оформите заказ снова.`, true);
    show('Корзина проверена: цены актуальны. Оформите заказ снова.');
  };
  const savePendingQuietly = () => { try { savePending(); } catch {} };
  const reportFailure = async (error) => {
    if (error?.accepted) { show(`Заказ № ${error.orderId} сохранён. ${error.serverMessage || 'Мы свяжемся с вами для подтверждения.'}`, true); return; }
    const description = describeFailure(error, 'order');
    if (description.priceChanged) {
      // Server says the catalog moved: re-price for real; fall back to a manual refresh button.
      let result = null;
      try { result = reprice(await lookupFresh()); } catch {}
      if (result) { pending = null; savePendingQuietly(); }
      if (result && (result.changed || result.removed))
        return show(`Цены обновились, корзина пересчитана${result.removed ? ' (недоступные товары удалены)' : ''}. Проверьте сумму и оформите заказ снова.`, true);
      return showFailure(notice, { ...description, text: 'Цены или наличие товаров изменились. Обновите корзину и проверьте сумму.' },
        { action: { label: 'Обновить корзину', run: () => { void refreshCart(); } } });
    }
    showFailure(notice, description, { prefix: description.kind === 'local' ? 'Не удалось оформить заказ: ' : '' });
    if (description.retryAfter) cancelHold = holdSubmit([button], [label], [originalLabel], description.retryAfter);
  };
  // Invalid fields are announced and linked to the status message; cleared as soon as the user edits them.
  const markInvalid = invalid => {
    for (const [key, bad] of Object.entries(invalid)) {
      const control = controls[key];
      if (!control?.setAttribute) continue;
      if (bad) { control.setAttribute('aria-invalid', 'true'); control.setAttribute('aria-describedby', notice.id); }
      else { control.removeAttribute('aria-invalid'); control.removeAttribute('aria-describedby'); }
    }
    const first = Object.keys(invalid).find(key => invalid[key]);
    if (first) controls[first]?.focus?.();
  };
  const clearInvalid = event => {
    if (event.target?.getAttribute?.('aria-invalid') === 'true') { event.target.removeAttribute('aria-invalid'); event.target.removeAttribute('aria-describedby'); }
  };
  form.addEventListener('input', clearInvalid);
  form.addEventListener('change', clearInvalid);
  const submit = async event => {
    event.preventDefault(); event.stopImmediatePropagation();
    if (submitting || button?.disabled) return;
    saveDraft();
    show('');
    const items = getItems();
    if (!items.length) { alert('Корзина пуста'); return; }
    const value = key => controls[key].value.trim();
    const customer = Object.fromEntries(['name', 'email', 'phone', 'address', 'contactPref', 'comment'].map(key => [key, value(key)]));
    const invalid = {
      name: !customer.name, email: !/^\S+@\S+\.\S+$/.test(customer.email),
      phone: formatRussianPhone(customer.phone).localDigits.length < 10, address: !customer.address, contactPref: !customer.contactPref,
    };
    markInvalid(invalid);
    if (Object.values(invalid).some(Boolean)) {
      show('Заполните имя, почту, телефон, адрес и способ связи.', true); return;
    }
    if (!controls.consent?.checked) { show('Подтвердите согласие на обработку персональных данных.', true); markInvalid({ consent: true }); return; }
    const paymentMethod = value('method');
    if (!['card', 'cash_on_delivery'].includes(paymentMethod)) { show('Выберите способ оплаты.', true); markInvalid({ method: true }); return; }
    const promo = getPromo();
    const signature = JSON.stringify({ items, customer, promo, paymentMethod });
    const retry = pending?.signature === signature;
    const payload = retry ? pending.payload
      : buildOrderPayload(items, customer, promo, location.origin, Date.now(), paymentMethod);
    if (!payload.amount) { show('Сумма заказа нулевая.', true); return; }
    submitting = true; button.disabled = true; label.textContent = 'Оформляем заказ…';
    let failure = null;
    try {
      // An accepted retry must remain valid even if the catalog changes later.
      // The server validates every new order and replays the stored accepted order.
      if (!retry) {
        let lookup;
        try { lookup = await lookupFresh(); }
        catch { throw new RequestFailure('network'); }
        if (items.some(item => lookup(item)?.price !== item.price)) throw new RequestFailure('conflict', { status: 409, code: 'Catalog changed' });
      }
      pending = { signature, payload };
      savePending();
      const ENDPOINT = paymentEndpoint();
      const url = paymentMethod === 'cash_on_delivery' ? `${ENDPOINT}?action=create-cod-order` : ENDPOINT;
      const result = await postJson(url, payload, { timeoutMs: 30000 });
      if (result.paid === true) {
        clear();
        pending = null;
        savePending();
        form.reset();
        clearDraft();
        show(`Заказ № ${result.orderId || payload.orderId} оплачен. Мы скоро свяжемся с вами.`);
        return;
      }
      if (paymentMethod === 'cash_on_delivery') {
        if (!result.ok || !result.orderId) throw new Error('Подтверждение заказа не получено');
        clear();
        pending = null;
        savePending();
        form.reset();
        clearDraft();
        show(`Заказ № ${result.orderId} оформлен. Мы скоро свяжемся с вами.`);
        return;
      }
      if (!result.url) throw new Error('Ссылка оплаты не получена');
      location.assign(result.url);
    } catch (error) { failure = error; }
    finally { button.disabled = false; label.textContent = originalLabel; if (!failure) submitting = false; }
    // Data and cart stay intact; a failure only restores the button (or holds it for Retry-After).
    if (failure) try { await reportFailure(failure); } finally { submitting = false; keepFocus(form, button, notice); }
  };
  form.addEventListener('submit', submit, true);
  mounted.set(form, () => {
    if (submitting) return false;
    form.removeEventListener?.('input', saveDraft);
    form.removeEventListener?.('change', saveDraft);
    form.removeEventListener?.('input', clearInvalid);
    form.removeEventListener?.('change', clearInvalid);
    form.removeEventListener?.('submit', submit, true);
    cancelHold();
    unmaskPhone();
    notice.remove?.();
  });
}
