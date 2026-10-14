// Local Chrome functional regression. No public origins or form mutations.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {access,readdir} from 'node:fs/promises';
import {homedir} from 'node:os';
import {join} from 'node:path';
const base=process.env.LOCAL_BASE_URL||'http://127.0.0.1:4174';
assert.ok(['127.0.0.1','localhost'].includes(new URL(base).hostname),'Local QA only');
let pkg=process.env.PLAYWRIGHT_PACKAGE_JSON;
if(!pkg)for(const cache of await readdir(join(homedir(),'.npm/_npx'))){const candidate=join(homedir(),'.npm/_npx',cache,'node_modules/playwright/package.json');try{await access(candidate);pkg=candidate;break;}catch{}}
const {chromium}=createRequire(pkg)('playwright');
const browser=await chromium.launch({channel:'chrome',headless:true});
try{for(const mobile of [false,true]){
 const context=await browser.newContext({viewport:{width:mobile?390:1440,height:mobile?844:1000},deviceScaleFactor:mobile?3:1,isMobile:mobile,hasTouch:mobile});
 await context.route('**/*',route=>new URL(route.request().url()).origin===new URL(base).origin&&route.request().method()==='GET'?route.continue():route.abort());
 const page=await context.newPage();
 for(const path of ['/','/catalog/','/tree/miranda/','/search/?search=ёлка']){
  await page.goto(base+path,{waitUntil:'load'});await page.waitForTimeout(1000);
  assert.ok(await page.evaluate(()=>[...document.querySelectorAll('img[data-le-src]')].every(i=>{const r=i.getBoundingClientRect();return !i.checkVisibility()||r.top>=innerHeight||r.bottom<=0})),'First viewport must have real image URLs');
  const height=await page.evaluate(()=>document.documentElement.scrollHeight);
  for(let y=0;y<height;y+=650){await page.evaluate(y=>scrollTo(0,y),y);await page.waitForFunction(()=>[...document.images].filter(i=>{const r=i.getBoundingClientRect();return i.checkVisibility()&&r.width&&r.height&&r.top<innerHeight&&r.bottom>0&&r.left<innerWidth&&r.right>0}).every(i=>i.naturalWidth>0&&!i.hasAttribute('data-le-src')),{},{timeout:5000});}
  if(path==='/tree/miranda/'){
   assert.equal(await page.locator('[data-storefront-gallery-root] img').first().getAttribute('loading'),'eager');
   await page.locator('[data-storefront-gallery-root] img').first().click();await page.locator('[data-gallery-next]').click();await page.waitForFunction(()=>document.querySelector('.storefront-lightbox img').naturalWidth>0);await page.keyboard.press('Escape');
  }
 }
 await page.goto(base+'/',{waitUntil:'load'});
 const deferredRequests=[];page.on('request',r=>{if(r.url().includes('qa-lazy-'))deferredRequests.push(r.url());});
 await page.evaluate(()=>{const original=document.querySelector('link[as="image"]').href;for(const name of ['hidden','far']){const image=document.createElement('img');image.id='qa-lazy-'+name;image.width=100;image.height=100;image.style.cssText=name==='hidden'?'position:fixed;top:0;visibility:hidden':'position:absolute;top:100000px';image.dataset.leSrc=original+'?qa-lazy-'+name;document.body.append(image);}});
 await page.waitForTimeout(500);assert.equal(deferredRequests.length,0,'Hidden and far photos must not request');
 await page.evaluate(()=>{document.querySelector('#qa-lazy-hidden').style.visibility='visible';document.querySelector('#qa-lazy-far').style.top='200px';});
 await page.waitForFunction(()=>['hidden','far'].every(name=>document.querySelector('#qa-lazy-'+name).naturalWidth>0));
 assert.equal(deferredRequests.length,2,'Reveal must load each photo once');
 await context.close();
 console.log((mobile?'Mobile':'Desktop')+' visible images, scroll, search and gallery PASS');
}
 const noJS=await browser.newContext({javaScriptEnabled:false});const page=await noJS.newPage();
 for(const path of ['/','/catalog/']){await page.goto(base+path,{waitUntil:'load'});assert.ok(await page.locator('noscript img').count()>0,'Static SEO/no-JS image fallback required');}
 await noJS.close();console.log('Hidden/far/reveal and no-JavaScript fallback PASS');
}finally{await browser.close();}
