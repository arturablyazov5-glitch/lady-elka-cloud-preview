import { enhanceSelect } from './custom-select.js';

const normalize = value => String(value || '').trim().toLowerCase().replaceAll('ё', 'е');
const money = value => `${Number(value).toLocaleString('ru-RU')} ₽`;
const number = value => Number(String(value || '').replace(/[^\d]/g, '')) || 0;

function enhanceFilterSelect(select, label) {
  if (!select) return null;
  const wrapper = document.createElement('div');
  wrapper.className = 'input__catalog filter-select';
  select.classList.remove('input__catalog');
  select.setAttribute('aria-label', label);
  const valueNode = document.createElement('span');
  valueNode.className = 'filter-select__value site-catalog__h3 color__h2';
  select.before(wrapper);
  wrapper.append(select, valueNode);
  return enhanceSelect(select, { wrapper, valueNode });
}

function formatAmountInput(input) {
  const raw = input.value;
  const caret = input.selectionStart ?? raw.length;
  const digits = raw.replace(/\D/g, '');
  const digitsBeforeCaret = raw.slice(0, caret).replace(/\D/g, '').length;
  const formatted = digits ? `${digits.replace(/\B(?=(\d{3})+(?!\d))/g, '\u00a0')} ₽` : '';
  let nextCaret = 0;
  let seenDigits = 0;
  for (let index = 0; index < formatted.length && seenDigits < digitsBeforeCaret; index += 1) {
    if (/\d/.test(formatted[index])) {
      seenDigits += 1;
      nextCaret = index + 1;
    }
  }
  input.value = formatted;
  try { input.setSelectionRange(nextCaret, nextCaret); } catch {}
}

export function matchingVariants(product, { category = '', height = 0, min = 0, max = 0 } = {}) {
  return product.variants.filter(variant =>
    (!category || normalize(variant.category || variant.options?.category) === normalize(category)) &&
    (!height || Number(variant.height || variant.options?.height) === Number(height)) &&
    (!min || Number(variant.price) >= min) &&
    (!max || Number(variant.price) <= max));
}

export function initFilter() {
  const category = document.querySelector('.js-flt-category');
  if (!category) return;
  const height = document.querySelector('.js-flt-height');
  const min = document.querySelector('.js-flt-price-min');
  const max = document.querySelector('.js-flt-price-max');
  const reset = document.querySelector('.js-flt-reset');
  const cards = [...document.querySelectorAll('.product-card[data-storefront-product]')].map(card => {
    const product = JSON.parse(card.querySelector('[data-storefront-variants]').textContent);
    return { card, product };
  });
  if (!cards.length) return;
  for (const input of [min, max]) input?.addEventListener('input', () => formatAmountInput(input));
  const heights = [...new Set(cards.flatMap(({ product }) => product.variants.map(variant => Number(variant.height)).filter(Boolean)))].sort((a, b) => a - b);
  if (height) height.replaceChildren(new Option('ЛЮБАЯ ВЫСОТА', ''), ...heights.map(value => new Option(`${value} см`, String(value))));
  const categoryDropdown = enhanceFilterSelect(category, 'Категория');
  const heightDropdown = enhanceFilterSelect(height, 'Высота');
  function apply() {
    const selectedCategory = normalize(category.value) === normalize('Любая категория') ? '' : normalize(category.value);
    const selectedHeight = Number(height?.value || 0);
    const lower = number(min?.value), upper = number(max?.value);
    const relevantPrices = [];
    for (const { card, product } of cards) {
      const matching = matchingVariants(product, { category: selectedCategory, height: selectedHeight });
      relevantPrices.push(...matching.map(variant => Number(variant.price)));
      const selected = matchingVariants(product, { category: selectedCategory, height: selectedHeight, min: lower, max: upper })[0];
      card.style.display = selected ? '' : 'none';
      if (!selected) continue;
      const categorySelect = card.querySelector('[data-storefront-category], [data-storefront-option="category"]');
      const variantSelect = card.querySelector('[data-storefront-variant], [data-storefront-option="height"], [data-storefront-option="size"]');
      if (categorySelect && categorySelect.value !== selected.category) {
        categorySelect.value = selected.category;
        categorySelect.dispatchEvent(new Event('change', { bubbles: true }));
      }
      if (variantSelect && variantSelect.value !== String(product.kind === 'decor' ? selected.size : selected.height)) {
        variantSelect.value = String(product.kind === 'decor' ? selected.size : selected.height);
        variantSelect.dispatchEvent(new Event('change', { bubbles: true }));
      }
    }
    if (min) min.placeholder = relevantPrices.length ? money(Math.min(...relevantPrices)) : '';
    if (max) max.placeholder = relevantPrices.length ? money(Math.max(...relevantPrices)) : '';
  }
  for (const input of [category, height, min, max]) input?.addEventListener(input?.tagName === 'SELECT' ? 'change' : 'input', apply);
  reset?.addEventListener('click', event => {
    event.preventDefault();
    category.selectedIndex = 0;
    if (height) height.value = '';
    if (min) min.value = '';
    if (max) max.value = '';
    categoryDropdown?.sync();
    heightDropdown?.sync();
    apply();
  });
  apply();
}
