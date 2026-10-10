export function initGallery() {
  const overlay = document.createElement('div');
  overlay.className = 'storefront-lightbox'; overlay.hidden = true;
  overlay.innerHTML = '<button type="button" data-gallery-close aria-label="Закрыть"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg></button><button type="button" data-gallery-prev aria-label="Предыдущее фото"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15 18-6-6 6-6"/></svg></button><img alt=""><button type="button" data-gallery-next aria-label="Следующее фото"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 18 6-6-6-6"/></svg></button>';
  document.body.append(overlay);
  let photos = [], index = 0;
  const image = overlay.querySelector('img');
  const show = () => { image.src = photos[index]?.dataset.fullSrc || photos[index]?.src || ''; image.alt = photos[index]?.alt || ''; };
  const close = () => { overlay.hidden = true; document.body.style.overflow = ''; };
  document.addEventListener('click', event => {
    const source = event.target.closest('[data-storefront-gallery-root] img, [data-storefront-gallery] img');
    if (!source) return;
    const root = source.closest('[data-storefront-product]');
    photos = [...root.querySelectorAll('[data-storefront-gallery-root] img, [data-storefront-gallery] img')];
    index = photos.indexOf(source); if (index < 0) return;
    show(); overlay.hidden = false; document.body.style.overflow = 'hidden';
  });
  overlay.addEventListener('click', event => {
    if (event.target === overlay || event.target.closest('[data-gallery-close]')) close();
    else if (event.target.closest('[data-gallery-prev],[data-gallery-next]')) {
      index = (index + (event.target.closest('[data-gallery-next]') ? 1 : -1) + photos.length) % photos.length; show();
    }
  });
  document.addEventListener('keydown', event => {
    if (overlay.hidden) return;
    if (event.key === 'Escape') close();
    if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
      index = (index + (event.key === 'ArrowRight' ? 1 : -1) + photos.length) % photos.length; show();
    }
  });
}
