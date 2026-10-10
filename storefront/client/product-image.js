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
  const attributes = root.querySelector('[data-storefront-gallery-root]') ? { src } : imagePreviewAttributes(src);
  for (const name of ['srcset', 'sizes', 'data-full-src']) if (!(name in attributes)) image.removeAttribute(name);
  for (const [name, value] of Object.entries(attributes)) if (image.getAttribute(name) !== String(value)) image.setAttribute(name, value);
  image.alt = title || '';
}
