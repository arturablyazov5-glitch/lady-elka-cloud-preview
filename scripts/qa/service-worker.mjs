#!/usr/bin/env node
// All APIs are local mocks. No real order, payment, lead or external traffic.
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { gzipSync } from 'node:zlib';
const { chromium } = createRequire(process.env.PLAYWRIGHT_PACKAGE_JSON || import.meta.url)('playwright');
const root = resolve('storefront/production/dist');
const original = await readFile(resolve(root,'sw.js'),'utf8');
const emergency = await readFile(resolve(root,'sw-kill.js'),'utf8');
const release = JSON.parse(await readFile(resolve(root,'immutable-manifest.json'),'utf8')).release;
const asset = text => '/assets/'+createHash('sha256').update(text).digest('hex')+'.css';
const first = 'body{--qa-version:1}', second = 'body{--qa-version:2}';
const config = JSON.parse(original.split('\n')[0].slice('const LE_SW_CONFIG = '.length, -1));
const render = (release, fixtures) => 'const LE_SW_CONFIG = ' + JSON.stringify({ ...config, release, assets: { ...config.assets, ...fixtures } }) + ';\n' + original.split('\n').slice(1).join('\n');
let worker = render(release, { [asset(first)]: Buffer.byteLength(first) }), generation=1, status=200;
const requests=[], posts=[];
const mime={'.html':'text/html','.css':'text/css','.js':'text/javascript','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp','.svg':'image/svg+xml','.woff2':'font/woff2','.json':'application/json','.csv':'text/csv'};
const server=createServer(async(req,res)=>{
  requests.push({url:req.url,method:req.method,generation});
  res.setHeader('Cache-Control','no-cache');
  res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; media-src 'self' blob:; connect-src 'self'; worker-src 'self'");
  if(req.url==='/sw.js'){res.setHeader('Content-Type','text/javascript');return res.end(worker);}
  if(req.url===asset(first)||req.url===asset(second)){res.setHeader('Content-Type','text/css');res.setHeader('Content-Encoding','gzip');return res.end(gzipSync(req.url===asset(first)?first:second));}
  if(req.url.startsWith('/__qa/')){
    if(req.method==='POST'){
      let body='';for await(const part of req)body+=part;posts.push({url:req.url,body:JSON.parse(body),status});
      res.writeHead(status,{'Content-Type':'application/json',...(status===429?{'Retry-After':'1'}:{})});
      return res.end(JSON.stringify(status===200?{ok:true,orderId:'SW-LOCAL-MOCK',id:'SW-LOCAL-MOCK'}:{ok:false}));
    }
    res.setHeader('Content-Type','application/json');return res.end(JSON.stringify({generation}));
  }
  try{
    const pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
    let file=resolve(root,'.'+pathname);
    if(!file.startsWith(root+sep))throw Error('not found');
    if(!extname(file))file=resolve(file,'index.html');
    let bytes=await readFile(file);
    res.setHeader('Content-Type',mime[extname(file)]||'application/octet-stream');
    if(extname(file)==='.html')bytes=Buffer.from(bytes.toString().replace('</head>',`<meta name="qa-generation" content="${generation}"></head>`));
    res.end(bytes);
  }catch{res.writeHead(404,{'Content-Type':'text/html'});res.end(await readFile(resolve(root,'404.html')));}
});
await new Promise(ok=>server.listen(0,'127.0.0.1',ok));
const base='http://127.0.0.1:'+server.address().port;
const browser=await chromium.launch({executablePath:process.env.CHROME_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
const evidence={release,realOrders:0,externalRequests:[],checks:[]};
async function waitState(page, predicate, arg) {
  const deadline=Date.now()+15000;
  while(Date.now()<deadline){if(await page.evaluate(predicate,arg))return;await page.waitForTimeout(100);}
  throw new Error('SW state did not settle within 15 seconds');
}
const check=name=>{evidence.checks.push(name);console.log('PASS '+name);};
try{
  const context=await browser.newContext({viewport:{width:390,height:900},reducedMotion:'reduce'});
  await context.addInitScript(()=>{window.__LE_SW_TEST__=true;window.__qaNativeFetch=window.fetch.bind(window);});
  context.on('request',request=>{if(new URL(request.url()).origin!==base)evidence.externalRequests.push(request.url());});
  let page=await context.newPage();
  await page.goto(base+'/tree/miranda',{waitUntil:'networkidle'});
  await page.waitForFunction(()=>!!navigator.serviceWorker.controller);
  await page.evaluate(()=>window.__qaNativeFetch('/assets/'+'')); // unknown URL retains 404; not cached
  await page.evaluate(async url=>{await window.__qaNativeFetch(url);await window.__qaNativeFetch(url);},asset(first));
  assert.equal(requests.filter(r=>r.url===asset(first)).length,1);
  assert.equal(await page.evaluate(async url=>(await window.__qaNativeFetch(url)).text(),asset(first)), first);
  assert.ok((await page.evaluate(()=>caches.keys())).includes('le-static-v1'));check('initial install, claim, gzip immutable miss -> decoded cache hit');
  const oldRequests=requests.length;
  await page.goto(base+'/tree/miranda',{waitUntil:'networkidle'});
  assert.ok(requests.slice(oldRequests).every(r=>['/tree/miranda','/sw.js'].includes(r.url)));
  assert.equal(requests.slice(oldRequests).filter(r=>r.url==='/tree/miranda').length,1);check('second document: only fresh HTML reaches host');
  const notFound=await page.goto(base+'/__qa-missing',{waitUntil:'networkidle'});assert.equal(notFound.status(),404);check('404 status preserved');
  await page.goto(base+'/tree/miranda',{waitUntil:'networkidle'});
  const fresh=await page.evaluate(async()=>[await(await window.__qaNativeFetch('/__qa/feed')).json(),await(await window.__qaNativeFetch('/__qa/feed')).json()]);
  assert.equal(fresh.length,2);assert.equal(requests.filter(r=>r.url==='/__qa/feed').length,2);check('mutable feed is requested twice');
  await page.locator('[data-storefront-product] .buy-btn').first().click();
  await page.locator('[data-cart-up]').click();
  await page.evaluate(()=>{window.fetch=window.__qaNativeFetch;window.__LE_STOREFRONT_CONFIG__.payment='/__qa/pay';window.__LE_STOREFRONT_CONFIG__.lead='/__qa/lead';});
  for(const[key,value]of Object.entries({name:'Локальная проверка',email:'qa@example.org',phone:'+7 (999) 123-45-67',address:'Москва'}))await page.locator(`[data-checkout-field="${key}"]`).fill(value);
  await page.locator('[data-checkout-field="paymentMethod"]').selectOption('cash_on_delivery');
  await page.locator('[data-checkout-field="contactPref"]').selectOption({index:1});
  await page.locator('[data-checkout-field="consent"]').evaluate(n=>{n.checked=true;n.dispatchEvent(new Event('change',{bubbles:true}));});
  status=503;await page.locator('[data-pay-now]').click();
  await page.waitForFunction(()=>document.querySelector('[data-checkout-notice]')?.textContent.includes('Сервис временно недоступен'));
  assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('lady_elka_cart_v2'))[0].quantity),2);check('checkout 503 preserves cart and human message');
  status=429;await page.locator('[data-pay-now]').click();await page.waitForFunction(()=>document.querySelector('[data-checkout-notice]')?.textContent.includes('Слишком много попыток'));await page.waitForTimeout(1200);check('checkout 429 and retry hold');
  status=200;await page.locator('[data-pay-now]').click();await page.waitForFunction(()=>document.querySelector('[data-checkout-notice]')?.textContent.includes('оформлен'));
  assert.deepEqual(await page.evaluate(()=>JSON.parse(localStorage.getItem('lady_elka_cart_v2'))),[]);assert.equal(posts.at(-1).body.items[0].quantity,2);check('active worker checkout success: real local POST, quantity 2, cart cleared');
  await page.keyboard.press('Escape');
  const form=page.locator('form[data-lead-type]').first();
  await form.evaluate(f=>{for(const n of f.querySelectorAll('[data-lead-field]')){if(n.type==='checkbox')n.checked=true;else n.value=n.dataset.leadField==='phone'?'+7 (999) 123-45-67':n.dataset.leadField==='email'?'qa@example.org':'Локальная проверка';n.dispatchEvent(new Event('input',{bubbles:true}));}});
  for(const failure of [503,429]){
    status=failure;await form.evaluate(f=>f.requestSubmit());await page.waitForFunction(text=>document.querySelector('form[data-lead-type] [data-form-submit-notice]')?.textContent.includes(text),failure===503?'Сервис временно недоступен':'Слишком много попыток');await page.waitForTimeout(1200);
  }
  status=200;await form.evaluate(f=>f.requestSubmit());await page.waitForFunction(()=>document.querySelector('form[data-lead-type] [data-form-submit-notice]')?.textContent.includes('Заявка принята'));check('active worker lead 503/429/success use local POST, no cached reply');
  const keys=await page.evaluate(async()=>{const out=[];for(const name of await caches.keys())for(const key of await(await caches.open(name)).keys())out.push(key.url);return out;});
  assert.ok(keys.every(url=>/\/[a-f0-9]{64}\.(css|js|woff2?|webp|png|jpe?g|svg|ico|gif|avif)$/.test(url)));check('cache holds only content-hash static URLs');
  // Byte-different worker at stable /sw.js: model a newly generated build.
  generation=2;worker=render(release+'-qa-v2', { [asset(first)]: Buffer.byteLength(first) });
  const beforeUpdate=requests.length;
  await page.evaluate(async()=>{await(await navigator.serviceWorker.getRegistration('/')).update();});
  await waitState(page,async()=>!!(await navigator.serviceWorker.getRegistration('/'))?.waiting);
  const oldName='le-static-v1';
  assert.ok((await page.evaluate(()=>caches.keys())).includes(oldName));
  await page.evaluate(async url=>{await window.__qaNativeFetch(url);await window.__qaNativeFetch(url);},asset(first));
  assert.equal(requests.slice(beforeUpdate).filter(r=>r.url===asset(first)).length,0);check('new release waits; open tab uses old cache without reload');
  await page.goto(base+'/tree/miranda',{waitUntil:'networkidle'});
  assert.equal(await page.locator('meta[name="qa-generation"]').getAttribute('content'),'2');
  await page.goto('about:blank');await page.waitForTimeout(500);
  const afterActivation=requests.length;
  await page.goto(base+'/tree/miranda',{waitUntil:'networkidle'});
  await waitState(page,async() => !(await navigator.serviceWorker.getRegistration('/'))?.waiting);
  await page.evaluate(async url=>{await window.__qaNativeFetch(url);},asset(first));
  assert.ok(requests.slice(afterActivation).every(r=>['/tree/miranda','/sw.js'].includes(r.url)));
  check('same assets after HTML-only rebuild: zero repeated asset downloads');
  generation=3; worker=render(release+'-qa-v3', { [asset(second)]: Buffer.byteLength(second) });
  await page.evaluate(async()=>{await(await navigator.serviceWorker.getRegistration('/')).update();});
  await waitState(page,async()=>!!(await navigator.serviceWorker.getRegistration('/'))?.waiting);
  // A new hash works under the old controller while the update is waiting.
  const newHashStart=requests.length;
  await page.evaluate(async url=>{await window.__qaNativeFetch(url);},asset(second));
  await waitState(page,async url=>!!await(await caches.open('le-static-v1')).match(url),base+asset(second));
  await page.goto('about:blank');await page.waitForTimeout(500);
  await page.goto(base+'/tree/miranda',{waitUntil:'networkidle'});
  await waitState(page,async url=>!(await navigator.serviceWorker.getRegistration('/'))?.waiting && !await(await caches.open('le-static-v1')).match(url),base+asset(first));
  await page.evaluate(async url=>{await window.__qaNativeFetch(url);},asset(second));
  assert.equal(requests.slice(newHashStart).filter(r=>r.url===asset(second)).length,1);
  assert.ok(requests.slice(newHashStart).every(r=>['/tree/miranda','/sw.js',asset(second)].includes(r.url)));
  check('changed hash: only new asset downloaded once, obsolete hash pruned, shared assets retained');
  await page.evaluate(()=>caches.open('qa-unrelated-cache'));
  worker=emergency;
  await page.evaluate(async()=>{await(await navigator.serviceWorker.getRegistration('/')).update();});
  await waitState(page,async()=>(await navigator.serviceWorker.getRegistration('/'))===undefined && (await caches.keys()).length===0);
  assert.deepEqual(await page.evaluate(()=>caches.keys()),[]);check('kill worker takes over without reload, deletes all caches and unregisters');
  // Registration code can attempt registration again after a later navigation;
  // the published kill worker always unregisters and never handles fetch.
  assert.deepEqual(evidence.externalRequests,[]);
  evidence.posts=posts.map(p=>({url:p.url,status:p.status}));
  evidence.originRequests=requests;
  await context.close();
}finally{await browser.close();await new Promise(ok=>server.close(ok));await mkdir('integration-qa/service-worker',{recursive:true});await writeFile('integration-qa/service-worker/browser.json',JSON.stringify(evidence,null,2)+'\n');}
