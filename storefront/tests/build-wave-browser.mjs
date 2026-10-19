import assert from 'node:assert/strict';
import { readFile, writeFile, stat, readdir, access } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { createServer } from 'node:http';
import { promisify } from 'node:util';
import { execFile, spawn } from 'node:child_process';
// Installed Playwright, system Chrome: no browser download, isolated temporary profile managed by Playwright.
let playwright = process.env.PLAYWRIGHT_MODULE;
if (!playwright) for (const cache of await readdir(join(homedir(), '.npm/_npx'))) {
  const candidate = join(homedir(), '.npm/_npx', cache, 'node_modules/playwright/index.mjs');
  try { await access(candidate); playwright = candidate; break; } catch {}
}
if (!playwright) throw new Error('Install test tool: npm exec --yes --package=playwright -- playwright --version');
const { chromium } = await import(pathToFileURL(playwright).href);
const evidence={pages:[],network:[],gallery:[],metrika:[]};
const preview=spawn(process.execPath,['storefront/server.mjs','--mode=preview'],{env:{...process.env,STOREFRONT_PORT:'0'},stdio:['ignore','pipe','pipe']});
const origin=await new Promise((yes,no)=>{let msg='';preview.stdout.on('data',b=>{msg+=b;const m=msg.match(/localhost:(\d+)/);if(m)yes('http://127.0.0.1:'+m[1]);});preview.stderr.on('data',b=>process.stderr.write(b));preview.once('exit',c=>no(Error('server exit '+c)));});
const root=resolve('storefront/production/dist');
const mime={'.js':'application/javascript','.css':'text/css','.html':'text/html','.json':'application/json','.webp':'image/webp','.csv':'text/csv','.svg':'image/svg+xml','.png':'image/png'};
const production=createServer(async(req,res)=>{try {let path=join(root,new URL(req.url,'http://local.test').pathname);if((await stat(path)).isDirectory())path=join(path,'index.html');const data=await readFile(path);res.setHeader('Content-Type',mime[path.slice(path.lastIndexOf('.'))]||'application/octet-stream');res.end(data);}catch{res.writeHead(404);res.end('404');}});
await new Promise(r=>production.listen(0,'127.0.0.1',r));
const prodOrigin='http://127.0.0.1:'+production.address().port;
let browser;
try {
 const run = promisify(execFile);
 evidence.curl=[];
 for (const [mode,host] of [['preview',origin],['production',prodOrigin]]) for (const path of ['/','/catalog','/tree/miranda','/blog','/privacy','/testy','/spasibo','/person','/robots.txt','/sitemap.xml']) {
  const {stdout}=await run('curl',['-sS','--max-time','10','-o','/dev/null','-w','%{http_code}',host+path]);
  assert.equal(Number(stdout),200);evidence.curl.push({mode,path,status:Number(stdout)});
 }
 browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
 const context=await browser.newContext({viewport:{width:390,height:844},deviceScaleFactor:1});
 await context.route('**/*',async route=>{const url=route.request().url();if(!url.startsWith(origin)&&!url.startsWith(prodOrigin)){evidence.network.push({blocked:url});return route.abort();}if(!['GET','HEAD'].includes(route.request().method()))throw Error('Unexpected write');await route.continue();});
 const page=await context.newPage();let requested=[];
 page.on('request',r=>requested.push(r.url()));
 for(const route of ['/','/catalog','/catalog-tree','/catalog-tree-1','/blog','/blog/iskusstvennaya-yelka-cena-i-chto-na-nee-vliyaet','/tree/miranda','/tree/darina','/privacy','/testy','/spasibo']) {
  requested=[];const response=await page.goto(origin+route,{waitUntil:'networkidle'});assert.equal(response.status(),200);
  const data=await page.evaluate(()=>({title:document.title,description:document.querySelector('meta[name=description]')?.content,og:['title','description','image'].map(k=>document.querySelector(`meta[property="og:${k}"]`)?.content),canonical:document.querySelector('link[rel=canonical]')?.href,robots:document.querySelector('meta[name=robots]')?.content,consentLinks:document.querySelectorAll('a[href="/person"]').length,thumbnails:document.querySelectorAll('img[src*="catalog-thumbs"]').length,mode:window.__LE_STOREFRONT_CONFIG__?.mode}));
  assert.ok(data.description);assert.ok(data.og.every(Boolean));assert.equal(data.mode,'preview');
  assert.ok(!requested.some(u=>u.includes('mc.yandex.ru')));assert.ok(!requested.some(u=>u.includes('.supabase.co/storage/v1/object/public/le-catalog-images')));
  evidence.pages.push({route,status:response.status(),...data,requests:requested.length});
 }
 for(const width of [390,1440]) {
  await page.setViewportSize({width,height:900});requested=[];
  await page.goto(origin+'/tree/miranda',{waitUntil:'networkidle'});
  const thumb=page.locator('[data-storefront-gallery] img').first();await thumb.scrollIntoViewIfNeeded();await page.waitForTimeout(150);
  const data=await thumb.evaluate(img=>({currentSrc:img.currentSrc,full:img.dataset.fullSrc,width:img.naturalWidth,height:img.naturalHeight}));
  assert.ok(data.currentSrc.includes('/media/catalog-thumbs/'));assert.ok(data.full.includes('/media/catalog-pinned/'));
  assert.ok(!requested.includes(origin+data.full),'Gallery original requested before open');
  await thumb.click();await page.waitForTimeout(200);
  const full=await page.locator('.storefront-lightbox img').getAttribute('src');assert.equal(full,data.full);assert.ok(requested.includes(origin+data.full));
  await page.screenshot({path:`agent-context/build-wave-gallery-${width}.png`});
  evidence.gallery.push({viewport:width,...data,lightbox:full,originalOnlyOnOpen:true});
  await page.keyboard.press('Escape');
 }
 // Re-render from the REAL raw accepted feed, preserving its pinned same-file URLs.
 const { readFeedText }=await import('../products/build-feed.mjs');
 const feeds=Object.fromEntries(await Promise.all(['trees','decor'].map(async name=>[name,await readFeedText(name)])));
 await context.route('**/__offline/catalog/{trees,decor}.csv',route=>route.fulfill({contentType:'text/csv',body:feeds[new URL(route.request().url()).pathname.split('/').pop().replace('.csv','')]}));
 requested=[];await page.goto(origin+'/catalog',{waitUntil:'networkidle'});
 await page.evaluate(()=>document.dispatchEvent(new Event('storefront:products-added')));await page.waitForTimeout(200);
 assert.ok(!requested.some(u=>u.includes('supabase.co')));assert.ok(await page.locator('[data-storefront-image] img[src*="catalog-thumbs"]').count());
 evidence.sameFileSync={remotePhotoRequests:0,rawFeedRefresh:true};
 // Unmodified production config, served locally: host guard suppresses the counter.
 requested=[];await page.goto(prodOrigin+'/catalog',{waitUntil:'networkidle'});
 assert.ok(!requested.some(u=>u.includes('mc.yandex.ru')));evidence.metrika.push({mode:'production',host:'127.0.0.1',requests:0});
 // Execute the production entry on the real-domain origin in a fulfilled, offline page.
 await context.route('https://lady-elka.ru/__wave-counter',route=>route.fulfill({contentType:'text/html',body:'<html><head></head><body></body></html>'}));
 const counter=await readFile('storefront/production/dist/f/metrika.js','utf8');
 await page.goto('https://lady-elka.ru/__wave-counter');
 await page.evaluate(()=>{window.__LE_STOREFRONT_CONFIG__={mode:'production'};window.__counterCalls=[];window.ym=(...args)=>window.__counterCalls.push(args);});
 requested=[];await page.addScriptTag({content:counter});await page.waitForTimeout(100);
 const calls=await page.evaluate(()=>window.__counterCalls);assert.equal(calls[0][0],113669509);assert.equal(calls[0][2].ecommerce,'dataLayer');
 assert.ok(requested.some(u=>u==='https://mc.yandex.ru/metrika/tag.js?id=113669509'));
 evidence.metrika.push({mode:'production',host:'lady-elka.ru',tagRequestedButBlocked:true,init:calls[0]});
 await writeFile('agent-context/build-wave-browser.json',JSON.stringify(evidence,null,2)+'\n');
 console.log(JSON.stringify({pages:evidence.pages.length,gallery:evidence.gallery,sameFileSync:evidence.sameFileSync,metrika:evidence.metrika}));
} finally {await browser?.close();preview.kill();await new Promise(r=>production.close(r));}
