import { deferredImageAttributes } from '../products/lazy-images.mjs';
import { imagePreviewAttributes } from '../products/image-preview.mjs';
export function setProductImage(root, src, title) {
  const container = root.querySelector('[data-storefront-image]');
  if (!container) return;
  let image = container.querySelector('img');
  let placeholder = container.querySelector('[data-storefront-photo-placeholder]');
  if (!placeholder) {
    placeholder = document.createElement('span');
    placeholder.setAttribute('data-storefront-photo-placeholder', '');
    placeholder.textContent = 'Нет фото';
    container.append(placeholder);
  }
  placeholder.hidden = Boolean(src);
  if (!src) { image?.remove(); return; }
  if (!image) { image = document.createElement('img'); image.className = 'image__img'; image.decoding = 'async'; container.prepend(image); }
  const main = root.querySelector('[data-storefront-gallery-root]');
  const attributes = main ? { src } : deferredImageAttributes(imagePreviewAttributes(src));
  if (main) image.loading = 'eager';
  else image.loading = 'lazy';
  for (const name of ['srcset', 'sizes', 'data-le-srcset', 'data-le-sizes']) if (!(name in attributes)) image.removeAttribute(name);
  for (const name of ['data-full-src']) if (!(name in attributes)) image.removeAttribute(name);
  for (const [name, value] of Object.entries(attributes)) if (image.getAttribute(name) !== String(value)) image.setAttribute(name, value);
  image.alt = title || '';
  window.__LE_LOAD_VISIBLE_IMAGES__?.();
}
