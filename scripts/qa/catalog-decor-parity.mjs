#!/usr/bin/env node
// Read-only comparison: every catalog card by route/id/title, all decor pages and variants.
import { createRequire } from 'node:module';
import { readFile, writeFile, mkdir, readdir, access } from 'node:fs/promises';
import assert from 'node:assert/strict';
import {homedir} from 'node:os';
import {join} from 'node:path';
let playwrightPackage=process.env.PLAYWRIGHT_PACKAGE_JSON;
if(!playwrightPackage)for(const cache of await readdir(join(homedir(),'.npm/_npx'))){const candidate=join(homedir(),'.npm/_npx',cache,'node_modules/playwright/package.json');try{await access(candidate);playwrightPackage=candidate;break;}catch{}}
if(!playwrightPackage)throw Error('Set PLAYWRIGHT_PACKAGE_JSON to installed Playwright package.json');
const require=createRequire(playwrightPackage);
const {chromium}=require('playwright');
const base=process.env.LOCAL_BASE_URL||'http://localhost:4174';
const phase=process.env.PARITY_PHASE||'after';
const output='agent-context/catalog-decor-parity';
const routes=JSON.parse(await readFile('storefront/product-routes.json'));
const {csvRecords}=await import('../../supabase/functions/_shared/product-rules.mjs');
const feeds={};for(const kind of ['trees','decor']){feeds[kind]=csvRecords(await readFile(`${output}/live-${kind}.csv`,'utf8'));}
const map=await (await fetch(base+'/media/catalog-pinned/map.json')).json();
const reverse=Object.fromEntries(Object.entries(map).map(([raw,pinned])=>[pinned,raw]));
const browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
const report={phase,checkedAt:new Date().toISOString(),catalog:[],decor:[]};
const norm=s=>String(s||'').toLowerCase().replaceAll('ё','е').replace(/\s+/g,' ').trim();
async function visit(page,url){
 for(let attempt=0;attempt<3;attempt++){
  let response;try{response=await page.goto(url,{waitUntil:'domcontentloaded',timeout:25000});}catch(error){if(attempt<2)continue;throw error;}assert.equal(response.status(),200,url);
  await page.waitForTimeout(3500);
  if(url==='https://lady-elka.ru/catalog'){
   try{await page.waitForFunction(()=>document.querySelector('.product-card[data-photos-ready]'),{},{timeout:12000});}
   catch(error){if(attempt<2)continue;throw error;}
  }
  return;
 }
}
async function cards(page){return page.evaluate(async()=>{for(let y=0;y<document.documentElement.scrollHeight;y+=800){scrollTo(0,y);await new Promise(r=>setTimeout(r,25));}scrollTo(0,0);return [...document.querySelectorAll('.product-card')].filter(c=>c.getBoundingClientRect().height>0).map(c=>{const visible=i=>i.getBoundingClientRect().width>30&&i.getBoundingClientRect().height>30;const image=[...c.querySelectorAll('.product__img img')].find(visible);return {id:c.dataset.storefrontProduct||c.querySelector('[data-product-id]')?.textContent.trim(),title:c.querySelector('[data-prop-title]')?.textContent.trim(),path:c.querySelector('a.stroke-catalog__button')?.getAttribute('href'),category:c.querySelector('[data-prop-category],[data-storefront-category-label]')?.textContent.trim(),image:image?.dataset.fullSrc||image?.dataset.originSrc||image?.src};});});}
async function decor(page){return page.evaluate(()=>{const root=document.querySelector('.product-wrapper__cms');const desc=root.querySelector('[data-prop-description]');return {title:root.querySelector('h1,[data-prop-title]')?.textContent.trim(),description:desc?.textContent.trim(),descriptionVisible:!!desc?.getBoundingClientRect().height,properties:root.querySelector('.tt-rich-text')?.innerText.trim(),material:root.querySelector('.text-emoji__billet')?.innerText.trim(),materialVisible:!!root.querySelector('.text-emoji__billet')?.getBoundingClientRect().height,price:root.querySelector('[data-price-decor]')?.textContent.trim(),text:root.innerText,controls:[...root.querySelectorAll('[data-storefront-option]')].map(s=>({key:s.dataset.storefrontOption,visible:s.closest('[data-storefront-select]').getBoundingClientRect().height>0,options:[...s.options].map(o=>o.value)})),overflow:document.documentElement.scrollWidth>innerWidth};});}
try{
 for(const width of [390,1280]){
  const live=await browser.newPage({viewport:{width,height:900}}),local=await browser.newPage({viewport:{width,height:900}});
  // Suppress analytics/ads only; all site JS, feeds, fonts and product media remain real.
  await live.route(/https:\/\/(?:mc\.yandex\.ru|counter\.megagroup\.ru|yandex\.ru\/ads|smartcaptcha\.yandexcloud\.net)\//,request=>request.abort());
  await visit(live,'https://lady-elka.ru/catalog');await visit(local,base+'/catalog');
  const a=await cards(live),b=await cards(local);
  for(const card of a){const match=b.find(c=>c.id===card.id||c.path===card.path||norm(c.title)===norm(card.title));assert.ok(match,card.title);const raw=reverse[match.image]||match.image;const rows=feeds.trees.filter(r=>r.id===card.id);const allPhotos=[...new Set(rows.flatMap(r=>r.photos.split('|').map(p=>p.trim())))];const liveURL=new URL(card.image,'https://lady-elka.ru');const inFeed=allPhotos.includes(liveURL.href);report.catalog.push({width,id:card.id,title:card.title,path:card.path,original:liveURL.href,local:match.image,localRaw:raw,originalURLInFeed:inFeed,originalFilenameInFeed:allPhotos.some(p=>new URL(p).pathname.split('/').at(-1)===liveURL.pathname.split('/').at(-1)),localIsFeedFirst:rows.some(r=>r.photos.split('|')[0].trim()===raw),verdict:inFeed?(liveURL.href===raw?'match':'mismatch'):'original-template-photo-absent-from-feed'});if(phase==='after')assert.ok(rows.some(r=>r.photos.split('|')[0].trim()===raw),card.title+' must preserve feed first photo');}
  for(const extra of b.filter(c=>!a.some(old=>old.id===c.id||old.path===c.path||norm(old.title)===norm(c.title)))){
   const raw=reverse[extra.image]||extra.image;const rows=feeds.trees.filter(r=>r.id===extra.id);
   if(phase==='after')assert.ok(rows.some(r=>r.photos.split('|')[0].trim()===raw),extra.title+' new product feed photo');
   (report.localOnly ||= []).push({width,...extra,raw,reason:'active feed product absent from original template'});
  }
  await local.screenshot({path:`${output}/catalog-${width}-${phase}.png`,fullPage:false});
  for(const route of routes.filter(r=>r.kind==='decor')){
   await visit(live,'https://lady-elka.ru'+route.path);await visit(local,base+route.path);
   const old=await decor(live),now=await decor(local);
   const row={width,id:route.id,path:route.path,original:old,local:now,variants:[]};
   if(phase==='after'){
    assert.equal(norm(now.title),norm(feeds.decor.find(r=>r.id===route.id).title));assert.equal(now.properties,old.properties,route.path+' properties');assert.equal(now.material,old.material,route.path+' material');assert.equal(norm(now.description),norm(old.description),route.path+' description');if(old.material)assert.ok(now.materialVisible,route.path+' material hidden');assert.ok(!now.overflow,route.path+' overflow');assert.ok(now.controls.every(c=>c.visible),route.path+' controls hidden');
    for(const variant of feeds.decor.filter(r=>r.id===route.id)){
     if(now.controls.some(c=>c.key==='category'))await local.selectOption('[data-storefront-option="category"]',variant.category);
     if(now.controls.some(c=>c.key==='size'))await local.selectOption('[data-storefront-option="size"]',variant.variants.match(/\d+[хxХX]\d+[хxХX]\d+/)?.[0].replace(/[xХX]/g,'х')||variant.variants);
     const state=await decor(local);assert.equal(Number(state.price.replace(/\D/g,'')),Number(variant.price));row.variants.push({category:variant.category,size:variant.variants,price:state.price});
    }
   }
   if(phase==='after' && now.controls.length){
    await local.locator('.product-wrapper__cms .storefront-select-trigger').first().click();
    assert.ok(await local.locator('.storefront-select-menu:not([hidden])').count(),route.path+' dropdown');
    await local.keyboard.press('Escape');
    const first=feeds.decor.find(r=>r.id===route.id);
    if(now.controls.some(c=>c.key==='category'))await local.selectOption('[data-storefront-option="category"]',first.category);
    if(now.controls.some(c=>c.key==='size'))await local.selectOption('[data-storefront-option="size"]',first.variants.match(/\d+[хxХX]\d+[хxХX]\d+/)?.[0].replace(/[xХX]/g,'х')||first.variants);
    row.dropdownOpened=true;
   }
   report.decor.push(row);
   await local.evaluate(()=>document.activeElement?.blur());
   if(route.id==='5d')await local.screenshot({path:`${output}/wreath-${width}-${phase}.png`,fullPage:false});
  }
  await live.close();await local.close();
 }
}finally{await browser.close();await mkdir(output,{recursive:true});await writeFile(`${output}/${phase}-checks.json`,JSON.stringify(report,null,2)+'\n');}
console.log(JSON.stringify({phase,catalog:report.catalog.length,decor:report.decor.length,missingOriginalPhotos:report.catalog.filter(c=>!c.originalURLInFeed).length}));
