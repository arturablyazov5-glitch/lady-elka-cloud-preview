import { pagePath } from '../url-path.mjs';
import { imagePreviewAttributes } from './image-preview.mjs';
import { catalogPhotos, escapeHtml as escape, jsonForHtml, money, presentProduct, productTitle } from './presentation.mjs';

// Build sets a resolver (Node, local files) so card photos carry intrinsic width/height (no layout shift).
let imageSizeResolver = null;
export function setImageSizeResolver(resolver) { imageSizeResolver = resolver; }
const attributeOf = (tag, name) => new RegExp(`\\s${name}=(["'])(.*?)\\1`, 'i').exec(tag)?.[2];
// Re-rendering a card in the browser (catalog-sync) keeps the loading hints/size of the same photo.
function inheritedImageAttributes(template, image) {
  // Match the original photo URL directly or via data-full-src (build-time preview thumbnails).
  const tag = (template.match(/<img\b[^>]*>/gi) || []).find(candidate => [attributeOf(candidate, 'src'), attributeOf(candidate, 'data-full-src')]
    .some(value => value?.replaceAll('&amp;', '&') === image));
  if (!tag) return null;
  return Object.fromEntries(['width', 'height', 'loading', 'fetchpriority'].map(name => [name, attributeOf(tag, name)]).filter(([, value]) => value));
}
export function productImageHtml(image, title, template = '') {
  if (!image) return '<span data-storefront-photo-placeholder>Нет фото</span>';
  const inherited = inheritedImageAttributes(template, image);
  const preview = imagePreviewAttributes(image);
  const size = inherited?.width ? inherited : imageSizeResolver?.(image) || (preview.width ? preview : null);
  const loading = inherited ? inherited.loading : 'lazy';
  const hints = `${size ? ` width="${Number(size.width)}" height="${Number(size.height)}"` : ''}${loading ? ` loading="${escape(loading)}"` : ''}${inherited?.fetchpriority ? ` fetchpriority="${escape(inherited.fetchpriority)}"` : ''} decoding="async"`;
  const previewHints = Object.entries(preview).filter(([key]) => !['src', 'width', 'height'].includes(key)).map(([key, value]) => ` ${key}="${escape(value)}"`).join('');
  return `<img class="image__img" src="${escape(preview.src)}" alt="${escape(title)}"${hints}${previewHints}><span data-storefront-photo-placeholder hidden>Нет фото</span>`;
}

function imageRatioStyle(image, template) {
  const inherited = inheritedImageAttributes(template, image);
  const size = inherited?.width ? inherited : imageSizeResolver?.(image) || imagePreviewAttributes(image);
  const width = Number(size?.width), height = Number(size?.height);
  return `--storefront-image-ratio:${width > 0 && height > 0 ? `${width}/${height}` : '3/4'}`;
}

