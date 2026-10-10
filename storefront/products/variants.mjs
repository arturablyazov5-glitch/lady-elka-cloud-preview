// Shared by the build and browser: a variant is the only source of price and properties.
export function variantDimensions(product) {
  const keys = product.kind === 'decor' ? ['category', 'size'] : ['category', 'height'];
  return keys.filter(key => new Set(product.variants.map(variant => variant.options[key])).size > 1);
}

export function availableOptions(product, key, selected = {}) {
  const dimensions = variantDimensions(product);
  const preceding = dimensions.slice(0, dimensions.indexOf(key));
  return [...new Set(product.variants
    .filter(variant => preceding.every(name => !selected[name] || variant.options[name] === selected[name]))
    .map(variant => variant.options[key]))];
}

export function resolveVariant(product, selected = {}) {
  return product.variants.find(variant => Object.entries(selected)
    .every(([key, value]) => !value || variant.options[key] === value)) || null;
}

export function initialSelection(product) {
  const first = product.variants[0];
  return first ? Object.fromEntries(variantDimensions(product).map(key => [key, first.options[key]])) : {};
}
