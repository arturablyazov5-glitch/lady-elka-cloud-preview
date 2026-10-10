let buildMap;
export function setPreviewImages(map) { buildMap = map; }
export function previewImage(src) {
  return (buildMap || globalThis.__LE_STOREFRONT_CONFIG__?.thumbnails)?.[src];
}
export function imagePreviewAttributes(src, gallery = false) {
  const variants = previewImage(src);
  if (!variants) return { src };
  const small = variants[240], large = variants[480];
  return { src: large.url, srcset: `${small.url} ${small.width}w, ${large.url} ${large.width}w`,
    sizes: gallery ? '(max-width: 768px) 140px, 120px' : '(max-width: 600px) 100vw, 360px',
    width: large.width, height: large.height, 'data-full-src': src };
}
