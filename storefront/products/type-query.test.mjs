import {test} from 'node:test';
import assert from 'node:assert/strict';
import {categoryFromType,typeSlug} from './type-query.mjs';
const product={kind:'tree',variants:['Зелёная','Заснеженная','С освещением','Заснеженная с освещением','Туя'].map(category=>({options:{category}}))};
test('explicit type identifiers round trip through URL and Unicode labels',()=>{
  for(const variant of product.variants){const category=variant.options.category,slug=typeSlug(category);assert.ok(slug);assert.equal(categoryFromType(product,new URL('https://example.test/?type='+slug).searchParams.get('type')),category);assert.equal(categoryFromType(product,new URL('https://example.test/?type='+encodeURIComponent(category.normalize('NFD'))).searchParams.get('type')),category);}
});
test('unknown, unavailable, ambiguous and decor categories cannot select an invalid variant',()=>{
  for(const value of [null,'','white','snowjunk','snow&lit','%E0%A4%A'])assert.equal(categoryFromType(product,value),null);
  assert.equal(categoryFromType({kind:'tree',variants:[product.variants[0]]},'snow'),null);
  assert.equal(categoryFromType({kind:'decor',variants:product.variants},'green'),null);
  assert.equal(categoryFromType({kind:'tree',variants:[{options:{category:'Зелёная'}},{options:{category:' зелёная '}}]},'green'),null);
  assert.equal(typeSlug('New display label'),null);
});
