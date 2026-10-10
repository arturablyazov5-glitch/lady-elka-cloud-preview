import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { loadFeed, readManifest } from './products/build-feed.mjs';
import { treeProducts, decorProducts } from './products/model.mjs';
import { presentProduct, escapeHtml as escape } from './products/presentation.mjs';
import { renderProductPage, withProductLayout } from './products/product-page.mjs';
import { buildRoutes } from './products/routes.mjs';

const root = import.meta.dirname;
const target = process.env.LE_BUILD_TARGET || join(root, 'dist');
const buildSnapshot = await readManifest();
const base = `offline:${buildSnapshot.id} (freshness unverified)`;
const routes = await buildRoutes();
const templates = {
  tree: await readFile(join(root, 'public/tree/miranda.html'), 'utf8'),
  decor: await readFile(join(root, 'public/catalog-tree/korzina-pod-yelku.html'), 'utf8'),
};
const rows = { tree: await loadFeed('trees'), decor: await loadFeed('decor') };
const products = { tree: treeProducts(rows.tree), decor: decorProducts(rows.decor) };
const report = { source: base, feed: {}, routes: routes.length, generated: 0, details: [], unavailable: [], missingSourceDescriptions: [], errors: [] };
for (const kind of ['tree', 'decor']) {
  report.feed[kind] = { rows: rows[kind].length, activeProducts: [...products[kind].values()].filter(p => p.variants.length).length };
  const mapped = new Set(routes.filter(r => r.kind === kind).map(r => r.id));
  for (const [id, product] of products[kind]) if (!mapped.has(id)) {
    if (product.variants.length) report.errors.push({ kind, id, error: 'Snapshot product has no known public URL' });
    else (report.hiddenWithoutRoute ||= []).push({ kind, id });
  }
}
report.uniqueProducts = products.tree.size + products.decor.size;
report.activeProducts = report.feed.tree.activeProducts + report.feed.decor.activeProducts;
function metadata(html, route, product, description) {
  const variant = product.selectedVariant;
  const canonical = `https://lady-elka.ru${route.path}`;
  const image = variant?.image || '';
  const structured = {
    '@context': 'https://schema.org', '@type': 'Product', name: product.title, description,
    image: image ? [image] : [], url: canonical,
    offers: { '@type': 'Offer', priceCurrency: 'RUB', price: variant?.price || 0,
      availability: variant ? 'https://schema.org/InStock' : 'https://schema.org/OutOfStock', url: canonical },
  };
  html = html.replace(/<title>[^<]*<\/title>/, () => `<title>${escape(product.title)}</title>`)
    .replace(/<meta name="description" content="[^"]*">/, () => `<meta name="description" content="${escape(description)}">`)
    .replace(/<meta property="og:url" content="[^"]*">/, () => `<meta property="og:url" content="${canonical}">`);
  return html.replace(/<head>/i, () => `<head><base href="/"><script src="/f/storefront-config.js"></script><script src="/local-guard.js"></script><link rel="canonical" href="${canonical}"><meta property="og:title" content="${escape(product.title)}"><meta property="og:description" content="${escape(description)}"><meta property="og:image" content="${escape(image)}"><script type="application/ld+json">${JSON.stringify(structured).replaceAll('<', '\\u003c')}</script>`);
}
for (const route of routes) {
  try {
    // A saved URL whose product was deleted in the cabinet stays reachable and renders as unavailable.
    const source = products[route.kind].get(route.id) || { id: route.id, title: route.liveTitle, variants: [] };
    if (!products[route.kind].has(route.id)) report.removedFromFeed = [...(report.removedFromFeed || []), route.path];
    const product = presentProduct(source, route);
    const rawDescription = product.selectedVariant?.description ?? rows[route.kind].find(r => r.id === route.id)?.description ?? '';
    const description = rawDescription.trim() === '-' ? '' : rawDescription;
    if (!description) report.missingSourceDescriptions.push(route.path);
    // Decor layouts contain product-specific properties/material blocks absent from decor.csv.
    // Retain the captured source markup; editable fields still come from the accepted feed.
    let template = templates[route.kind];
    if (route.kind === 'decor' && !route.auto) template = withProductLayout(template, await readFile(join(root, 'components/decor', `${route.path.split('/').at(-1)}.html`), 'utf8'));
    const displayDescription = route.kind === 'decor' && rawDescription !== '-'
      ? description || route.liveDescription || '' : description;
    if (route.kind === 'decor') product.staticDescription = rawDescription === '-' ? '' : route.liveDescription || '';
    let html = renderProductPage(template, product, route, displayDescription);
    const oldTitle = route.kind === 'decor' ? 'Корзина под ёлку' : 'Миранда';
    html = html.replace(`<span class='text-block-wrap-div'>${oldTitle}</span>`, () => `<span class='text-block-wrap-div'>${escape(product.title)}</span>`);
    if (route.kind === 'tree') {
      const catalogPath = /^\/tree\/(?:tuya-|mozhzhevelnik$|kiparisovik$)/.test(route.path) ? '/catalog/landscape-gardening' : '/catalog';
      html = html.replace("href='javascript:history.back()'", `href='${catalogPath}'`);
    }
    html = metadata(html, route, product, description);
    const destination = join(target, route.path.slice(1), 'index.html');
    await mkdir(join(target, route.path.slice(1)), { recursive: true });
    await writeFile(destination, html);
    report.generated++;
    report.details.push({ path: route.path, id: route.id, kind: route.kind, title: product.title, description, ...(route.auto ? { autoRoute: true } : {}),
      image: product.selectedVariant?.image || '', price: product.selectedVariant?.price || 0,
      available: Boolean(product.selectedVariant), variantCount: product.variants.length });
    if (!product.selectedVariant) report.unavailable.push({ path: route.path, id: route.id, reason: 'all snapshot variants inactive' });
  } catch (error) { report.errors.push({ path: route.path, id: route.id, error: error.message }); }
}
const reportRoot = process.env.LE_BUILD_ISOLATED_REPORT === '1' ? target : root;
await mkdir(join(reportRoot, 'audit'), { recursive: true });
await writeFile(join(reportRoot, 'audit', 'build-report.json'), JSON.stringify(report, null, 2) + '\n');
console.log(`Generated ${report.generated}/${report.routes} product URLs from offline snapshot`);
if (report.errors.length) { console.error(report.errors); process.exitCode = 1; }
