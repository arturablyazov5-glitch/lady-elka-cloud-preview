// Explicit identifiers: never derive public URLs from a display label.
const treeTypeIdentifiers = [
  ['green', 'Зелёная'],
  ['snow', 'Заснеженная'],
  ['lit', 'С освещением'],
  ['snow-lit', 'Заснеженная с освещением'],
  ['thuja', 'Туя'],
];
const normalizeTreeType = value => String(value).normalize('NFC').trim().toLocaleLowerCase('ru-RU');
export function typeSlug(category) {
  return treeTypeIdentifiers.find(([, name]) => normalizeTreeType(name) === normalizeTreeType(category))?.[0] || null;
}
export function categoryFromType(product, value) {
  if (!value || product.kind !== 'tree') return null;
  const normalizeTreeTyped = normalizeTreeType(value);
  const entry = treeTypeIdentifiers.find(([slug, name]) => normalizeTreeTyped === slug || normalizeTreeTyped === normalizeTreeType(name));
  if (!entry) return null;
  const matches = [...new Set(product.variants.map(v => v.options.category))]
    .filter(category => normalizeTreeType(category) === normalizeTreeType(entry[1]));
  return matches.length === 1 ? matches[0] : null;
}
