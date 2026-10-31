// Existing Chrome + Node WebSocket only. No installs; no storefront build outputs.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn, execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { build } from 'esbuild';
import { promisify } from 'node:util';
const execFileAsync = promisify(execFile);

const browser = process.env.CHECKOUT_QA_CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const entry = `import {initProducts} from './storefront/client/product-ui.js';
import {initFilter} from './storefront/client/filter.js';
import {initGallery} from './storefront/client/gallery.js';
import * as cart from './storefront/client/cart-store.js';
import './storefront/public/f/site-runtime.js';
initProducts();initFilter();initGallery();window.qa={cart,ready:true};`;
const compiled = await build({stdin:{contents:entry,resolveDir:process.cwd(),sourcefile:'product-qa.js'},bundle:true,format:'iife',write:false});
const {presentProduct} = await import('../products/presentation.mjs');
const {renderProductPage} = await import('../products/product-page.mjs');
const {readFile} = await import('node:fs/promises');
const template = await readFile(new URL('../public/tree/miranda.html',import.meta.url),'utf8');
const view=presentProduct({id:'synthetic',title:'Тест',variants:[
// catalogPhotos accepts only Supabase https URLs or verified pinned copies (/media/catalog-pinned/<sha256>.ext).
{id:'green180',category:'Зелёная',height:180,price:1000,oldPrice:1200,diameter:80,branches:0,photos:['/media/catalog-pinned/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.png'],description:'Первый'},
{id:'snow210',category:'Заснеженная',height:210,price:2000,diameter:100,branches:200,photos:['/media/catalog-pinned/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb.png','/media/catalog-pinned/cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc.png'],description:'Второй'}
]}, {kind:'tree',path:'/tree/test'});
const rendered=renderProductPage(template,view,{},'Описание');
const opening=/<div\b[^>]*class=['"][^'"]*\bproduct-wrapper__cms\b[^'"]*['"][^>]*>/.exec(rendered);
let depth=1,end;const tags=/<\/?div\b[^>]*>/g;tags.lastIndex=opening.index+opening[0].length;
for(let tag;(tag=tags.exec(rendered));){depth+=tag[0].startsWith('</')?-1:1;if(!depth){end=tags.lastIndex;break}}
const scope=rendered.slice(opening.index,end).replace('product-wrapper__cms','product-wrapper__cms product-card').replace(/<\/div>$/,`<script type="application/json" data-storefront-variants>${JSON.stringify(view)}</script></div>`);
const {writeFile,mkdir,cp} = await import('node:fs/promises');
const directory=await mkdtemp(join(tmpdir(),'le-product-generator-'));
const workspace={directory,cleanup:()=>rm(directory,{recursive:true,force:true,maxRetries:8,retryDelay:150})};
let cards;
try{
 for(const name of ['storefront/products','storefront/url-path.mjs','storefront/client','storefront/catalog-snapshots','storefront/product-routes.json','supabase/functions/_shared/product-rules.mjs']){
 const dest=join(directory,name);await mkdir(join(dest,'..'),{recursive:true});await cp(join(process.cwd(),name),dest,{recursive:true});
 }
 await writeFile(join(workspace.directory,'deny.mjs'),"globalThis.fetch=()=>{throw new Error('Network forbidden during product QA build')};\n");
 const target=join(workspace.directory,'product-qa-output');
 for(const route of ['catalog','catalog/landscape-gardening','catalog-tree','','main','catalog-decor','catalog-tree-1']){
 const dir=join(target,route);await mkdir(dir,{recursive:true});
 await writeFile(join(dir,'index.html'),await readFile(join(process.cwd(),'storefront/public',route?`${route}.html`:'index.html'),'utf8'));
 }
 await execFileAsync(process.execPath,['--import',join(workspace.directory,'deny.mjs'),'storefront/products/catalog-cards.mjs'],{cwd:workspace.directory,env:{...process.env,LE_BUILD_TARGET:target},timeout:60000});
 cards=await readFile(join(target,'index.html'),'utf8');
}finally{await workspace.cleanup()}
// Include generated card roots only, excluding captured scripts and unrelated UI.
const cardRoots=[];const cardTags=/<div\b[^>]*data-storefront-product[^>]*>/g;
for(let m;(m=cardTags.exec(cards));){let d=1;const t=/<\/?div\b[^>]*>/g;t.lastIndex=m.index+m[0].length;for(let n;(n=t.exec(cards));){d+=n[0].startsWith('</')?-1:1;if(!d){cardRoots.push(cards.slice(m.index,t.lastIndex));break}}}
assert.ok(cardRoots.length>0,'generated catalog cards present');
for(const card of cardRoots){assert.match(card,/data-cart-open/);assert.doesNotMatch(card,/data-action-element|data-tt-collection-item-id/)}
const emptyView=presentProduct({id:'empty',title:'Нет',variants:[]},{kind:'tree',path:'/tree/empty'});
const emptyRendered=renderProductPage(template,emptyView,{},'Описание');
const emptyOpening=/<div\b[^>]*class=['"][^'"]*\bproduct-wrapper__cms\b[^'"]*['"][^>]*>/.exec(emptyRendered);
let emptyDepth=1,emptyEnd;const emptyTags=/<\/?div\b[^>]*>/g;emptyTags.lastIndex=emptyOpening.index+emptyOpening[0].length;
for(let t;(t=emptyTags.exec(emptyRendered));){emptyDepth+=t[0].startsWith('</')?-1:1;if(!emptyDepth){emptyEnd=emptyTags.lastIndex;break}}
const emptyScope=emptyRendered.slice(emptyOpening.index,emptyEnd).replace(/<\/div>$/,`<script type="application/json" data-storefront-variants>${JSON.stringify(emptyView)}</script></div>`);
const html=`<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="/qa.css"><div role="dialog" id="filter-dialog"><select class="js-flt-category"><option value="">Любая категория</option><option>Зелёная</option><option>Заснеженная</option></select><select class="js-flt-height"></select><input class="js-flt-price-min"><input class="js-flt-price-max"><button class="js-flt-reset">Сброс</button></div>${scope}<section id="generated-cards">${cardRoots.join('')}</section><section id="unavailable">${emptyScope}</section><div class="pop-up" data-cart-popup aria-hidden="true" style="display:none"></div><script type="application/json" data-storefront-page-product>${JSON.stringify(view)}</script><script src="/qa.js"></script>`;
const selectCss=await readFile(new URL('../public/f/catalog-cards.css',import.meta.url),'utf8');
const server=createServer((req,res)=>{
res.setHeader('Content-Security-Policy',"default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'none'; img-src 'none'; worker-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'");
if(req.url==='/qa.css'){res.setHeader('Content-Type','text/css');return res.end(selectCss+' .filter-select{width:240px;height:48px}')}
if(req.url==='/qa'){res.setHeader('Content-Type','text/html');return res.end(html)}
if(req.url==='/qa.js'){res.setHeader('Content-Type','text/javascript');return res.end(compiled.outputFiles[0].text)}res.writeHead(404);res.end();});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const origin=`http://127.0.0.1:${server.address().port}`;
const profile=await mkdtemp(join(tmpdir(),'checkout-browser-offline-'));
let chrome,ws,scenarioError;const pending=new Map();const listeners=new Map();let seq=0;const blocked=[];
const command=(method,params={})=>new Promise((resolve,reject)=>{
 const id=++seq;pending.set(id,{resolve,reject});ws.send(JSON.stringify({id,method,params}));
});
const evaluate=async expression=>{
 const r=await command('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});
 if(r.exceptionDetails)throw new Error(JSON.stringify(r.exceptionDetails));return r.result.value;
};
const until=async(expression)=>{for(let i=0;i<150;i++){if(await evaluate(expression))return;await new Promise(r=>setTimeout(r,20))}throw new Error(`timeout ${expression}`)};
const navigate=async(url)=>{await command('Page.navigate',{url});await until('window.qa?.ready===true')};
try{
 // Fail closed before Chrome starts; loopback is the only proxy bypass. No persistent user profile.
 chrome=spawn(browser,['--headless=new','--no-first-run','--no-default-browser-check','--disable-background-networking','--disable-component-update','--disable-sync','--disable-extensions','--disable-quic','--disable-domain-reliability','--metrics-recording-only','--disable-features=MediaRouter,OptimizationHints','--proxy-server=http://127.0.0.1:9','--proxy-bypass-list=127.0.0.1','--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1',`--user-data-dir=${profile}`,'--remote-debugging-port=0','about:blank'],{stdio:['ignore','ignore','pipe'],detached:true});
 const endpoint=await new Promise((resolve,reject)=>{let s='';const timer=setTimeout(()=>reject(new Error('Chrome CDP startup timeout')),15000);chrome.stderr.on('data',b=>{s+=b;const m=s.match(/DevTools listening on (ws:\/\/[^\s]+)/);if(m){clearTimeout(timer);resolve(m[1])}});chrome.once('error',error=>{clearTimeout(timer);reject(error)});chrome.once('exit',code=>{clearTimeout(timer);reject(new Error(`Chrome exited during startup: ${code}`))})});
 const httpEndpoint=endpoint.replace('ws://','http://').replace(/\/devtools\/browser\/.*/, '/json/list');
 const pages=await (await fetch(httpEndpoint)).json();ws=new WebSocket(pages.find(p=>p.type==='page').webSocketDebuggerUrl);
 await new Promise((r,j)=>{ws.onopen=r;ws.onerror=j});
 ws.onmessage=e=>{const msg=JSON.parse(e.data);if(msg.id){const p=pending.get(msg.id);pending.delete(msg.id);msg.error?p.reject(new Error(JSON.stringify(msg.error))):p.resolve(msg.result)}else listeners.get(msg.method)?.(msg.params)};
 listeners.set('Fetch.requestPaused',async p=>{const u=new URL(p.request.url);const allowed=u.origin===origin && ['/qa','/qa.js','/qa.css'].includes(u.pathname);
 if(!allowed)blocked.push({url:p.request.url,type:p.resourceType});await command(allowed?'Fetch.continueRequest':'Fetch.failRequest',allowed?{requestId:p.requestId}:{requestId:p.requestId,errorReason:'BlockedByClient'});});
 await command('Page.enable');await command('Runtime.enable');await command('Network.enable');await command('Network.setBypassServiceWorker',{bypass:true});
 await command('Fetch.enable',{patterns:[{urlPattern:'*',requestStage:'Request'}]});
 if(process.env.CHECKOUT_QA_FAIL_AFTER_START==='1')throw new Error('Injected scenario failure after Chrome startup');
 await navigate(`${origin}/qa`);
 await evaluate("qa.cart.clear()");
 await evaluate(`document.querySelector('.js-flt-category').value='Зелёная';document.querySelector('.js-flt-height').value='180';document.querySelector('.js-flt-price-min').value='1500';document.querySelector('.js-flt-category').dispatchEvent(new Event('change'));`);
 assert.equal(await evaluate("document.querySelector('.product-card').style.display"),'none');
 await evaluate("document.querySelector('.js-flt-reset').click()");
 assert.equal(await evaluate("document.querySelector('.product-card').style.display"),'');
 assert.equal(await evaluate("document.querySelector('.price').textContent.trim()"),'1\u00a0000 ₽');

 // Exercise the long, scrollable height menu at desktop and phone sizes.
 for(const width of [1440,390]){
  await command('Emulation.setDeviceMetricsOverride',{width,height:844,deviceScaleFactor:1,mobile:width===390});
  await evaluate("document.querySelector('.js-flt-height').parentElement.scrollIntoView({block:'center'})");
  await new Promise(r=>setTimeout(r,100));
  await evaluate("document.querySelector('.js-flt-height').parentElement.querySelector('button').click()");
  assert.equal(await evaluate("document.querySelector('.storefront-select-menu:not([hidden])').parentElement.id"),'filter-dialog');
  await evaluate("document.querySelector('.storefront-select-menu:not([hidden])').scrollTop=10000");
  await new Promise(r=>setTimeout(r,50));
  assert.equal(await evaluate("!!document.querySelector('.storefront-select-menu:not([hidden])')"),true,'scrolling options keeps the menu open');
  const lastHeight=await evaluate("document.querySelector('.js-flt-height').options[document.querySelector('.js-flt-height').options.length-1].value");
  await evaluate("document.querySelector('.storefront-select-menu:not([hidden]) [role=option]:last-child').click()");
  assert.equal(await evaluate("document.querySelector('.js-flt-height').value"),lastHeight);
  assert.equal(await evaluate("document.querySelector('.js-flt-height').parentElement.querySelector('.filter-select__value').textContent"),lastHeight+' см');
  await evaluate("document.querySelector('.js-flt-reset').click()");
 }
 // Compare visible cards AND their displayed variant to an independent predicate.
 const scenarios=[{category:'Зелёная'},{height:180},{min:25000},{max:20000},{category:'Заснеженная',height:210,min:10000,max:60000},{min:90000,max:10000}];
 for(const criteria of scenarios){
  await evaluate(`(()=>{const c=${JSON.stringify(criteria)};document.querySelector('.js-flt-reset').click();for(const [name,value] of Object.entries(c)){const e=document.querySelector('.js-flt-'+({min:'price-min',max:'price-max'}[name]||name));e.value=value;e.dispatchEvent(new Event(e.tagName==='SELECT'?'change':'input',{bubbles:true}));}})()`);
  const failures=await evaluate(`(()=>{const c=${JSON.stringify(criteria)};return [...document.querySelectorAll('.product-card[data-storefront-product]')].flatMap(card=>{const p=JSON.parse(card.querySelector('[data-storefront-variants]').textContent);const matches=v=>(!c.category||v.category===c.category)&&(!c.height||Number(v.height)===c.height)&&(!c.min||v.price>=c.min)&&(!c.max||v.price<=c.max);const expected=p.variants.some(matches);if((card.style.display!=='none')!==expected)return [p.title+': visibility'];if(!expected)return [];const category=card.querySelector('[data-storefront-category]')?.value;const height=card.querySelector('[data-storefront-variant]')?.value;const shown=p.variants.find(v=>(!category||v.category===category)&&(!height||String(v.height)===height));return shown&&matches(shown)?[]:[p.title+': displayed variant'];});})()`);
  assert.deepEqual(failures,[],JSON.stringify(criteria));
 }
 await evaluate("document.querySelector('.js-flt-reset').click()");
 // Empty results retain both price hints without adding explanatory text.
 await evaluate("{const c=document.querySelector('.js-flt-category');c.value='Зелёная';const h=document.querySelector('.js-flt-height');h.add(new Option('999 см','999'));h.value='999';h.dispatchEvent(new Event('change'));}");
 assert.equal(await evaluate("document.querySelector('[data-filter-feedback]')"),null);
 assert.equal(await evaluate("[...document.querySelectorAll('.product-card[data-storefront-product]')].every(c=>c.style.display==='none')"),true);
 assert.equal(await evaluate("!!document.querySelector('.js-flt-price-min').placeholder && !!document.querySelector('.js-flt-price-max').placeholder"),true);
 assert.equal(await evaluate("!!document.querySelector('.storefront-filter-empty:not([hidden])')"),true);
 await evaluate("document.querySelector('.storefront-filter-empty:not([hidden]) button').click()");
 assert.equal(await evaluate("document.querySelector('.js-flt-height').value"),'');
 assert.equal(await evaluate("[...document.querySelectorAll('.storefront-filter-empty')].every(e=>e.hidden)"),true);
 await evaluate("{const a=document.querySelector('.js-flt-price-min'),b=document.querySelector('.js-flt-price-max');a.value='60000';b.value='20000';a.dispatchEvent(new Event('input'));}");
 assert.equal(await evaluate("document.querySelector('[data-filter-feedback]')"),null);
 assert.equal(await evaluate("document.querySelector('.js-flt-price-min').getAttribute('aria-invalid')"),'true');
 await evaluate("document.querySelector('.js-flt-reset').click()");
 assert.equal(await evaluate("document.querySelector('.js-flt-price-min').getAttribute('aria-invalid')"),'false');
 assert.equal(await evaluate("document.querySelector('.js-flt-price-min').value"),'');
 // Reset in the modal must close it through the shared modal runtime.
 await evaluate(`{const panel=document.getElementById('filter-dialog');panel.classList.add('pop-up');const close=document.createElement('button');close.className='pop-up__inside-close-button';close.dataset.modalClose=panel.id;panel.append(close);const opener=document.createElement('button');opener.dataset.modalOpen=panel.id;document.body.append(opener);opener.click();const c=document.querySelector('.js-flt-category');c.value='Заснеженная';c.dispatchEvent(new Event('change'));document.querySelector('.js-flt-price-min').value='999999';document.querySelector('.js-flt-reset').click();}`);
 assert.equal(await evaluate("document.getElementById('filter-dialog').getAttribute('aria-hidden')"),'true','reset closes the filter modal');
 assert.equal(await evaluate("document.querySelector('.js-flt-category').selectedIndex"),0);
 assert.equal(await evaluate("document.querySelector('.js-flt-price-min').value"),'');
 console.log('Filter browser: scrollable height desktop/mobile, category, prices, combined filter, empty state and modal reset passed');
}catch(error){scenarioError=error;throw error;}finally{
 try{
 // Only our detached ephemeral process group; never signal a browser by name.
 ws?.close();
 const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
 let processCleanupError;
 try{if(chrome?.pid){
  // ps reports the owned PGID without kill(0)'s intermittent macOS EPERM.
  // Zombie rows cannot execute or keep the profile open.
  const members=async()=>{const {stdout}=await execFileAsync('/bin/ps',['-axo','pid=,pgid=,stat='],{timeout:2000});return stdout.trim().split('\n').map(row=>row.trim().split(/\s+/)).filter(row=>Number(row[1])===chrome.pid && !row[2]?.startsWith('Z'));};
  const signal=async name=>{if((await members()).length){try{process.kill(-chrome.pid,name)}catch(error){if(error.code!=='ESRCH')throw error}}};
  await signal('SIGTERM');
  for(let attempt=0;attempt<30 && (await members()).length;attempt++)await delay(100);
  await signal('SIGKILL');
  for(let attempt=0;attempt<20 && (await members()).length;attempt++)await delay(100);
  if((await members()).length)throw new Error('Ephemeral Chrome process group did not terminate');
 }
 }catch(error){processCleanupError=error}
 server.closeAllConnections();
 await new Promise((resolve,reject)=>server.close(error=>error?reject(error):resolve()));
 await rm(profile,{recursive:true,force:true,maxRetries:8,retryDelay:150});
 if(processCleanupError)throw processCleanupError;
 console.log('Offline QA cleanup complete');
 }catch(error){throw scenarioError?new AggregateError([scenarioError,error],'Scenario and cleanup both failed'):error;}
}
