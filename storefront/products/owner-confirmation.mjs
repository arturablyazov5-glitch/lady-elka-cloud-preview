const scopes = ['prices', 'active', 'descriptions', 'media', 'promos'];
const invalid = () => {throw new Error('Invalid local owner confirmation metadata');};
const nonempty = value => typeof value === 'string' && value.trim().length > 0;
export function ownerBuildStatus(manifest, provenance) {
  const present = Object.hasOwn(manifest, 'ownerConfirmation') || manifest.ownerAccepted === true ||
    manifest.freshness === 'current-fetch-owner-confirmed';
  if (!present) {
    if (manifest.ownerAccepted !== undefined && manifest.ownerAccepted !== false) invalid();
    return {ownerAccepted: false, notice: 'Каталог не подтверждён владельцем; актуальность цен не проверена. Готовность оплаты и публикации не подтверждена.'};
  }
  const c = manifest.ownerConfirmation;
  if (manifest.ownerAccepted !== true || manifest.productionReady !== false || manifest.dataAsOf !== null ||
      manifest.freshness !== 'current-fetch-owner-confirmed' || manifest.source?.kind !== 'public-read-only-catalog-export' ||
      !c || c.accepted !== true || !nonempty(c.source) || !nonempty(c.quote) ||
      !/^\d{4}-\d{2}-\d{2}$/.test(c.date || '') || !Number.isFinite(Date.parse(c.date)) ||
      new Date(c.date).toISOString().slice(0, 10) !== c.date ||
      c.authoritativeSource !== 'Current public Supabase catalog exports' || c.effectiveHistoricalDate !== null ||
      !Array.isArray(c.scope) || c.scope.length !== scopes.length || !scopes.every(s => c.scope.includes(s)) ||
      JSON.stringify(provenance?.confirmation) !== JSON.stringify(c)) invalid();
  for (const name of ['trees', 'decor', 'promos']) {
    const feed = manifest.feeds?.[name], saved = provenance.feeds?.[name];
    if (!feed || !saved || !([`https://mgnotvaahftrbifqtahf.supabase.co/storage/v1/object/public/le-catalog-feeds/${name}.csv`, `https://mgnotvaahftrbifqtahf.supabase.co/functions/v1/catalog/feeds/${name}.csv`].includes(feed.source)) ||
        !Number.isFinite(Date.parse(feed.receivedAt)) || feed.receivedAt.slice(0, 10) !== c.date ||
        !['source', 'receivedAt', 'sha256'].every(k => saved[k] === feed[k])) invalid();
  }
  return {ownerAccepted: true, ownerConfirmation: c,
    notice: `Каталог принят владельцем ${c.date}: текущие публичные данные Supabase подтверждены. Историческая дата действия не установлена. Готовность оплаты и публикации не подтверждена.`};
}
