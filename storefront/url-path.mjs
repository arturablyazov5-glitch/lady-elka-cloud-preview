// Directory pages are served directly only with a trailing slash on Timeweb.
// File URLs, query strings, fragments and the root keep their spelling.
export function pagePath(value) {
  return String(value).replace(/^([^?#]*)([?#].*)?$/, (_, path, suffix = '') =>
    (path === '/' || /\.(?:html?|xml|txt|json|csv|css|m?js|map|pdf|gz|zip|png|jpe?g|webp|avif|gif|svg|ico|mp4|webm|woff2?|ttf)$/i.test(path) ? path : path.replace(/\/+$/, '') + '/') + suffix);
}
