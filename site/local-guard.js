(() => {
  const local = ['localhost', '127.0.0.1', '::1', '[::1]'].includes(location.hostname) || location.hostname.endsWith('.localhost') || location.protocol === 'file:';
  if (!local) return;
  const supabase = 'https://mgnotvaahftrbifqtahf.supabase.co';
  // A candidate preview artifact keeps its own bundled feeds (/__offline/catalog/*.csv, same origin); otherwise read live public feeds.
  const bundled = /^\/__offline\/catalog\/trees\.csv$/.test(window.__LE_STOREFRONT_CONFIG__?.catalog?.trees || '');
  if (!bundled) window.__LE_STOREFRONT_CONFIG__ = { mode: 'preview', catalog: { trees: `${supabase}/storage/v1/object/public/le-catalog-feeds/trees.csv`, decor: `${supabase}/storage/v1/object/public/le-catalog-feeds/decor.csv`, promos: `${supabase}/storage/v1/object/public/le-catalog-feeds/promos.csv` }, payment: null, mediaMap: window.__LE_STOREFRONT_CONFIG__?.mediaMap || null };
  const original = window.fetch.bind(window);
  window.fetch = async (input, init) => {
    const request = new Request(input instanceof Request ? input : new URL(input, location.href), init);
    const url = new URL(request.url);
    const isPublicCatalogFeed = url.origin === supabase && /^\/storage\/v1\/object\/public\/le-catalog-feeds\/(trees|decor|promos)\.csv$/.test(url.pathname);
    if (!(url.origin === location.origin || isPublicCatalogFeed) || !['GET', 'HEAD'].includes(request.method)) throw new TypeError('Only Supabase catalog reads are enabled in local preview');
    return original(new Request(request, { redirect: 'error' }));
  };
})();
