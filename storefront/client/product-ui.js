import { imagePreviewAttributes } from '../products/image-preview.mjs';
import { setProductImage } from './product-image.js';
import { closeDropdownIfDetached, enhanceSelect } from './custom-select.js';
import { availableOptions, initialSelection, resolveVariant, variantDimensions } from '../products/variants.mjs';
import { add } from './cart-store.js';
const money = value => `${Number(value || 0).toLocaleString('ru-RU')} ₽`;
const setText = (root, selector, value) => {
  const node = root.querySelector(selector);
  if (node) (node.querySelector('.text-block-wrap-div') || node).textContent = value;
};
function label(key, value, variant) { return key === 'height' ? `${value} см.` : key === 'size' ? (variant?.label || value) : value; }
function gallery(root, product, variant) {
  const list = root.querySelector('[data-storefront-gallery]');
  const section = root.querySelector('[data-storefront-gallery-section]');
  if (!list) return;
  list.replaceChildren(...(variant.photos || []).slice(1).map(src => {
    const div = document.createElement('div'); div.className = 'image product__img-dop__cms';
    const img = document.createElement('img'); img.className = 'image__img'; img.loading = 'lazy'; img.decoding = 'async'; for (const [name, value] of Object.entries(imagePreviewAttributes(src, true))) img.setAttribute(name, value); img.alt = product.title;
    div.append(img); return div;
  }));
  if (section) section.hidden = (variant.photos || []).length <= 1;
}
function bind(root, initialProduct) {
  let product = initialProduct;
  let dimensions = variantDimensions(product);
  let selection = initialSelection(product);
  const collectSelects = () => Object.fromEntries(dimensions.map(key => [key, root.querySelector(`[data-storefront-option="${key}"]`)
    || (key === 'category' ? root.querySelector('[data-storefront-category]') : root.querySelector('[data-storefront-variant]'))]));
  let selects = collectSelects();
  const customSelects = new Map(Object.entries(selects).filter(([, select]) => select).map(([key, select]) => [key, enhanceSelect(select)]));
  let selectedVariant = resolveVariant(product, selection);
  const buy = root.querySelector('.buy-btn');
  function render() {
    for (const key of dimensions) {
      const select = selects[key]; if (!select) continue;
      const options = availableOptions(product, key, selection);
      if (!options.includes(selection[key])) selection[key] = options[0];
      select.replaceChildren(...options.map(value => {
        const option = document.createElement('option'); option.value = value;
        option.textContent = label(key, value, product.variants.find(v => v.options[key] === value));
        return option;
      }));
      select.value = selection[key];
      const visibleLabel = root.querySelector(key === 'category' ? '[data-storefront-category-label]' : '[data-storefront-variant-label]');
      if (visibleLabel) (visibleLabel.querySelector('.text-block-wrap-div') || visibleLabel).textContent = select.selectedOptions[0]?.textContent || '';
      customSelects.get(key)?.sync();
    }
    selectedVariant = resolveVariant(product, selection);
    if (!selectedVariant) { buy?.setAttribute('aria-disabled', 'true'); return; }
    buy?.removeAttribute('aria-disabled');
    const v = selectedVariant;
    setProductImage(root, v.image, product.title);
    setText(root, product.kind === 'decor' ? '[data-price-decor]' : '.price', money(v.price));
    setText(root, '[data-prop-offer]', v.oldPrice > v.price ? money(v.oldPrice) : '');
    const discount = v.discount || (v.oldPrice > v.price ? Math.round((1 - v.price / v.oldPrice) * 100) : 0);
    setText(root, '[data-prop-discount]', discount ? `-${Math.abs(discount)}%` : '');
    setText(root, '[data-prop-diam]', v.diameter ? `${v.diameter} см.` : '');
    const hasBranches = Number(v.branches) > 0;
    setText(root, '[data-prop-branches]', hasBranches ? `${v.branches} шт.` : '');
    setText(root, '[data-prop-description]', v.description || product.staticDescription || '');
    setText(root, '[data-storefront-description]', v.description || '');
    for (const [selector, visible] of [['[data-storefront-diameter-row]', v.diameter], ['[data-storefront-branches-row]', hasBranches]]) {
      const node = root.querySelector(selector); if (node) { node.hidden = !visible; node.style.display = visible ? '' : 'none'; }
    }
    const showPropertyDivider = Boolean(v.diameter && hasBranches);
    root.querySelectorAll('[data-storefront-properties-divider]').forEach(node => {
      node.hidden = !showPropertyDivider;
      node.style.display = showPropertyDivider ? '' : 'none';
    });
    gallery(root, product, v);

  }
  root.addEventListener('change', event => {
    const key = Object.keys(selects).find(candidate => selects[candidate] === event.target);
    if (!key) return;
    selection[key] = event.target.value;
    for (const later of dimensions.slice(dimensions.indexOf(key) + 1)) selection[later] = availableOptions(product, later, selection)[0];
    render();
  });
  buy?.addEventListener('keydown', event => {
    if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); buy.click(); }
  });
  buy?.addEventListener('click', event => {
    if (!selectedVariant) { event.preventDefault(); event.stopImmediatePropagation(); return; }
    add(product, selectedVariant);
  });
  return nextProduct => {
    const previousSelection = selection;
    product = { ...nextProduct, staticDescription: product.staticDescription };
    dimensions = variantDimensions(product);
    selection = initialSelection(product);
    for (const key of dimensions) {
      const options = availableOptions(product, key, selection);
      if (options.includes(previousSelection[key])) selection[key] = previousSelection[key];
    }
    selects = collectSelects();
    render();
  };
}
const boundProducts = new WeakMap();
export function initProducts() {
  closeDropdownIfDetached();
  for (const root of document.querySelectorAll('[data-storefront-product]')) {
    const data = root.querySelector('[data-storefront-variants]') || document.querySelector('[data-storefront-page-product]');
    if (!data) continue;
    const product = JSON.parse(data.textContent);
    const update = boundProducts.get(root);
    if (update) update(product);
    else boundProducts.set(root, bind(root, product));
  }
}
