import { availableOptions, initialSelection, variantDimensions } from './variants.mjs';
import { escapeHtml as escape, jsonForHtml, money } from './presentation.mjs';
import { localImageSize } from './image-size.mjs';
import { join } from 'node:path';

function intrinsicSize(src) {
  const size = localImageSize(src, process.env.LE_BUILD_TARGET || join(import.meta.dirname, '..', 'dist'));
  return size ? ` width="${size.width}" height="${size.height}"` : '';
}

function divRange(html, className) {
  const open = new RegExp(`<div\\b[^>]*\\bclass=['"][^'"]*\\b${className}\\b[^'"]*['"][^>]*>`).exec(html);
  if (!open) throw new Error(`Product template missing ${className}`);
  const tags = /<\/?div\b[^>]*>/g;
  tags.lastIndex = open.index + open[0].length;
  let depth = 1;
  for (let tag; (tag = tags.exec(html));) {
    depth += tag[0].startsWith('</') ? -1 : 1;
    if (!depth) return [open.index, tags.lastIndex];
  }
  throw new Error(`Unclosed product template ${className}`);
}

function replaceDiv(html, className, replacement) {
  const [start, end] = divRange(html, className);
  return html.slice(0, start) + replacement + html.slice(end);
}

export function withProductLayout(template, layout) {
  return replaceDiv(template, 'product-wrapper__cms', layout.trim());
}

function optionLabel(kind, key, value, variant) {
  if (key === 'height') return `${value} см`;
  if (key === 'size') return variant?.label || value;
  return value || (kind === 'decor' ? 'Вариант' : 'Ёлка');
}

function controls(product) {
  const selected = initialSelection(product);
  return variantDimensions(product).map((key, index) => {
    const values = availableOptions(product, key, selected);
    const classes = product.kind === 'tree'
      ? (index ? 'div--u-iad7qxgc4' : 'div--u-ie11gsfvz') : 'storefront-decor-option';
    const label = key === 'category' ? (product.kind === 'decor' ? 'Тип декора' : 'Вид ёлки')
      : (product.kind === 'decor' ? 'Вариант декора' : 'Высота ёлки');
    const valueLabel = value => optionLabel(product.kind, key, value, product.variants.find(v => v.options[key] === value));
    const labelHook = key === 'category' ? 'data-storefront-category-label' : 'data-storefront-variant-label';
    return `<div class="div ${classes} input__catalog" data-storefront-select><div ${labelHook} class="text color__h2 site-catalog__h3"><span class="text-block-wrap-div">${escape(valueLabel(selected[key]))}</span></div><div class="image down__img" aria-hidden="true"><img src="/thumb/2/uTw63IdxEnqR7fwGJjNqzA/640r480/d/chevron_down_2.svg" alt="" class="image__img"></div><button type="button" class="storefront-select-trigger" aria-label="${label}" aria-haspopup="listbox" aria-expanded="false"></button><select data-storefront-option="${key}" aria-label="${label}" aria-hidden="true" tabindex="-1">
      ${values.map(value => `<option value="${escape(value)}"${selected[key] === value ? ' selected' : ''}>${escape(valueLabel(value))}</option>`).join('')}
    </select><div class="storefront-select-menu" role="listbox" hidden></div></div>`;
  }).join('');
}

function treeProperties(variant) {
  const hasBranches = Number(variant?.branches) > 0;
  return `<div class="list wrapper__list">
    <div class="list__item item_list" data-storefront-diameter-row${variant?.diameter ? '' : ' hidden'}>
      <div class="div content-dot__list"><div class="div dot__list"></div><div class="div div--u-iasdazp8f property__wrapper">
        <div class="text site__h3 color__h3"><span class="text-block-wrap-div">Диаметр —</span></div><div data-prop-diam class="text site__h3 color__h2"><span class="text-block-wrap-div">${variant?.diameter ? `${variant.diameter} см.` : ''}</span></div>
      </div></div>
      <div class="div divider" data-storefront-properties-divider${variant?.diameter && hasBranches ? '' : ' hidden'}></div>
      <div class="div divider div--u-ih2bl42ik divider-no" data-storefront-properties-divider aria-hidden="true"${variant?.diameter && hasBranches ? '' : ' hidden'}></div>
    </div>
    <div class="list__item item_list" data-storefront-branches-row${hasBranches ? '' : ' hidden style="display:none"'}>
      <div class="div content-dot__list"><div class="div dot__list color-green-bg"></div><div class="div div--u-ill8xxdt2 property__wrapper">
        <div class="text site__h3 color__h3"><span class="text-block-wrap-div">Кол-во веток —</span></div><div data-prop-branches class="text site__h3 color__h2"><span class="text-block-wrap-div">${hasBranches ? `${variant.branches} шт.` : ''}</span></div>
      </div></div>
    </div>
  </div>`;
}

