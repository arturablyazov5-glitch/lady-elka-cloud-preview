#!/usr/bin/env node
/**
 * Repeatable visual parity capture for the old Taptop site and local storefront.
 *
 * Usage (Playwright may be installed outside the repository):
 *   PLAYWRIGHT_PACKAGE_JSON=/tmp/le-pw/package.json node scripts/qa/visual-diff.mjs
 *
 * It intentionally freezes CSS animation/video, captures matching viewports,
 * and prints both a pixel metric and a small DOM/content fingerprint.  The
 * result is evidence for a human QA report, not a pass/fail golden test:
 * photographs and remote Taptop markup make a zero pixel delta unrealistic.
 */
import { createRequire } from 'node:module';
import { mkdir, rm, readdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import sharp from 'sharp';

const require = createRequire(process.env.PLAYWRIGHT_PACKAGE_JSON || import.meta.url);
const { chromium } = require('playwright');

const localBase = process.env.LOCAL_BASE_URL || 'http://localhost:4174';
const liveBase = process.env.LIVE_BASE_URL || 'https://lady-elka.ru';
const output = path.resolve(process.env.VISUAL_DIFF_DIR || 'agent-context/visual-diff');
const scratch = path.join(output, '.run');
const chrome = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const widths = [390, 1280];
const allPages = [
  ['home', '/', 'Главная'],
  ['trees', '/catalog', 'Каталог ёлок'],
  ['decor-tui', '/decor', 'Каталог декора'],
  ['tui', '/catalog/landscape-gardening', 'Каталог туй'],
  ['tree-product', '/tree/miranda', 'Карточка ёлки'],
  ['tree-silviya', '/tree/silviya', 'Сильвия'],
  ['tree-vendi', '/tree/vendi', 'Венди'],
  ['tui-product', '/tree/tuya-smaragd', 'Карточка туи'],
  ['decor-product', '/catalog-tree/venok-naturalnyj', 'Карточка декора'],
  ['blog', '/blog', 'Блог'],
  // These are real sections on the original, rather than invented routes.
  ['delivery', '/#ifm28hfzl_0', 'Доставка (секция)'],
  ['contacts', '/#igibh7oyl_0', 'Контакты (секция)'],
  ['not-found', '/__visual-diff-not-found__', '404'],
];
const pages = process.env.VISUAL_DIFF_PAGES ? allPages.filter(([slug]) => process.env.VISUAL_DIFF_PAGES.split(',').includes(slug)) : allPages.filter(([slug]) => !['tree-silviya', 'tree-vendi'].includes(slug));
if (process.env.VISUAL_DIFF_CART === '1') pages.push(['cart', '/tree/miranda', 'Корзина']);
const keepPairs = new Set(['home-390', 'trees-1280', 'decor-product-390']);
const freezeCss = `
  *, *::before, *::after { animation: none !important; transition: none !important; caret-color: transparent !important; }
  video { visibility: hidden !important; }
`;

function fileStem(slug, width, side) { return `${slug}-${width}-${side}.png`; }
function normalise(value) { return value.replace(/\s+/g, ' ').trim(); }

async function fingerprint(page) {
  return page.evaluate(() => {
    const visible = (node) => {
      const style = getComputedStyle(node);
      const rect = node.getBoundingClientRect();
      return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
    };
    const text = [...document.querySelectorAll('h1,h2,h3,p,a,button,label')]
      .filter(visible).map((node) => node.innerText).filter(Boolean).join(' ');
    return {
      title: document.title,
      h1: [...document.querySelectorAll('h1')].filter(visible).map((node) => node.innerText.trim()),
      text: text.replace(/\s+/g, ' ').trim().slice(0, 1200),
      images: [...document.images].filter(visible).map((img) => img.currentSrc || img.src).filter(Boolean).slice(0, 80),
      visibleImages: [...document.images].filter(visible).length,
      documentHeight: Math.round(document.documentElement.scrollHeight),
    };
  });
}

async function pixelMetric(leftFile, rightFile) {
  const [left, right] = await Promise.all([
    sharp(leftFile).ensureAlpha().raw().toBuffer({ resolveWithObject: true }),
    sharp(rightFile).ensureAlpha().raw().toBuffer({ resolveWithObject: true }),
  ]);
  const width = Math.min(left.info.width, right.info.width);
  const height = Math.min(left.info.height, right.info.height);
  let changed = 0;
  let sampled = 0;
  // One sample per 2×2 pixel block keeps full-page captures inexpensive.
  for (let y = 0; y < height; y += 2) for (let x = 0; x < width; x += 2) {
    const a = (y * left.info.width + x) * 4;
    const b = (y * right.info.width + x) * 4;
    const delta = Math.abs(left.data[a] - right.data[b]) + Math.abs(left.data[a + 1] - right.data[b + 1]) + Math.abs(left.data[a + 2] - right.data[b + 2]);
    if (delta > 90) changed++;
    sampled++;
  }
  return { common: `${width}×${height}`, sizeMismatch: left.info.width !== right.info.width || left.info.height !== right.info.height, changedPct: +(changed / sampled * 100).toFixed(1) };
}

async function capture(browser, base, route, width, file, slug) {
  const context = await browser.newContext({ viewport: { width, height: 900 }, deviceScaleFactor: 1, locale: 'ru-RU', colorScheme: 'light', reducedMotion: process.env.VISUAL_DIFF_REDUCED_MOTION || 'no-preference' });
  const withWorker = process.env.VISUAL_DIFF_SERVICE_WORKER === '1' && base === localBase;
  if (withWorker) await context.addInitScript(() => { window.__LE_SW_TEST__ = true; });
  const page = await context.newPage();
  if (withWorker && slug === 'not-found') { await page.goto(new URL('/', base).href, { waitUntil: 'networkidle' }); await page.waitForFunction(() => !!navigator.serviceWorker.controller); }
  await page.addStyleTag({ content: freezeCss });
  await page.goto(new URL(route, base).href, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  if (withWorker) {
    await page.waitForFunction(() => !!navigator.serviceWorker.controller);
    await page.goto(new URL(route, base).href, { waitUntil: 'networkidle' });
  }
  await page.waitForTimeout(1_000);
  await page.addStyleTag({ content: freezeCss });
  // A full-page screenshot does not scroll through the document, so native
  // loading=lazy images below the fold would otherwise look like a false
  // visual regression on the local static build.
  await page.evaluate(async () => {
    const bottom = document.documentElement.scrollHeight;
    for (let y = 0; y < bottom; y += Math.max(innerHeight - 120, 300)) {
      scrollTo(0, y);
      await new Promise((resolve) => setTimeout(resolve, 45));
    }
    scrollTo(0, 0);
  });
  await page.waitForTimeout(500);
  if (route.includes('#')) await page.evaluate(() => scrollTo(0, document.documentElement.scrollHeight > innerHeight ? location.hash && document.querySelector(location.hash)?.getBoundingClientRect().top + scrollY || 0 : 0));
  await page.waitForTimeout(250);
  if (slug === 'cart') {
    await page.locator('[data-storefront-product] .buy-btn').first().click();
    await page.waitForTimeout(1000);
  }
  const data = await fingerprint(page);
  await page.screenshot({ path: file, fullPage: true, animations: 'disabled' });
  await context.close();
  return data;
}

async function removeScratchButSamples() {
  const files = await readdir(scratch);
  for (const file of files) {
    const match = /^(.*)-(390|1280)-(local|live)\.png$/.exec(file);
    if (match && process.env.VISUAL_DIFF_KEEP_ALL === '1') continue;
    if (match && keepPairs.has(`${match[1]}-${match[2]}`)) continue;
    await rm(path.join(scratch, file), { force: true });
  }
  for (const file of await readdir(scratch)) await rm(path.join(output, file), { force: true });
  for (const file of await readdir(scratch)) await BunOrNodeRename(path.join(scratch, file), path.join(output, file));
  await rm(scratch, { recursive: true, force: true });
}

async function BunOrNodeRename(from, to) {
  const { rename } = await import('node:fs/promises');
  await rename(from, to);
}

await mkdir(scratch, { recursive: true });
for (const file of await readdir(output)) {
  if (file.endsWith('.png')) await rm(path.join(output, file), { force: true });
}
for (const file of await readdir(scratch)) await rm(path.join(scratch, file), { recursive: (await stat(path.join(scratch, file))).isDirectory(), force: true });
const browser = await chromium.launch({ executablePath: chrome, headless: true, args: ['--disable-gpu'] });
const results = [];
try {
  for (const [slug, route, label] of pages) for (const width of widths) {
    const localFile = path.join(scratch, fileStem(slug, width, 'local'));
    const liveFile = path.join(scratch, fileStem(slug, width, 'live'));
    // Full-page home/catalog screenshots are large.  Capturing them in parallel
    // can make macOS Chrome terminate under memory pressure, so keep the pair
    // sequential even though each page uses its own clean browser context.
    const local = await capture(browser, localBase, route, width, localFile, slug);
    const live = await capture(browser, liveBase, route, width, liveFile, slug);
    const pixel = await pixelMetric(localFile, liveFile);
    results.push({ label, route, width, pixel, local, live, titleSame: local.title === live.title, h1Same: JSON.stringify(local.h1) === JSON.stringify(live.h1), textSame: local.text === live.text, imageCountSame: local.visibleImages === live.visibleImages });
  }
} finally {
  await browser.close();
}
console.table(results.map((r) => ({ page: r.label, width: r.width, pixelChanged: `${r.pixel.changedPct}%`, common: r.pixel.common, sizeMismatch: r.pixel.sizeMismatch, h1: r.h1Same ? 'same' : 'DIFF', text: r.textSame ? 'same' : 'DIFF', images: r.imageCountSame ? 'same' : `${r.local.visibleImages}/${r.live.visibleImages}` })));
await writeFile(path.join(output, 'results.json'), JSON.stringify(results, null, 2));
await removeScratchButSamples();
console.log(`Kept 6 representative PNGs in ${output}; all other captures were removed.`);
