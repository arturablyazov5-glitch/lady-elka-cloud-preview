#!/usr/bin/env node
// node scripts/qa/request-budget.mjs --root=/tmp/le-request-before --out=agent-context/request-budget-before.json
// With SW: --service-worker --cache=revalidate (no-cache) or --cache=preview (no-store).
// Counts actual origin receipts, including worker update checks; steady = third visit.
// Optional --base=http://127.0.0.1:PORT uses an existing server without stopping it.
import { createRequire } from 'node:module';
import { readdir, mkdir, writeFile, readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { resolve, dirname, join } from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
const arg = (key, fallback) => process.argv.find(x => x.startsWith(`--${key}=`))?.slice(key.length + 3) || fallback;
let pw = process.env.PLAYWRIGHT_PACKAGE_JSON;
if (!pw) {
  try { pw = createRequire(import.meta.url).resolve('playwright/package.json'); }
  catch { for (const entry of await readdir(join(process.env.HOME, '.npm/_npx')).catch(() => [])) {
    const candidate = join(process.env.HOME, '.npm/_npx', entry, 'node_modules/playwright/package.json');
    try { createRequire(candidate)('playwright'); pw = candidate; break; } catch {}
  } }
}
if (!pw) throw new Error('Install Playwright or set PLAYWRIGHT_PACKAGE_JSON');
const { chromium } = createRequire(pw)('playwright');
const out = resolve(arg('out', 'agent-context/request-budget.json'));
const root = resolve(arg('root', 'storefront/production/dist'));
const cards = Number(arg('cards', '3'));
if (![2, 3].includes(cards)) throw new Error('--cards must be 2 or 3');
const width = Number(arg('width', '390'));
const cache = arg('cache', 'production');
const serviceWorker = process.argv.includes('--service-worker');
if (process.argv.includes('--rebuild') && !serviceWorker) throw new Error('--rebuild requires --service-worker');
let hostRecords = [], step = '';
if (serviceWorker && arg('base')) throw new Error('SW measurement requires own server for actual origin request counts');
if (!['production', 'preview', 'revalidate'].includes(cache)) throw new Error('--cache must be production, revalidate (no-cache), or preview (no-store)');
let child, base = arg('base');
if (!base) {
  child = spawn(process.execPath, ['storefront/server.mjs', '--mode=preview', `--root=${root}`, `--cache=${cache}`, '--qa-request-log', ...(process.argv.includes('--emulate-host') ? ['--emulate-host'] : [])], { env: { ...process.env, STOREFRONT_PORT: '0' }, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
  child.on('message', row => { if (row.type === 'qa-request') hostRecords.push({ ...row, step }); });
  base = await new Promise((ok, fail) => {
    let logs = '';
    child.stdout.on('data', bytes => { logs += bytes; const port = /localhost:(\d+)/.exec(logs)?.[1]; if (port) ok(`http://127.0.0.1:${port}`); });
    child.on('exit', code => fail(new Error(`Own preview exited ${code}`)));
    child.stderr.on('data', () => {});
  });
}
const origin = new URL(base).origin;
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
const context = await browser.newContext({ viewport: { width, height: 900 }, deviceScaleFactor: 1, reducedMotion: 'reduce', locale: 'ru-RU' });
if (serviceWorker) await context.addInitScript(() => { window.__LE_SW_TEST__ = true; });
let page = await context.newPage();
const cdp = await context.newCDPSession(page);
await cdp.send('Network.enable');
let records = [], cached = new Set(), inFlight = new Map(), errors = [];
page.on('pageerror', error => errors.push(error.message));
cdp.on('Network.requestWillBeSent', e => {
  // Redirects generate another request with the same id: retain both.
  const url = new URL(e.request.url);
  if (!/^https?:$/.test(url.protocol)) return;
  const row = { id: e.requestId, step, url: e.request.url, method: e.request.method, type: e.type || 'Other', group: url.origin === origin ? 'hosting' : /(^|\.)supabase\.co$/.test(url.hostname) ? 'supabase' : 'external', range: e.request.headers.Range || e.request.headers.range || null, cached: false };
  records.push(row); inFlight.set(e.requestId, row);
});
cdp.on('Network.requestServedFromCache', e => { cached.add(e.requestId); if (inFlight.has(e.requestId)) inFlight.get(e.requestId).cached = true; });
cdp.on('Network.responseReceived', e => {
  const row = inFlight.get(e.requestId); if (!row) return;
  row.status = e.response.status; row.cacheControl = e.response.headers['Cache-Control'] || e.response.headers['cache-control'] || null;
  row.fromServiceWorker = e.response.fromServiceWorker || false;
  row.cached = row.cached || e.response.fromDiskCache || e.response.fromPrefetchCache || e.response.fromServiceWorker || false;
});
cdp.on('Network.loadingFailed', e => {
  const row = inFlight.get(e.requestId);
  if (row) row.failure = e.errorText;
});
const settle = () => page.waitForTimeout(1000);
async function visit(path, label) { step = label; await page.goto(new URL(path, base).href, { waitUntil: 'networkidle' }); await settle(); }
async function scroll() {
  await page.evaluate(async () => { for (let y = 0; y < document.documentElement.scrollHeight; y += 700) { scrollTo(0, y); await new Promise(r => setTimeout(r, 90)); } });
  await settle();
}
async function shot(name) {
  if (!arg('shots')) return;
  await mkdir(arg('shots'), { recursive: true });
  await page.addStyleTag({ content: '*{animation:none!important;transition:none!important;caret-color:transparent!important}video{visibility:hidden!important}' });
  await page.evaluate(() => scrollTo(0, 0)); await settle();
  await page.screenshot({ path: join(arg('shots'), `${name}-${width}.png`), fullPage: true, animations: 'disabled' });
}
function summary(rows) {
  const network = rows.filter(r => !r.cached), groups = {};
  for (const group of ['hosting', 'supabase', 'external']) {
    const list = network.filter(r => r.group === group), types = {};
    for (const r of list) types[r.type] = (types[r.type] || 0) + 1;
    groups[group] = { redirects308: list.filter(r => r.status === 308).length, requests: list.length, types, range: list.filter(r => r.range).length, failures: list.filter(r => r.status >= 400 || r.failure).map(r => ({ url: r.url, status: r.status, failure: r.failure })) };
  }
  return { ...groups, cacheHits: rows.length - network.length, steps: Object.fromEntries([...new Set(rows.map(r => r.step))].map(s => [s, network.filter(r => r.step === s && r.group === 'hosting').length])) };
}
const modes = {};
const rebuild = process.argv.includes('--rebuild');
const originalWorker = rebuild ? await readFile(join(root, 'sw.js')) : null;
try {
  let paths;
  for (const mode of (serviceWorker ? ['cold', 'repeat', 'steady', ...(rebuild ? ['rebuilt'] : [])] : ['cold', 'repeat'])) {
    if (mode === 'rebuilt') {
      // A changed release with exactly the same asset manifest models a price/HTML-only build.
      const source = originalWorker.toString();
      await writeFile(join(root, 'sw.js'), source.replace(/"release":"([^"]+)"/, (_, release) => '"release":"' + release + '-qa-rebuild"'));
      await page.evaluate(async () => { await (await navigator.serviceWorker.getRegistration('/')).update(); });
      await page.waitForFunction(async () => !!(await navigator.serviceWorker.getRegistration('/'))?.waiting);
      await page.goto('about:blank');
      await page.waitForTimeout(500);

    }
    records = []; hostRecords = []; cached.clear(); inFlight.clear(); errors = [];
    await visit('/', 'home');
    if (serviceWorker) await page.waitForFunction(() => !!navigator.serviceWorker.controller);
    await scroll(); if (mode === 'cold') await shot('home');
    const catalogPath = await page.locator('a[href="/catalog"], a[href="/catalog/"]').first().getAttribute('href');
    await visit(catalogPath, 'catalog'); await scroll(); if (mode === 'cold') await shot('catalog');
    paths ||= await page.locator('a.stroke-catalog__button[href^="/tree/"]').evaluateAll((nodes, count) => [...new Set(nodes.map(n => n.getAttribute('href')))].slice(0, count), cards);
    if (paths.length !== cards) throw new Error(`Expected ${cards} tree links, got ${paths.length}`);
    const actions = [];
    for (const path of paths) {
      await visit(path, path);
      const select = page.locator('[data-storefront-option="height"]').first();
      const values = await select.locator('option').evaluateAll(nodes => nodes.map(n => n.value));
      if (values.length < 3) throw new Error(`Need >=3 heights: ${path}`);
      const chosen = values.slice(0, 3);
      for (const value of chosen) { await select.selectOption(value); await settle(); }
      const img = page.locator('[data-storefront-gallery-root] img, [data-storefront-gallery] img').first();
      await img.click(); await settle();
      await page.locator('[data-gallery-next]').click(); await settle();
      await page.locator('[data-gallery-close]').click();
      if (mode === 'cold') await shot(path.split('/').filter(Boolean).at(-1));
      const buy = page.locator('[data-storefront-product] .buy-btn').first();
      if (await buy.count()) { await buy.click(); await settle(); await page.keyboard.press('Escape'); }
      actions.push({ path, heights: chosen, gallery: true });
    }
    step = 'cart'; await page.locator('[data-cart-open]:visible').first().click(); await settle();
    if (!await page.locator('[data-cart-popup]').isVisible()) throw new Error('Cart did not open');
    if (mode === 'cold') await shot('cart');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(100);
    const actualHost = hostRecords.map(row => ({ ...row, url: new URL(row.url, base).href, group: 'hosting', type: row.url === '/sw.js' ? 'ServiceWorker' : /\.(?:css)(?:\?|$)/.test(row.url) ? 'Stylesheet' : /\.js(?:\?|$)/.test(row.url) ? 'Script' : /\.woff2?(?:\?|$)/.test(row.url) ? 'Font' : /\.(?:webp|png|jpg|jpeg|svg|ico)(?:\?|$)/.test(row.url) ? 'Image' : 'Document' }));
    const measured = summary(records);
    measured.cdpCacheOrWorkerResponses = measured.cacheHits;
    if (child) {
      const origin = summary(actualHost); measured.hosting = origin.hosting; measured.steps = origin.steps;
      // fromServiceWorker includes network misses. Derive actual asset hits
      // from visible page requests minus actual asset receipts instead.
      const pageAssets = records.filter(row => row.group === 'hosting' && !['Document','ServiceWorker'].includes(row.type));
      const originAssets = actualHost.filter(row => !['Document','ServiceWorker'].includes(row.type));
      measured.cacheHits = Math.max(0, pageAssets.length - originAssets.length);
    }
    const expectedAssets = arg('expect-rebuild-assets');
    if (mode === 'rebuilt' && expectedAssets !== undefined) assert.equal(actualHost.filter(row => !['Document', 'ServiceWorker'].includes(row.type)).length, Number(expectedAssets), 'unchanged assets downloaded after rebuild');
    console.log(mode + ': ' + measured.hosting.requests + ' origin requests');
    const cacheNames = serviceWorker ? await page.evaluate(() => caches.keys()) : [];
    modes[mode] = { ...measured, actualOriginRequests: actualHost, cacheNames, actions, errors, records: records.map(({ id, ...rest }) => rest) };
  }
  await mkdir(dirname(out), { recursive: true });
  const manifest = await readFile(join(root, 'build-manifest.json')).catch(() => null);
  await writeFile(out, JSON.stringify({ capturedAt: new Date().toISOString(), root, width, browser: browser.version(), serviceWorker, hostEmulation: process.argv.includes('--emulate-host'), cards, cacheMode: child ? cache : 'existing-server', buildManifestSha256: manifest && createHash('sha256').update(manifest).digest('hex'), cachePolicy: 'Own server receipts count SW network misses and sw.js checks; CDP fromServiceWorker alone does not prove a cache hit; server response headers; cold fresh context, repeat same context, no interception; cached CDP events excluded, redirects and 304 counted', modes }, null, 2) + '\n');
  console.log(JSON.stringify(Object.fromEntries(Object.entries(modes).map(([k,v]) => [k, { hosting: v.hosting, supabase: v.supabase.requests, external: v.external.requests, steps: v.steps, cacheHits: v.cacheHits, errors: v.errors }])), null, 2));
} finally { await browser.close(); child?.kill('SIGTERM'); if (originalWorker) await writeFile(join(root, 'sw.js'), originalWorker); }
