import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { applySEO, filterSitemap } from '../seo.mjs';
import { setPreviewImages, imagePreviewAttributes } from '../products/image-preview.mjs';
import { pinPhotos } from '../products/presentation.mjs';
const counter = await readFile(new URL('../client/metrika.js', import.meta.url), 'utf8');
function runCounter(mode, hostname, protocol = 'https:') {
  const requests = [], calls = [];
  const window = { __LE_STOREFRONT_CONFIG__: { mode }, ym: (...args) => calls.push(args) };
  vm.runInNewContext(counter, { window, location: { hostname, protocol, href: `https://${hostname}/catalog` }, document: { referrer: 'https://example.com/', createElement: () => ({}), head: { append: s => requests.push(s.src) } } });
  return { requests, calls, window };
}
test('Metrika: production domain only, new counter options and ecommerce contract', () => {
  for (const args of [['preview','lady-elka.ru'],['production','localhost'],['production','127.0.0.1'],['production','preview.twc1.net'],['production','lady-elka.ru','http:']]) {
    const result = runCounter(...args); assert.equal(result.requests.length,0); assert.equal(result.calls.length,0);
  }
  const r=runCounter('production','lady-elka.ru');
  assert.deepEqual(r.requests,['https://mc.yandex.ru/metrika/tag.js?id=113669509']);
  const [id,action,options]=r.calls[0];assert.equal(id,113669509);assert.equal(action,'init');
  for(const key of ['webvisor','clickmap','trackLinks','accurateTrackBounce','ssr'])assert.equal(options[key],true);
  assert.equal(options.referrer,'https://example.com/');assert.equal(options.url,'https://lady-elka.ru/catalog');
  assert.equal(options.ecommerce,'dataLayer');assert.ok(Array.isArray(r.window.dataLayer));
});
test('SEO: source text, escaped fields, product truth, duplicate and service routes', () => {
  const page='<head><title>Моя коллекция indexed</title><meta name="description" content=""><link rel="canonical" href="https://lady-elka.ru/blog"></head><body><h1>Блог</h1><p>Как выбрать ёлку для дома &amp; офиса.</p></body>';
  const blog=applySEO(page,'/blog');assert.match(blog,/<title>Блог — Lady Elka<\/title>/);assert.match(blog,/Как выбрать ёлку для дома &amp; офиса/);assert.match(blog,/og:image/);
  assert.match(applySEO(page.replace('https://lady-elka.ru/blog', 'https://lady-elka.ru/blog/published.html'), '/blog/published'), /canonical" href="https:\/\/lady-elka.ru\/blog\/published.html"/);
  assert.match(applySEO(page,'/catalog-tree-1'),/canonical" href="https:\/\/lady-elka.ru\/catalog-tree\/"/);
  assert.match(applySEO(page,'/tree/tuya-shar-goluboj'), /canonical" href="https:\/\/lady-elka.ru\/tree\/tuya-shar-goluboi\/"/);
  assert.match(applySEO(page.replace('<head>', '<head><meta name="robots" content="none">'), '/search/p/1'), /noindex, follow/);
  for(const route of ['/testy','/spasibo','/pay-return','/person'])assert.match(applySEO(page,route),/noindex, follow/);
  const xml='<urlset>'+['/catalog','/testy','/spasibo','/catalog-tree-1','/person','/tree/tuya-shar-goluboj'].map(p=>`<url><loc>https://lady-elka.ru${p}</loc></url>`).join('')+'</urlset>';
  assert.equal(filterSitemap(xml),'<urlset><url><loc>https://lady-elka.ru/catalog/</loc></url></urlset>');
  const product={title:'Туя',variants:[{category:'Голубая',height:90,price:4200,description:''}]};
  const result=applySEO(page+`<script type="application/json" data-storefront-page-product>${JSON.stringify(product)}</script>`,'/tree/tuya');
  assert.match(result,/Туя. Голубая. 90 см. 4/);
});
test('same feed file keeps pinned original; preview stays separate from lightbox', () => {
  const raw='https://mgnotvaahftrbifqtahf.supabase.co/storage/v1/object/public/le-catalog-images/image.webp';
  const pinned='/media/catalog-pinned/'+'a'.repeat(64)+'.webp';
  assert.equal(pinPhotos(raw,url=>url===raw?pinned:undefined,false),pinned);
  setPreviewImages({[pinned]:{240:{url:'/small.webp',width:180,height:240},480:{url:'/large.webp',width:360,height:480}}});
  const preview=imagePreviewAttributes(pinned,true);assert.equal(preview.src,'/large.webp');assert.equal(preview['data-full-src'],pinned);assert.match(preview.srcset,/180w/);
  assert.deepEqual(imagePreviewAttributes('/new.webp'),{src:'/new.webp'});setPreviewImages(null);
});
