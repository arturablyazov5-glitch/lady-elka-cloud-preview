(() => {
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname) || location.hostname.endsWith('.localhost');
  if (!('serviceWorker' in navigator) || !window.isSecureContext ||
      (local ? window.__LE_SW_TEST__ !== true : location.protocol !== 'https:') ||
      window.__LE_STOREFRONT_CONFIG__?.mode !== 'production' && !(local && window.__LE_SW_TEST__ === true)) return;
  // Existing controlled documents rely on the browser's normal update checks;
  // repeated register() calls would add a paid sw.js request on every page.
  if (navigator.serviceWorker.controller) return;
  const register = () => navigator.serviceWorker.register('/sw.js', { scope: '/', updateViaCache: 'none' }).then(async () => {
    await navigator.serviceWorker.ready;
    const seed = () => {
      const worker = navigator.serviceWorker.controller;
      if (!worker) return;
      // Recover first-document resources only from the HTTP cache. The worker
      // never issues a network request on a miss (including no-store hosting).
      worker.postMessage({ type: 'seed-http-cache', urls: performance.getEntriesByType('resource').map(entry => entry.name) });
    };
    if (navigator.serviceWorker.controller) seed();
    else navigator.serviceWorker.addEventListener('controllerchange', seed, { once: true });
  }).catch(() => {});
  const idle = () => 'requestIdleCallback' in window ? requestIdleCallback(register, { timeout: 2000 }) : setTimeout(register, 0);
  if (document.readyState === 'complete') idle();
  else window.addEventListener('load', idle, { once: true });
})();
