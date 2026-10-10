const base = 'https://mgnotvaahftrbifqtahf.supabase.co';
export function runtimeConfig(mode) {
  if (!['preview', 'production', 'fixture'].includes(mode)) throw new Error('Explicit storefront mode required');
  const catalog = Object.fromEntries(['trees', 'decor', 'promos'].map(name => [name,
    mode === 'fixture' ? `/__test/feeds/${name}.csv` : `${base}/storage/v1/object/public/le-catalog-feeds/${name}.csv`]));
  return { lead: mode === 'production' ? `${base}/functions/v1/lead` : mode === 'fixture' ? '/functions/v1/lead' : null, mode: mode === 'fixture' ? 'preview' : mode, catalog, payment: mode === 'production' ? `${base}/functions/v1/pay` : mode === 'fixture' ? '/functions/v1/pay' : null };
}
export const configScript = mode => `window.__LE_STOREFRONT_CONFIG__=${JSON.stringify(runtimeConfig(mode))};\n`;