const classValue = tag => /\bclass\s*=\s*(["'])(.*?)\1/i.exec(tag)?.[2] || '';
function templateTag(template, predicate, occurrence = 0) {
  let found = 0;
  for (const tag of template.match(/<[a-z][^>]*>/gi) || []) {
    if (!predicate(tag, classValue(tag))) continue;
    if (found++ === occurrence) return tag;
  }
  return '';
}
function templateClass(template, predicate, fallback, occurrence = 0) {
  const value = classValue(templateTag(template, predicate, occurrence));
  return value || fallback;
}
const hasData = (tag, name) => new RegExp(`\\b${name}\\b`).test(tag);
const byData = name => tag => hasData(tag, name);
const byClass = name => (_tag, classes) => classes.split(/\s+/).includes(name);
function classBeforeData(template, name, fallback) {
  const target = templateTag(template, byData(name));
  const targetIndex = target ? template.indexOf(target) : -1;
  if (targetIndex < 0) return fallback;
  const priorTags = [...template.slice(0, targetIndex).matchAll(/<[a-z][^>]*>/gi)].map(match => match[0]);
  for (let index = priorTags.length - 1; index >= 0; index--) {
    const classes = classValue(priorTags[index]);
    if (classes.includes('site__h3') && classes.includes('color__h3')) return classes;
  }
  return fallback;
}
function fieldHtml({ classes, labelClass, data, ariaLabel, value, options, icon = '/thumb/2/HbmxrgA55_3nkzXJnicbLg/r/d/chevron_down_2.svg' }) {
  return `<div class="${escape(classes)}" data-storefront-select><div data-storefront-${data}-label class="${escape(labelClass)}"><span class="text-block-wrap-div">${escape(value)}</span></div><div class="image down__img" aria-hidden="true"><img src="${escape(icon)}" alt="" class="image__img"></div><button type="button" class="storefront-select-trigger" aria-label="${escape(ariaLabel)}" aria-haspopup="listbox" aria-expanded="false"></button><select data-storefront-${data} aria-label="${escape(ariaLabel)}" aria-hidden="true" tabindex="-1">${options.map(option => `<option value="${escape(option.value)}">${escape(option.label)}</option>`).join('')}</select><div class="storefront-select-menu" role="listbox" hidden></div></div>`;
}

export function cardHtml(opening, product, route, template = '') {
  const categories = [...new Set(product.variants.map(variant => variant.category))];
  const initial = product.variants[0];
  const data = presentProduct(product, route);
  const categoryImage = category => data.variants.find(variant => variant.category === category)?.image || '';
  const serialized = jsonForHtml(data);
  const title = data.title;
  const image = categoryImage(initial.category);
  const hasBranches = Number(initial.branches) > 0;
  const discount = initial.discount || (initial.oldPrice > initial.price ? Math.round((1 - initial.price / initial.oldPrice) * 100) : 0);
  const imageClass = templateClass(template, (_tag, classes) => classes.includes('product__img'), 'image image--u-iv4xfnvjz product__img');
  const contentClass = templateClass(template, byClass('content__product'), 'div content__product');
  const propertiesClass = templateClass(template, byClass('property-content__product'), 'div property-content__product');
  const titleClass = templateClass(template, byData('data-prop-title'), 'text site-catalog__h1 color__h2');
  const diameterValueClass = templateClass(template, byData('data-prop-diam'), 'text site__h3 color__h2');
  const branchValueClass = templateClass(template, byData('data-prop-branches'), 'text site__h3 color__h2');
  const diameterLabelClass = classBeforeData(template, 'data-prop-diam', 'text site__h3 color__h3');
  const branchLabelClass = classBeforeData(template, 'data-prop-branches', 'text site__h3 color__h3');
  const diameterWrapperClass = templateClass(template, byClass('property__wrapper'), 'div property__wrapper', 0);
  const branchWrapperClass = templateClass(template, byClass('property__wrapper'), 'div property__wrapper', 1);
  const diameterRowClass = templateClass(template, byClass('item-list__shop'), 'list__item item-list__shop');
  const branchRowClass = templateClass(template, byClass('item_list'), 'list__item item_list');
  const categoryValueClass = templateClass(template, byData('data-prop-category'), 'text site-catalog__h3 color__h2');
  const heightValueClass = templateClass(template, byData('data-prop-height'), 'text site-catalog__h3 color__h2');
  const hasCategoryField = categories.length > 1 || Boolean(templateTag(template, byData('data-prop-category')));
  const categoryField = hasCategoryField ? fieldHtml({
    classes: 'div input__catalog', labelClass: categoryValueClass, data: 'category', ariaLabel: 'Вид ёлки', value: initial.category,
    options: categories.map(category => ({ value: category, label: category })),
  }) : '';
  const heightField = fieldHtml({
    classes: 'div input__catalog', labelClass: heightValueClass, data: 'variant', ariaLabel: 'Высота ёлки', value: `${initial.height} см.`,
    options: product.variants.filter(variant => variant.category === initial.category).map(variant => ({ value: variant.height, label: `${variant.height} см.` })),
  });
  const rootTag = opening.replace(/\sdata-tt-collection-item-id=(?:"[^"]*"|'[^']*')/g, '').replace(/>$/, ` data-storefront-product="${escape(product.id)}">`);
  return `${rootTag}
  <div class="${escape(imageClass)}" data-storefront-image style="display:flex;${imageRatioStyle(image, template)}">${productImageHtml(image, title, template)}</div>
  <div class="${escape(contentClass)}">
    <div class="${escape(propertiesClass)}">
      <div data-prop-title class="${escape(titleClass)}"><span class="text-block-wrap-div">${escape(title)}</span></div>
      <div class="list wrapper__list">
        <div class="${escape(diameterRowClass)}" data-storefront-diameter-row${initial.diameter ? '' : ' hidden'}><div class="div content-dot__list"><div class="div dot__list"></div><div class="${escape(diameterWrapperClass)}"><div class="${escape(diameterLabelClass)}"><span class="text-block-wrap-div">Диаметр — </span></div><div data-prop-diam class="${escape(diameterValueClass)}"><span class="text-block-wrap-div">${initial.diameter ? `${initial.diameter} см.` : ''}</span></div></div></div><div class="div divider" data-storefront-properties-divider${initial.diameter && hasBranches ? '' : ' hidden'}></div><div class="div divider div--u-iw5evcmty divider-no" data-storefront-properties-divider aria-hidden="true"${initial.diameter && hasBranches ? '' : ' hidden'}></div></div>
        <div class="${escape(branchRowClass)}" data-storefront-branches-row${hasBranches ? '' : ' hidden style="display:none"'}><div class="div content-dot__list"><div class="div dot__list"></div><div class="${escape(branchWrapperClass)}"><div class="${escape(branchLabelClass)}"><span class="text-block-wrap-div">Кол-во веток —</span></div><div data-prop-branches class="${escape(branchValueClass)}"><span class="text-block-wrap-div">${hasBranches ? `${initial.branches} шт.` : ''}</span></div></div></div></div>
      </div>
      ${categoryField}
      ${heightField}
    </div>
    <div class="div price-button-wrapper__product"><div class="div price-wrapper__product"><div class="div offer-wrapper__product">
      <div class="text color__h2 price site-catalog__h1"><span class="text-block-wrap-div">${money(initial.price)}</span></div>
      <div data-prop-discount class="text offer__product site-catalog__h3"><span class="text-block-wrap-div">${discount ? `-${Math.abs(discount)}%` : ''}</span></div>
    </div><div data-prop-offer class="text site__h4 color__h3" style="text-decoration:line-through"><span class="text-block-wrap-div">${initial.oldPrice > initial.price ? money(initial.oldPrice) : ''}</span></div></div>
    <div class="div button-wrapper__product"><div tabindex="0" data-cart-open role="button" class="button standart-catalog__button-2 buy-btn"><span class="text-button"><span class="text-block-wrap-div">купить</span></span></div>
      <a href="${escape(pagePath(route.path))}" class="button stroke-catalog__button"><span class="text-button"><span class="text-block-wrap-div">подробнее</span></span></a></div></div>
  </div><script type="application/json" data-storefront-variants>${serialized}</script></div>`;
}

export function decorCardHtml(opening, product, route, template = '') {
  const title = productTitle(product, route);
  const first = product.variants[0];
  const types = [...new Set(product.variants.map(variant => variant.category))];
  const imageFor = variant => catalogPhotos(variant.photos)[0] || '';
  const serialized = jsonForHtml(presentProduct(product, route));
  const rootTag = opening.replace(/\sdata-tt-collection-item-id=(?:"[^"]*"|'[^']*')/g, '').replace(/>$/, ` data-storefront-product="${escape(product.id)}">`);
  return `${rootTag}
    <div class="image product__img" data-storefront-image style="${imageRatioStyle(imageFor(first), template)}">${productImageHtml(imageFor(first), title, template)}</div>
    <div class="div content__product div--u-io63gnvw2">
      <div class="div title-and-input"><div class="div title-and-opisanie">
        <div class="text color__h2 site-catalog__h1"><span class="text-block-wrap-div">${escape(title)}</span></div>
      </div>
    ${types.length > 1 ? fieldHtml({ classes: 'div input__catalog', labelClass: templateClass(template, byData('data-prop-category'), 'text site-catalog__h3 color__h2'), data: 'category', ariaLabel: 'Тип декора', value: first.category, options: types.map(type => ({ value: type, label: type })) }) : ''}
      ${product.variants.length > 1 || first.size ? fieldHtml({ classes: 'div input__catalog', labelClass: templateClass(template, byData('data-prop-height'), 'text site-catalog__h3 color__h2'), data: 'variant', ariaLabel: 'Вариант декора', value: first.label || first.category, options: product.variants.filter(v => v.category === first.category).map(v => ({ value: v.size, label: v.label || v.category })) }) : ''}
      </div><div class="div price-button-wrapper__product"><div data-price-decor class="text color__h2 site-catalog__h1"><span class="text-block-wrap-div">${money(first.price)}</span></div>
      <div class="div button-wrapper__product"><div tabindex="0" data-cart-open role="button" class="button standart-catalog__button-2 buy-btn"><span class="text-button"><span class="text-block-wrap-div">в корзину</span></span></div>
      <a href="${escape(pagePath(route.path))}" class="button stroke-catalog__button"><span class="text-button"><span class="text-block-wrap-div">подробнее</span></span></a></div></div>
    </div><script type="application/json" data-storefront-variants>${serialized}</script></div>`;
}