function gallery(product, variant) {
  const photos = variant?.photos || [];
  return `<div class="div div--u-ib8vguv7t dop__img__cms" data-storefront-gallery-section${photos.length > 1 ? '' : ' hidden'}>
    <div class="text site__h3 color__h3"><span class="text-block-wrap-div">Ещё фото</span></div>
    <div class="div div--u-iybiwde7h dop__img__cms" data-storefront-gallery>${photos.slice(1).map(src => `<div class="image product__img-dop__cms"><img class="image__img" src="${escape(src)}" alt="${escape(product.title)}"${intrinsicSize(src)} loading="lazy" decoding="async"></div>`).join('')}</div>
  </div>`;
}

function purchase(product, variant) {
  const unavailable = !variant;
  const discount = variant?.discount || (variant?.oldPrice > variant?.price ? Math.round((1 - variant.price / variant.oldPrice) * 100) : 0);
  const price = variant ? money(variant.price) : '';
  const oldPrice = variant?.oldPrice > variant?.price ? money(variant.oldPrice) : '';
  const buyLabel = unavailable ? 'нет в наличии' : (product.kind === 'decor' ? 'в корзину' : 'купить');
  return `<div class="div price-button-wrapper__product__cms">
    ${product.kind === 'tree' ? `<div class="div price-wrapper__product"><div class="div offer-wrapper__product"><div class="text site-catalog__h1 color__h2 price"><span class="text-block-wrap-div">${price}</span></div><div data-prop-discount class="text offer__product site-catalog__h3"><span class="text-block-wrap-div">${discount ? `-${Math.abs(discount)}%` : ''}</span></div></div><div data-prop-offer class="text site__h4 color__h3" style="text-decoration:line-through"><span class="text-block-wrap-div">${oldPrice}</span></div></div>`
      : `<div data-price-decor class="text site-catalog__h1 color__h2 price"><span class="text-block-wrap-div">${price}</span></div>`}
    <div role="button" tabindex="0" data-cart-open class="button standart__button-4 buy-btn"${unavailable ? ' aria-disabled="true"' : ''}><span class="text-button"><span class="text-block-wrap-div">${buyLabel}</span></span></div>
  </div>`;
}

export function renderProductPage(template, product, route, description) {
  const variant = product.selectedVariant;
  const image = variant?.image || '';
  const [start, end] = divRange(template, 'product-wrapper__cms');
  let html = template.slice(start, end);
  const title = escape(product.title);
  const heading = `<div class="div title-description__gap"><h1 class="text site__h1 color__h1" style="margin:0;font-weight:400"><span class="text-block-wrap-div">${title}</span></h1>
    <div data-prop-description class="text color__h2 site__h3"><span class="text-block-wrap-div">${escape(description)}</span></div></div>`;
  html = replaceDiv(html, 'product__img-wrapper__cms', `<div class="div product__img-wrapper__cms" data-storefront-gallery-root><div class="image product__img__cms" data-storefront-image>${image ? `<img class="image__img" src="${escape(image)}" alt="${title}"${intrinsicSize(image)} loading="eager" fetchpriority="high" decoding="async">` : ''}<span data-storefront-photo-placeholder${image ? ' hidden' : ''}>Нет фото</span></div></div>`);
  html = replaceDiv(html, 'title-description__gap', heading);
  if (product.kind === 'tree') {
    html = replaceDiv(html, 'wrapper__list', treeProperties(variant));
    html = replaceDiv(html, 'input__product-wrapper', `<div class="div input__product-wrapper">${controls(product)}</div>`);
    html = replaceDiv(html, 'text-emoji__billet', '');
  } else {
    html = replaceDiv(html, 'input__catalog', controls(product));
    // The source rich-text contains dimensions/branches/material, not the feed description.
    // Keep this product-specific block until those properties are represented in decor.csv.
    // Newly added products have no captured layout and must not inherit basket dimensions.
    if (route.auto) html = replaceDiv(html, 'tt-rich-text', '');
  }
  html = replaceDiv(html, 'dop__img__cms', gallery(product, variant));
  html = replaceDiv(html, 'price-button-wrapper__product__cms', purchase(product, variant));
  const rootOpen = /<div\b[^>]*\bclass=['"][^'"]*\bproduct-wrapper__cms\b[^'"]*['"][^>]*>/;
  html = html.replace(rootOpen, tag => tag.replace(/>$/, () => ` data-storefront-product="${escape(product.id)}">`));
  return (template.slice(0, start) + html + template.slice(end))
    .replace(/<\/body>/i, () => `<script type="application/json" data-storefront-page-product>${jsonForHtml(product)}</script></body>`);
}
