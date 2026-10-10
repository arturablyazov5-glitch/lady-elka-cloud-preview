// Only immutable feeds embedded by this offline build are served from memory.
// Live Supabase endpoints are deliberately untouched, including checkout revalidation.
(() => {
  const data = window.__LE_SNAPSHOT_READS__;
  if (!data) return;
  const original = window.fetch.bind(window);
  window.fetch = (input, init) => {
    const request = new Request(input instanceof Request ? input : new URL(input, location.href), init);
    const url = new URL(request.url);
    if (request.method === 'GET' && url.origin === location.origin && Object.hasOwn(data, url.pathname)) {
      const entry = data[url.pathname];
      return Promise.resolve(new Response(entry.body, { status: 200, headers: { 'Content-Type': entry.type } }));
    }
    return original(input, init);
  };
})();
