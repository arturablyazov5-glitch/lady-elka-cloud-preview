const LE_SW_CONFIG = {"release":"872ecb019ff53e38aa8dcee537a3410611418111d579a7cef49979a8d351f872","kill":true,"assets":{}};
/* Generated /sw.js prepends LE_SW_CONFIG. Only content-addressed static assets
   belong here. No precache, no API/HTML storage, no background revalidation. */
const { release, kill, assets } = LE_SW_CONFIG;
const PREFIX = 'le-static-';
const CACHE = PREFIX + release;
const MAX_ENTRIES = 512;
const MAX_TOTAL_BYTES = 64 * 1024 * 1024;
const MAX_OBJECT_BYTES = 4 * 1024 * 1024;
const HASHED = /^\/(?:assets|media\/(?:catalog-pinned|catalog-thumbs))\/([a-f0-9]{64})\.(?:css|js|woff2?|png|jpe?g|webp|avif|gif|svg|ico)$/;
const pending = new Map();
let writes = Promise.resolve();
self.addEventListener('install', event => {
  // Ordinary releases wait until all old controlled tabs close. Emergency
  // shutdown has no fetch handler and can safely take over immediately.
  if (kill) event.waitUntil(self.skipWaiting());
});
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter(name => kill || (name.startsWith(PREFIX) && name !== CACHE)).map(name => caches.delete(name)));
    if (kill) { await self.registration.unregister(); return; }
    await caches.open(CACHE);
    await self.clients.claim();
  })());
});
async function save(cache, request, response, expectedHash) {
  if (response.status !== 200 || response.type !== 'basic' || response.redirected ||
      /text\/html|application\/json/i.test(response.headers.get('Content-Type') || '') ||
      /private/i.test(response.headers.get('Cache-Control') || '') ||
      (response.headers.get('Vary') || '').split(',').some(v => v.trim() === '*')) return;
  // no-store on public hash assets is deliberately ignored: content identity
  // is independently verified; HTTP cache policy need not support SW storage.
  const announced = Number(response.headers.get('Content-Length'));
  if (announced > MAX_OBJECT_BYTES) return;
  const body = await response.clone().arrayBuffer();
  if (body.byteLength > MAX_OBJECT_BYTES) return;
  const sha = [...new Uint8Array(await crypto.subtle.digest('SHA-256', body))].map(b => b.toString(16).padStart(2, '0')).join('');
  if (sha !== expectedHash || (assets[new URL(request.url).pathname] !== undefined && assets[new URL(request.url).pathname] !== body.byteLength)) return;
  const headers = new Headers(response.headers);
  // arrayBuffer contains decoded bytes; do not describe them as gzip/br or
  // retain a compressed Content-Length in the constructed cached response.
  headers.delete('Content-Encoding');
  headers.delete('Content-Length');
  headers.set('X-LE-SW-Bytes', String(body.byteLength));
  const stored = new Response(body, { status: 200, statusText: response.statusText, headers });
  writes = writes.catch(() => {}).then(async () => {
    await cache.put(request, stored);
    const keys = await cache.keys();
    let bytes = 0;
    const sizes = [];
    for (const key of keys) {
      const entry = await cache.match(key);
      const size = Number(entry?.headers.get('X-LE-SW-Bytes')) || MAX_OBJECT_BYTES;
      sizes.push(size); bytes += size;
    }
    let count = keys.length;
    for (let i = 0; count > MAX_ENTRIES || bytes > MAX_TOTAL_BYTES; i++) {
      await cache.delete(keys[i]); bytes -= sizes[i]; count--;
    }
  });
  await writes;
}
if (!kill) self.addEventListener('fetch', event => {
  const request = event.request, url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin ||
      request.headers.has('Range') || request.headers.has('Authorization') || url.pathname === '/sw.js') return;
  if (request.mode === 'navigate') {
    // Always request fresh HTML, even with an incorrectly long HTTP TTL.
    event.respondWith(fetch(new Request(request, { cache: 'no-store' })));
    return;
  }
  const match = !url.search && HASHED.exec(url.pathname);
  if (!match) return;
  const task = (async () => {
    let cache;
    try { cache = await caches.open(CACHE); const hit = await cache.match(request); if (hit) return hit; }
    catch { return fetch(request); }
    let load = pending.get(request.url);
    if (!load) {
      load = (async () => {
        const response = await fetch(request);
        await save(cache, request, response, match[1]).catch(() => {});
        return response;
      })();
      pending.set(request.url, load);
      load.finally(() => pending.delete(request.url)).catch(() => {});
    }
    return (await load).clone();
  })();
  event.respondWith(task);
  event.waitUntil(task.then(() => {}, () => {}));
});

if (!kill) self.addEventListener('message', event => {
  if (event.data?.type !== 'seed-http-cache' || !Array.isArray(event.data.urls)) return;
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    for (const value of [...new Set(event.data.urls)].slice(0, MAX_ENTRIES)) {
      try {
        const url = new URL(value), match = HASHED.exec(url.pathname);
        if (url.origin !== self.location.origin || url.search || !match || await cache.match(url.href)) continue;
        const request = new Request(url.href, { cache: 'only-if-cached', mode: 'same-origin' });
        const response = await fetch(request); // HTTP cache miss = 504, never network
        await save(cache, request, response, match[1]);
      } catch { /* Browser lacks cache-only fetch or object was not retained. */ }
    }
  })());
});
