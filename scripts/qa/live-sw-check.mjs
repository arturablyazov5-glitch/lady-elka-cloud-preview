#!/usr/bin/env node
// Live SW: CDP page + worker targets; NetLog audits invisible worker update checks.
// No server/site changes. Raw NetLog and isolated Chrome profile are always removed.
import { createRequire } from 'node:module';
import { mkdtemp, readdir, mkdir, writeFile, rm } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
const arg = (k,d) => process.argv.find(x=>x.startsWith(`--${k}=`))?.slice(k.length+3) ?? d;
const base = arg('base');
if (!base || !/^https?:$/.test(new URL(base).protocol)) throw Error('--base=https://… is required');
const origin = new URL(base).origin, limit = Number(arg('limit','250'));
if (!Number.isInteger(limit) || limit < 20 || limit > 250) throw Error('--limit must be 20..250');
const out = resolve(arg('out','agent-context/live-sw-measure.json'));
let pw = process.env.PLAYWRIGHT_PACKAGE_JSON;
if (!pw) { try { pw = createRequire(import.meta.url).resolve('playwright/package.json'); } catch {} }
if (!pw) for (const name of await readdir(join(process.env.HOME,'.npm/_npx')).catch(()=>[])) {
  const p = join(process.env.HOME,'.npm/_npx',name,'node_modules/playwright/package.json');
  try { createRequire(p)('playwright'); pw=p; break; } catch {}
}
if (!pw) throw Error('Install Playwright or set PLAYWRIGHT_PACKAGE_JSON');
const { chromium } = createRequire(pw)('playwright');
const temp = await mkdtemp(join(tmpdir(),'le-live-sw-')), netfile=join(temp,'netlog.json');
const result={capturedAt:new Date().toISOString(),base:origin,limit,records:[],console:[],blocked:[],modes:{},complete:false};
let context, page, mode='setup', step='setup', stopped=false, reservations=new Set(), sessions=[];
const safeURL = u => { try { const v=new URL(u); return v.origin+v.pathname; } catch { return u; } };
function netEvents() {
  try { const t=readFileSync(netfile,'utf8'); const events=[];
    for (const line of t.split('\n')) { const s=line.trim().replace(/,$/,''); if (s.startsWith('{"') && s.includes('"source"')) { try {events.push(JSON.parse(s));} catch {} } }
    const constants=JSON.parse(t.slice(0,t.indexOf('"events":'))+'"events":[]}').constants;
    return {events,constants};
  } catch { return {events:[],constants:{}}; }
}
function netRequests() {
  const {events,constants}=netEvents(), types=constants.logEventTypes||{}, starts=new Map(), rows=[];
  for (const e of events) {
    if (e.type===types.URL_REQUEST_START_JOB && e.params?.url) starts.set(e.source.id,e.params.url);
    if ([types.HTTP_TRANSACTION_SEND_REQUEST_HEADERS,types.HTTP_TRANSACTION_HTTP2_SEND_REQUEST_HEADERS,types.HTTP_TRANSACTION_QUIC_SEND_REQUEST_HEADERS].includes(e.type)) {
      const url=starts.get(e.source.id); if (url && new URL(url).origin===origin) rows.push({sourceId:e.source.id,time:e.time,url:safeURL(url),requestLine:e.params?.line||e.params?.headers?.find(h=>/^:method:/i.test(h))});
    }
    if (e.type===types.HTTP_TRANSACTION_READ_RESPONSE_HEADERS) {
      const row=rows.findLast(r=>r.sourceId===e.source.id);
      if (row) { row.status=Number(/(?:\s|:)(\d{3})(?:\s|$)/.exec(e.params?.headers?.[0]||'')?.[1])||null;
        row.cacheControl=e.params?.headers?.find(x=>/^cache-control:/i.test(x))?.replace(/^cache-control:\s*/i,'')||null;
        row.etag=!!e.params?.headers?.some(x=>/^etag:/i.test(x)); }
    }
  }
  return rows;
}
async function save() { await mkdir(dirname(out),{recursive:true}); await writeFile(out,JSON.stringify(result,null,2)+'\n'); }
async function stop(reason) { if(stopped)return; stopped=true; result.stopReason=reason; await save(); await context?.close().catch(()=>{}); }
function listen(session,label) {
  const pending=new Map();
  session.on('Network.requestWillBeSent',e=>{
    if(!/^https?:/.test(e.request.url))return;
    if(e.redirectResponse) { const prev=pending.get(e.requestId); if(prev) {prev.status=e.redirectResponse.status;prev.finished=true;prev.redirect=true;prev.fromServiceWorker=!!e.redirectResponse.fromServiceWorker;prev.fromDiskCache=!!e.redirectResponse.fromDiskCache;} }
    const row={mode,step,target:label,id:e.requestId,url:safeURL(e.request.url),type:e.type||'Other',method:e.request.method,hosting:new URL(e.request.url).origin===origin,fromDiskCache:false,fromServiceWorker:false,servedFromCache:false};
    result.records.push(row); pending.set(e.requestId,row);
  });
  session.on('Network.requestServedFromCache',e=>{const r=pending.get(e.requestId);if(r)r.servedFromCache=true;});
  session.on('Network.responseReceived',e=>{const r=pending.get(e.requestId);if(r)Object.assign(r,{status:e.response.status,fromDiskCache:!!e.response.fromDiskCache,fromServiceWorker:!!e.response.fromServiceWorker,fromPrefetchCache:!!e.response.fromPrefetchCache,cacheControl:Object.entries(e.response.headers).find(([k])=>k.toLowerCase()==='cache-control')?.[1]||null});});
  session.on('Network.responseReceivedExtraInfo',e=>{const r=pending.get(e.requestId);if(r)r.wireStatus=e.statusCode;});
  session.on('Network.loadingFinished',e=>{const r=pending.get(e.requestId);if(r){r.finished=true;r.encodedDataLength=e.encodedDataLength;}reservations.delete(label+e.requestId);});
  session.on('Network.loadingFailed',e=>{const r=pending.get(e.requestId);if(r){r.failure=e.errorText;r.cors=e.corsErrorStatus||null;}reservations.delete(label+e.requestId);});
  session.on('Fetch.requestPaused',async e=>{
    try {
      if(!['GET','HEAD','OPTIONS'].includes(e.request.method)) {result.blocked.push({mode,step,url:safeURL(e.request.url),method:e.request.method,reason:'no real submissions'});await session.send('Fetch.fulfillRequest',{requestId:e.requestId,responseCode:200,responseHeaders:[{name:'Content-Type',value:'application/json'}],body:Buffer.from('{"ok":true,"mock":true}').toString('base64')});return;}
      if(new URL(e.request.url).origin===origin) {
        // Ten requests reserved for invisible SW update checks / event delivery lag.
        if(stopped || Math.max(netRequests().length, result.records.filter(r=>r.hosting && !r.fromDiskCache && !r.fromServiceWorker && !r.servedFromCache && !r.fromPrefetchCache && (r.finished || r.status)).length)+reservations.size>=limit-10) {await session.send('Fetch.failRequest',{requestId:e.requestId,errorReason:'Aborted'});void stop('Soft budget reached (10-request safety reserve)');return;}
        reservations.add(label+(e.networkId||e.requestId));
      }
      await session.send('Fetch.continueRequest',{requestId:e.requestId});
    } catch(error) { if(!stopped)result.console.push({mode,step,type:'harness',message:error.message}); }
  });
}
async function state() { return page.evaluate(async()=>({controller:navigator.serviceWorker.controller?.scriptURL||null,registrations:await Promise.all((await navigator.serviceWorker.getRegistrations()).map(async r=>({scope:r.scope,updateViaCache:r.updateViaCache,active:r.active?.state,scriptURL:r.active?.scriptURL,waiting:r.waiting?.state||null}))),caches:await Promise.all((await caches.keys()).map(async name=>({name,entries:(await(await caches.open(name)).keys()).length})))})); }
async function settle() {if(stopped)throw Error('Budget stopped');await page.waitForTimeout(900);}
async function visit(path,label) {
  if (!path.endsWith('/')) throw Error(`Scenario link lacks trailing slash: ${path}`);
  step=label;
  if (mode==='cold' && label==='home') {
    await page.goto(new URL(path,origin).href,{waitUntil:'networkidle',timeout:45000});
  } else {
    const link=page.locator(`a[href="${path}"]:visible`).first();
    if (!await link.count()) throw Error(`Missing visible site link: ${path}`);
    await Promise.all([page.waitForNavigation({waitUntil:'networkidle',timeout:45000}),link.click()]);
  }
  await settle();
}
async function scroll() {await page.evaluate(async()=>{for(let y=0;y<document.documentElement.scrollHeight;y+=700){scrollTo(0,y);await new Promise(r=>setTimeout(r,90));}});await settle();}
try {
  context=await chromium.launchPersistentContext(join(temp,'profile'),{executablePath:process.env.CHROME_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true,viewport:{width:390,height:900},deviceScaleFactor:1,reducedMotion:'reduce',locale:'ru-RU',args:[`--log-net-log=${netfile}`,'--net-log-capture-mode=Default','--disable-background-networking']});
  result.browser=context.browser()?.version()||'Chrome persistent context';
  page=context.pages()[0];
  // In-page mocks are a second safety layer; no lead/pay POST leaves the page.
  await context.addInitScript(()=>{const real=window.fetch;window.fetch=function(input,init){const method=(init?.method||input?.method||'GET').toUpperCase();if(!['GET','HEAD','OPTIONS'].includes(method))return Promise.resolve(new Response('{"ok":true,"mock":true}',{status:200,headers:{'Content-Type':'application/json'}}));return real.apply(this,arguments);};});
  page.on('console',m=>{if(['error','warning'].includes(m.type()))result.console.push({mode,step,type:m.type(),message:m.text().replace(/https?:\/\/[^\s]+/g,u=>safeURL(u))});});
  page.on('pageerror',e=>result.console.push({mode,step,type:'pageerror',message:e.message}));
  const cdp=await context.newCDPSession(page);result.browser=(await cdp.send('Browser.getVersion')).product;listen(cdp,'page');await cdp.send('Network.enable');await cdp.send('Fetch.enable',{patterns:[{urlPattern:'*',requestStage:'Request'}]});
  // Nonflattened CDP bridge enables Network/Fetch before the worker runs.
  let seq=0;const callbacks=new Map();
  cdp.on('Target.receivedMessageFromTarget',e=>{const m=JSON.parse(e.message);if(m.id){const cb=callbacks.get(m.id);if(cb){callbacks.delete(m.id);m.error?cb.reject(Error(m.error.message)):cb.resolve(m.result);}}else sessions.find(s=>s.id===e.sessionId)?.emit(m.method,m.params);});
  cdp.on('Target.attachedToTarget',async e=>{
    if(e.targetInfo.type!=='service_worker'){await cdp.send('Target.sendMessageToTarget',{sessionId:e.sessionId,message:JSON.stringify({id:++seq,method:'Runtime.runIfWaitingForDebugger'})});return;}
    const handlers=new Map();const s={id:e.sessionId,on:(n,f)=>handlers.set(n,[...(handlers.get(n)||[]),f]),emit:(n,p)=>(handlers.get(n)||[]).forEach(f=>f(p)),send:(method,params={})=>new Promise((resolve,reject)=>{const id=++seq;callbacks.set(id,{resolve,reject});cdp.send('Target.sendMessageToTarget',{sessionId:e.sessionId,message:JSON.stringify({id,method,params})}).catch(reject);})};sessions.push(s);listen(s,'worker');
    try{await s.send('Network.enable');await s.send('Fetch.enable',{patterns:[{urlPattern:'*',requestStage:'Request'}]});await s.send('Runtime.runIfWaitingForDebugger');}catch(e){result.console.push({mode,step,type:'harness',message:e.message});}
  });
  await cdp.send('Target.setAutoAttach',{autoAttach:true,waitForDebuggerOnStart:true,flatten:false});
  const deadline=setTimeout(()=>void stop('Five-minute run deadline'),300000);deadline.unref();context.on('close',()=>clearTimeout(deadline));
  const timer=setInterval(()=>{if(netRequests().length>=limit-10)void stop('Soft budget reached (wire watcher)');},200);timer.unref();context.on('close',()=>clearInterval(timer));
  let paths;
  for(const pass of ['cold','repeat']) {
    mode=pass;result.modes[mode]={startNet:netRequests().length,actions:[],complete:false};
    await visit('/','home');await page.waitForFunction(()=>!!navigator.serviceWorker.controller,{},{timeout:25000});await scroll();
    await visit('/catalog/','catalog');await scroll();
    paths ||= await page.locator('a.stroke-catalog__button[href^="/tree/"]').evaluateAll(ns=>[...new Set(ns.map(n=>n.getAttribute('href')))].slice(0,2));
    if(paths.length!==2)throw Error(`Expected 2 tree cards, got ${paths.length}`);
    for(const [index,path] of paths.entries()) {
      if(index) await visit('/catalog/','catalog-between-cards');
      await visit(path,path);const select=page.locator('[data-storefront-option="height"]').first();const heights=await select.locator('option').evaluateAll(ns=>ns.map(n=>n.value).slice(0,3));if(heights.length<2)throw Error('Not enough heights');
      for(const h of heights){await select.selectOption(h);await settle();}
      const img=page.locator('[data-storefront-gallery-root] img, [data-storefront-gallery] img').first();await img.click();await settle();await page.locator('[data-gallery-next]').click();await settle();await page.locator('[data-gallery-close]').click();
      await page.locator('[data-storefront-product] .buy-btn').first().click();await settle();await page.keyboard.press('Escape');result.modes[mode].actions.push({path,heights,gallery:true,buy:true});
    }
    step='cart';await page.locator('[data-cart-open]:visible').first().click();await settle();if(!await page.locator('[data-cart-popup]').isVisible())throw Error('Cart not visible');await page.keyboard.press('Escape');
    result.modes[mode].state=await state();
    if (sessions.length) result.modes[mode].workerConfig=(await sessions.at(-1).send('Runtime.evaluate',{expression:'JSON.stringify({release:LE_SW_CONFIG.release,kill:LE_SW_CONFIG.kill,assets:Object.keys(LE_SW_CONFIG.assets).length})',returnByValue:true})).result?.value;result.modes[mode].endNet=netRequests().length;result.modes[mode].complete=true;await save();console.log(`${mode}: ${result.modes[mode].endNet-result.modes[mode].startNet} wire requests (preliminary)`);
  }
  result.complete=true;
} catch(e) {result.error=e.message;if(page&&!page.isClosed())result.partialState=await state().catch(()=>null);}
finally {
  await context?.close().catch(()=>{});
  result.netRequests=netRequests();
  let pass='cold',homeCount=0;for(const r of result.netRequests){if(r.url===origin+'/'){homeCount++;if(homeCount===2)pass='repeat';}r.mode=pass;}
  result.counting='Network.requestWillBeSent/responseReceived/loadingFinished on page and worker; SW/disk/memory/prefetch excluded; redirect response flags preserved. NetLog HTTP1/HTTP2/HTTP3 request headers reconcile worker misses and add invisible sw.js checks. 304 counts as a wire request.';
  // CDP includes worker network misses; page SW responses are excluded, never assumed hits.
  for(const [name,m] of Object.entries(result.modes)) {
    m.wireRequests=result.netRequests.filter(r=>r.mode===name);m.records=result.records.filter(r=>r.mode===name);
    m.cdpNetwork=m.records.filter(r=>r.hosting&&!r.fromDiskCache&&!r.fromServiceWorker&&!r.servedFromCache&&!r.fromPrefetchCache&&(r.finished||r.status));
    m.networkTypes={};for(const r of m.wireRequests){const pathname=new URL(r.url).pathname;const type=pathname==='/sw.js'?'ServiceWorker':/\.css$/.test(pathname)?'Stylesheet':/\.js$/.test(pathname)?'Script':/\.woff2?$/.test(pathname)?'Font':/\.(webp|png|jpe?g|svg|ico|avif)$/.test(pathname)?'Image':'Document';m.networkTypes[type]=(m.networkTypes[type]||0)+1;}
    m.redirect308=m.wireRequests.filter(r=>r.status===308).length;
    m.fromServiceWorker=m.records.filter(r=>r.fromServiceWorker).length;m.fromDiskCache=m.records.filter(r=>r.fromDiskCache).length;m.servedFromCache=m.records.filter(r=>r.servedFromCache).length;
  }
  result.redirect308=result.netRequests.filter(r=>r.status===308).length;
  result.workerTargets=sessions.length;try{await save();}finally{await new Promise(r=>setTimeout(r,150));await rm(temp,{recursive:true,force:true});}console.log(JSON.stringify({complete:result.complete,error:result.error,stopReason:result.stopReason,wireRequests:result.netRequests.length,workerTargets:result.workerTargets,out}));
}
