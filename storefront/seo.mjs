import { pagePath } from './url-path.mjs';
import { escapeHtml as esc } from './products/presentation.mjs';
import { readFileSync } from 'node:fs';
const origin = 'https://lady-elka.ru';
// SEO and HTTP redirects share the same alias targets.
const aliases = { ...JSON.parse(readFileSync(new URL('./config/redirects.json', import.meta.url), 'utf8')), '/catalog-tree-1': '/catalog-tree' };
export const canonicalPath = route => { const key = route.replace(/\/+$/, '') || '/'; return pagePath(aliases[key] || route); };
export const noindexRoute = route => ['/testy', '/spasibo', '/pay-return', '/404', '/person'].includes(route.replace(/\/+$/, '') || '/');
const text = value => String(value || '').replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\s+/g, ' ').trim();
const attr = (tag, name) => new RegExp(`\\b${name}=["']([^"']*)["']`, 'i').exec(tag)?.[1] || '';
function meta(html, key) {
  const tag = [...html.matchAll(/<meta\b[^>]*>/gi)].find(m => attr(m[0], 'name') === key || attr(m[0], 'property') === key);
  return tag ? attr(tag[0], 'content') : '';
}
function contentFragments(body) {
  const fragments = [];
  const openings = /<(h1|h2|p)\b[^>]*>|<span\b[^>]*class=['"]text-block-wrap-div['"][^>]*>/gi;
  for (const opening of body.matchAll(openings)) {
    const tagName = opening[1] || 'span';
    const tags = new RegExp(`<\\/?${tagName}\\b[^>]*>`, 'gi');
    tags.lastIndex = opening.index + opening[0].length;
    let depth = 1;
    for (let tag; (tag = tags.exec(body));) {
      depth += tag[0].startsWith('</') ? -1 : 1;
      if (!depth) {
        const value = text(body.slice(opening.index + opening[0].length, tag.index));
        if (value.length > 18 && !/Я согласен|Это поле|Форма отправлена|Что-то не так|Если каталог ничего|Сбросить фильтр/.test(value)) fragments.push(value);
        break;
      }
    }
  }
  return [...new Set(fragments)];
}
export function applySEO(html, route) {
  html = html.replaceAll('Разнообранзный', 'Разнообразный');
  const noindex = noindexRoute(route) || /\b(?:noindex|none)\b/i.test(meta(html, 'robots'));
  let title = text(/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1]);
  if (route === '/blog') title = 'Блог — Lady Elka';
  const productData = /<script\b[^>]*data-storefront-page-product[^>]*>([\s\S]*?)<\/script>/i.exec(html)?.[1];
  const product = productData ? JSON.parse(productData) : null;
  let description = text(meta(html, 'description'));
  if (route === '/blog' && /Моя коллекция indexed/i.test(description)) description = '';
  if (product) {
    const v = product.selectedVariant || product.variants[0];
    description = text(v?.description) || [product.title, v?.category, v?.height ? `${v.height} см` : v?.label,
      v?.diameter ? `Диаметр ${v.diameter} см` : '', Number(v?.branches) > 0 ? `${v.branches} веток` : '', v?.price ? `${v.price.toLocaleString('ru-RU')} ₽` : ''].filter(Boolean).join('. ');
  }
  if (!description) {
    const body = html.slice(html.search(/<h1\b/i)).replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '');
    const fragments = contentFragments(body);
    description = fragments.slice(0, 3).join('. ') || title;
  }
  description = description.length > 300 ? description.slice(0, 300).replace(/\s+\S*$/, '') : description;
  const productImage = product?.selectedVariant?.image || product?.variants[0]?.image;
  const capturedImage = meta(html, 'og:image');
  const image = productImage || (capturedImage && !capturedImage.endsWith('/d/frame_62025.png') ? capturedImage : '/media/seo/share.webp');
  const imageURL = image.startsWith('/') ? origin + image : image;
  const existingCanonical = [...html.matchAll(/<link\b[^>]*>/gi)].find(m => attr(m[0], 'rel') === 'canonical');
  const existingURL = existingCanonical ? attr(existingCanonical[0], 'href') : '';
  // Published blog URL contract is /blog/<slug>.html, including its clean alias.
  const canonical = route.startsWith('/blog/') && existingURL === origin + route + '.html' ? existingURL : origin + canonicalPath(route);
  html = html.replace(/<title[^>]*>[\s\S]*?<\/title>/i, `<title>${esc(title)}</title>`)
    .replace(/<meta\b[^>]*(?:name|property)=['"](?:description|robots|og:(?:title|description|image(?::(?:width|height|type))?|url)|twitter:(?:title|description|image))['"][^>]*>\s*/gi, '')
    .replace(/<link\b[^>]*rel=['"]canonical['"][^>]*>\s*/gi, '');
  const fields = [['name','description',description],['name','robots',noindex ? 'noindex, follow' : 'index, follow'],
    ['property','og:title',title],['property','og:description',description],['property','og:image',imageURL],['property','og:url',canonical],
    ['name','twitter:title',title],['name','twitter:description',description],['name','twitter:image',imageURL]];
  return html.replace(/<\/head>/i, fields.map(([attribute,key,value])=>`<meta ${attribute}="${key}" content="${esc(value)}">`).join('\n') + `\n<link rel="canonical" href="${canonical}">\n</head>`);
}
export function filterSitemap(xml) {
  return xml.replace(/<url\b[^>]*>[\s\S]*?<\/url>/g, block => {
    const loc = /<loc>([^<]+)<\/loc>/.exec(block)?.[1];
    if (!loc) throw new Error('Sitemap URL missing loc');
    const route = new URL(loc).pathname;
    return noindexRoute(route) || canonicalPath(route) !== pagePath(route) ? '' : block.replace(loc, 'https://lady-elka.ru' + canonicalPath(route));
  });
}
