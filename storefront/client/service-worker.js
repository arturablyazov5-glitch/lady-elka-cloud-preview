/* Generated /sw.js prepends LE_SW_CONFIG. Only content-addressed static assets
   belong here. No precache, no API/HTML storage, no background revalidation. */
const { kill, assets } = LE_SW_CONFIG;
const PREFIX = 'le-static-';
const CACHE = PREFIX + 'v1';
const MAX_ENTRIES = 512;
const MAX_TOTAL_BYTES = 64 * 1024 * 1024;
const MAX_OBJECT_BYTES = 4 * 1024 * 1024;
const HASHED = /^\/(?:assets|media\/(?:catalog-pinned|catalog-thumbs))\/([a-f0-9]{64})\.(?:css|js|woff2?|png|jpe?g|webp|avif|gif|svg|ico)$/;
const pending = new Map();
let writes = Promise.resolve();
let sizes, totalBytes = 0;
async function inventory(cache) {
  if (sizes) return sizes;
  const loaded = new Map();
  for (const key of await cache.keys()) {
    const entry = await cache.match(key);
    loaded.set(key.url, Number(entry?.headers.get('X-LE-SW-Bytes')) || MAX_OBJECT_BYTES);
  }
  sizes = loaded;
  totalBytes = [...sizes.values()].reduce((total, size) => total + size, 0);
  return sizes;
}
self.addEventListener('install', event => {
  // Ordinary releases wait until all old controlled tabs close. Emergency
  // shutdown has no fetch handler and can safely take over immediately.
  if (kill) event.waitUntil(self.skipWaiting());
});
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    if (kill) {
      await Promise.all(names.map(name => caches.delete(name)));
      await self.registration.unregister(); return;
    }
    const cache = await caches.open(CACHE);
    const retained = request => {
      const url = new URL(request.url);
      return url.origin === self.location.origin && !url.search && Object.hasOwn(assets, url.pathname);
    };
    // Upgrade existing release caches without forcing unchanged assets back to
    // the network. These entries were already verified by the previous worker.
    for (const name of names.filter(name => name.startsWith(PREFIX) && name !== CACHE)) {
      const old = await caches.open(name);
      for (const key of await old.keys()) if (retained(key) && !await cache.match(key)) {
        const entry = await old.match(key);
        if (entry) await cache.put(key, entry);
      }
      await caches.delete(name);
    }
    for (const key of await cache.keys()) if (!retained(key)) await cache.delete(key);
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
    const entries = await inventory(cache);
    await cache.put(request, stored);
    totalBytes += body.byteLength - (entries.get(request.url) || 0);
    entries.set(request.url, body.byteLength);
    for (const [url, size] of entries) {
      if (entries.size <= MAX_ENTRIES && totalBytes <= MAX_TOTAL_BYTES) break;
      await cache.delete(url); entries.delete(url); totalBytes -= size;
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
  let saving = Promise.resolve();
  const task = (async () => {
    let cache;
    try { cache = await caches.open(CACHE); const hit = await cache.match(request); if (hit) return hit; }
    catch { return fetch(request); }
    let load = pending.get(request.url);
    if (!load) {
      load = (async () => {
        const response = await fetch(request);
        // Clone before handing the streaming response to the document.
        saving = save(cache, request, response.clone(), match[1]).catch(() => {});
        return response;
      })();
      pending.set(request.url, load);
      load.then(() => saving, () => {}).finally(() => pending.delete(request.url)).catch(() => {});
    }
    return (await load).clone();
  })();
  event.respondWith(task);
  event.waitUntil(task.then(() => saving, () => {}));
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
