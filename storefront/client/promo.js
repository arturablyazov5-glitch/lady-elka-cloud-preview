import { catalogEndpoint } from './config.js';
import { csvRecords, findPromo, hasPromoBenefit, normalizePromoCode, promoDetails } from '../../supabase/functions/_shared/product-rules.mjs';
import { getItems } from './cart-store.js';
const KEY = 'lady_promo_state';
let state = null;
try {
  const saved = JSON.parse(localStorage.getItem(KEY) || 'null');
  if (saved && typeof saved.code === 'string' && normalizePromoCode(saved.code) && hasPromoBenefit(saved)) state = saved;
} catch {}
export const getPromo = () => state ? { ...state } : null;
const mounted = new WeakSet();
export function initPromo(changed) {
  const button = document.querySelector('[data-promo-apply]');
  const input = document.querySelector('[data-promo-input]');
  if (!button || !input || mounted.has(button)) return;
  mounted.add(button);
  const label = button.querySelector('.text-block-wrap-div') || button;
  let loading = false;
  const render = () => {
    button.disabled = loading;
    input.disabled = loading;
    label.textContent = loading ? 'проверяем…' : state ? 'сбросить' : 'активировать';
    if (state) input.value = state.code;
  };
  const persist = () => {
    try { if (state) localStorage.setItem(KEY, JSON.stringify(state)); else localStorage.removeItem(KEY); } catch {}
  };
  button.addEventListener('click', async event => {
    event.preventDefault();
    if (loading) return;
    if (state) { state = null; persist(); input.value = ''; render(); changed(); return; }
    const items = getItems();
    if (!items.length) { alert('Корзина пуста'); return; }
    if (items.every(item => item.kind === 'decor')) { alert('Промокоды не применяются к декору'); return; }
    const code = normalizePromoCode(input.value);
    if (!code) { alert('Введите промокод'); return; }
    loading = true; render();
    try {
      const response = await fetch(catalogEndpoint('promos'), { cache: 'no-store' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const row = findPromo(csvRecords(await response.text()), code);
      if (!row) { alert('Промокод не подходит'); return; }
      const candidate = { code, ...promoDetails(row) };
      if (!hasPromoBenefit(candidate)) { alert('Промокод не даёт скидку или подарок'); return; }
      state = candidate;
      persist(); changed();
    } catch { alert('Промокоды сейчас недоступны. Повторите попытку позже.'); }
    finally { loading = false; render(); }
  });
  render();
}
