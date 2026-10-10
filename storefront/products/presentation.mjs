import { initialSelection, resolveVariant } from './variants.mjs';

// https URLs from the live feed, or local copies pinned by a candidate preview build (/media/catalog-pinned/<sha256>.<ext>).
export const catalogPhotos = photos => [...new Set((photos || []).filter(value => /^(https:\/\/|\/media\/catalog-pinned\/[a-f0-9]{64}\.(webp|jpg|png)$)/i.test(String(value || '').trim())).map(value => String(value).trim()))]
  .filter(url => !/placeholder/i.test(url));

// Maps a feed photo reference to the path of its saved local copy under storefront/public
// (used by catalog-import inventory). Unknown hosts (e.g. Supabase Storage) are returned unchanged.
export function localAsset(value) {
  const raw = String(value ?? '').trim();
  if (raw.startsWith('/') && !raw.startsWith('//')) return raw;
  let url;
  try { url = new URL(raw); } catch { return raw; }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return raw;
  const host = url.hostname.replace(/^www\./, '').toLowerCase();
  if (host === 'lady-elka.ru') return url.pathname;
  if (host === 'sale-elka.ru') return `/media/sale-elka${url.pathname}`;
  return raw;
}

// Replace raw feed photo URLs by pinned local copies without changing the editor-defined order.
// lookup(url) -> pinned path or undefined. strict: unknown URL throws (build); otherwise kept as-is (runtime, until next sync).
export function pinPhotos(raw, lookup, strict = true) {
  return catalogPhotos(String(raw ?? '').split('|')).map(url => {
    const pinned = lookup(url);
    if (!pinned && strict) throw new Error(`Missing preview media mapping: ${url}`);
    return pinned || url;
  }).join('|');
}

// The cabinet (Supabase feed) title is authoritative; the captured live-site title is only a fallback.
export const productTitle = (product, route) => String(product?.title || '').trim() || route?.liveTitle || '';

export function presentProduct(product, route) {
  const kind = route.kind;
  const variants = product.variants.map(variant => {
    const photos = catalogPhotos(variant.photos);
    const image = photos[0] || '';
    return {
      ...variant,
      options: kind === 'tree' ? { category: variant.category, height: String(variant.height) }
        : { category: variant.category, size: variant.size },
      image,
      photos,
    };
  });
  const view = { id: product.id, kind, title: productTitle(product, route), path: route.path, variants };
  view.selectedVariant = resolveVariant(view, initialSelection(view));
  return view;
}

export const escapeHtml = value => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
export const money = value => `${Number(value || 0).toLocaleString('ru-RU')} ₽`;
export const jsonForHtml = value => JSON.stringify(value).replaceAll('<', '\\u003c');
