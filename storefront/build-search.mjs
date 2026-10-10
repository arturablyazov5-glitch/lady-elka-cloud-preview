import { pagePath } from './url-path.mjs';
import { cardHtml, decorCardHtml } from './products/card-renderer.mjs';
import { loadFeed } from './products/build-feed.mjs';
import { treeProducts, decorProducts } from './products/model.mjs';
import { buildRoutes } from './products/routes.mjs';
import { canonicalPath, noindexRoute } from './seo.mjs';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export function legacyArticleBody(html) {
  // Captured articles own a rich-text block; nav/footer never enter this scope.
  const start = /<div\b[^>]*class=['"][^'"]*\btt-rich-text\b[^'"]*['"][^>]*>/i.exec(html);
  if (!start) throw new Error('Legacy article body block missing');
  const tags = /<\/?div\b[^>]*>/gi;
  tags.lastIndex = start.index + start[0].length;
  let depth = 1;
  for (let tag; (tag = tags.exec(html));) {
    depth += tag[0].startsWith('</') ? -1 : 1;
    if (!depth) return html.slice(start.index + start[0].length, tag.index).replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, '');
  }
  throw new Error('Legacy article body block unclosed');
}

export async function buildSearch(blogRecords = []) {
  const root = import.meta.dirname;
  const dist = process.env.LE_BUILD_TARGET || join(root, 'dist');
  const sitemap = await readFile(join(dist, 'sitemap.xml'), 'utf8');
  const paths = [...sitemap.matchAll(/<loc>https?:\/\/lady-elka\.ru([^<]*)<\/loc>/g)]
    .map(match => match[1] || '/')
    // Same rule as the published sitemap (seo.mjs filterSitemap): no noindex pages (/spasibo, /testy…) and no alias duplicates.
    .filter(path => !noindexRoute(path) && canonicalPath(path) === pagePath(path)).map(pagePath);
  const decode = text => String(text || '')
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ');
  const plain = html => decode(String(html || '').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
  const routes = await buildRoutes();
  const trees = treeProducts(await loadFeed('trees')), decor = decorProducts(await loadFeed('decor'));
  const index = [];
  for (const path of paths) {
    const file = path.endsWith('.html') ? join(dist, path.slice(1)) : join(dist, path.replace(/^\//, ''), 'index.html');
    const html = await readFile(file, 'utf8');
    const heading = plain(html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)?.[1]);
    const title = heading || plain(html.match(/<title>([\s\S]*?)<\/title>/i)?.[1]);
    const description = decode(html.match(/<meta name="description" content="([^"]*)"/i)?.[1]);
    const blog = blogRecords.find(record => record.path === path);
    const legacyBody = !blog && (path.startsWith('/blog/') && path !== '/blog/') ? plain(legacyArticleBody(html)) : '';
    const route = routes.find(route => pagePath(route.path) === path);
    const product = route ? (route.kind === 'tree' ? trees : decor).get(route.id) : null;
    const productCard = product?.variants.length ? (route.kind === 'tree' ? cardHtml : decorCardHtml)('<div class="product-card search-product-card">', product, route) : null;
    index.push({ path, title, kind: product ? 'product' : blog || (path.startsWith('/blog/') && path !== '/blog/') ? 'article' : 'page',
      description: blog ? `${blog.description}\n${blog.text}` : legacyBody ? `${description}\n${legacyBody}`.trim() : product ? `${description} ${product.variants.map(v => v.description || '').join(' ')}` : description,
      ...(product ? { cardHtml: productCard, available: Boolean(productCard) } : {}) });
  }
  await writeFile(join(dist, 'search-index.json'), JSON.stringify(index));

  const searchFile = join(dist, 'search', 'index.html');
  let html = await readFile(searchFile, 'utf8');
  html = html.replace(/<div class='embed embed--u-ibx6tdg2t'[^>]*>\s*<script>[\s\S]*?<\/script>\s*<\/div>/, '');
  function clearDiv(id) {
    const start = html.indexOf(`<div id="${id}"`);
    if (start < 0) throw new Error(`Search template is missing ${id}`);
    const openingEnd = html.indexOf('>', start) + 1;
    const tag = /<\/?div\b[^>]*>/g;
    tag.lastIndex = openingEnd;
    let depth = 1;
    let match;
    while ((match = tag.exec(html))) {
      depth += match[0].startsWith('</') ? -1 : 1;
      if (!depth) {
        html = html.slice(0, openingEnd) + html.slice(match.index);
        return;
      }
    }
    throw new Error(`Search template has no closing div for ${id}`);
  }
  clearDiv('ibq72ss3m_0');
  clearDiv('ilmytsgea_0');
  html = html.replace("href='javascript:history.back()'", "href='/'");
  html = html.replace('<title></title>', '<title>Результаты поиска — Lady Elka</title>');
  html = html.replace(/<\/head>/i, '<link rel="stylesheet" href="/search-cards.css"></head>');
  html = html.replace(/<\/body>/i, '<script src="/search.js" defer></script></body>');
  await writeFile(searchFile, html);
  for (let page = 1; page < Math.ceil(index.length / 10); page++) {
    const directory = join(dist, 'search', 'p', String(page));
    await mkdir(directory, { recursive: true });
    await writeFile(join(directory, 'index.html'), html);
  }
  console.log(`Search index built: ${index.length} pages`);

}
if (process.argv[1] === fileURLToPath(import.meta.url)) await buildSearch();
