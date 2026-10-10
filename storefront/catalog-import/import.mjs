import {readFile, writeFile, mkdir, stat, realpath, rename, rm} from 'node:fs/promises';
import {resolve, dirname, sep, join} from 'node:path';
import {createHash, randomUUID} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {parseCSV, isCatalogActive, normalizePromoCode, treeProducts, decorProducts} from '../../supabase/functions/_shared/product-rules.mjs';
import {validatePromo} from '../../app/public/js/promo-model.js';
import {readFeedText, defaultManifest} from '../products/build-feed.mjs';
import {localAsset} from '../products/presentation.mjs';
export const zone = resolve(import.meta.dirname);
const names = ['trees','decor','promos'];
const columns = {trees:['id','title','category','height_cm','price','diameter_cm','branches','offer','discount_pct','photos','active','description'],decor:['id','title','category','price','variants','photos','active','description'],promos:['promocode','Комментарий','ruble-offer','percent-offer','gift-offer']};
export const checksum = text => createHash('sha256').update(text).digest('hex');
function number(value, field, optional=false) {
  if (optional && value==='') return 0;
  if (!/^\d+(?:[.,]\d+)?$/.test(value)) throw new Error(`Invalid money/number ${field}: ${value}`);
  const n=Number(value.replace(',','.'));
  if (!Number.isFinite(n) || n>Number.MAX_SAFE_INTEGER || Math.abs(n*100-Math.round(n*100))>1e-6) throw new Error(`Invalid money/number ${field}`);
  return n;
}
export function validateCSV(name,text) {
  if(!columns[name] || typeof text!=='string') throw new Error(`Unavailable feed ${name}`);
  const [headers,...cells]=parseCSV(text);
  if(!headers || new Set(headers).size!==headers.length || columns[name].some(k=>!headers.includes(k))) throw new Error(`Invalid ${name} schema`);
  // Reject quote placement that the compatibility parser deliberately tolerates.
  let quoted=false,closed=false,start=true;
  for(let i=0;i<text.length;i++){const c=text[i];if(quoted){if(c==='\"'){if(text[i+1]==='\"')i++;else{quoted=false;closed=true;}}}else if(c===','||c==='\r'||c==='\n'){closed=false;start=true;}else if(c==='\"'){if(!start)throw new Error('Malformed CSV quote');quoted=true;start=false;}else{if(closed)throw new Error('Malformed trailing CSV content');start=false;}}
  const rows=cells.map((values,i)=>{
    if(values.length!==headers.length) throw new Error(`Malformed ${name} row ${i+2}`);
    return Object.fromEntries(headers.map((h,j)=>[h,values[j]]));
  });
  const ids=new Map(), variants=new Set();
  for(const row of rows) {
    if(name==='promos') {
      const code=normalizePromoCode(row.promocode);
      if(!code || variants.has(code)) throw new Error('Duplicate/empty promo code');
      variants.add(code);
      const rub=number(row['ruble-offer'],'promo rub'),pct=number(row['percent-offer'],'promo pct');
      validatePromo({code:row.promocode,comment:row['Комментарий'],rub,pct,gift:!!row['gift-offer']});
      if(pct>=100 || (rub>0 && pct>0) || (!rub && !pct && !/сумк/i.test(row['gift-offer'])) || (row['gift-offer'] && !/сумк/i.test(row['gift-offer']))) throw new Error('Invalid promo benefit');
      continue;
    }
    if(!/^[a-zA-Z0-9_-]{1,80}$/.test(row.id) || !row.title.trim() || (ids.has(row.id) && ids.get(row.id)!==row.title)) throw new Error(`Duplicate incompatible/invalid product ID ${row.id}: ${JSON.stringify([ids.get(row.id),row.title])}`);
    ids.set(row.id,row.title);
    if(!/^(true|false|1|0)$/i.test(row.active)) throw new Error('Invalid active flag');
    const key=name==='trees'?`${row.id}:${row.category}:${row.height_cm}`:`${row.id}:${row.category}:${row.variants==='-'?'':row.variants}`;
    if(variants.has(key)) throw new Error(`Duplicate variant ${key}`);
    variants.add(key);
    const price=number(row.price,'price');
    if(isCatalogActive(row.active) && price<=0) throw new Error('Active price must be positive');
    if(name==='trees') {
      if(!row.category.trim() || number(row.height_cm,'height')<=0) throw new Error('Invalid tree variant');
      for(const k of ['diameter_cm','branches','offer']) number(row[k],k,true);
      if(row.discount_pct && (!/^-?\d+(?:[.,]\d+)?$/.test(row.discount_pct) || Math.abs(Number(row.discount_pct.replace(',','.')))>=100)) throw new Error('Invalid discount');
    }
    for(const photo of row.photos.split('|').map(s=>s.trim()).filter(Boolean)) {
      let path=photo;
      if(/^https?:/.test(photo)) {const u=new URL(photo);if(u.username||u.password||u.search||u.hash) throw new Error('Private/ambiguous photo URL');path=u.pathname;}
      else if(!photo.startsWith('/')) throw new Error('Invalid photo reference');
      if(decodeURIComponent(path).split('/').some(p=>p==='..'||p==='.') || path.includes('\\')) throw new Error('Photo path traversal');
    }
  }
  // Verify acceptance by the storefront's shared parser as well as the full raw-row contract.
  if(name==='trees') treeProducts(rows);
  if(name==='decor') decorProducts(rows);
  return rows;
}
export async function readCandidate(manifestPath) {
  const root=await realpath(dirname(manifestPath)),manifest=JSON.parse(await readFile(manifestPath,'utf8'));
  if(manifest.schemaVersion!==1 || manifest.productionReady!==false) throw new Error('Invalid candidate manifest');
  const feeds={};
  for(const name of names) {
    const entry=manifest.feeds?.[name];
    if(!entry?.path || !entry.source || !Number.isFinite(Date.parse(entry.receivedAt)) || !['available','empty'].includes(entry.status)) throw new Error(`Unavailable feed ${name}`);
    const file=await realpath(resolve(root,entry.path));
    if(!file.startsWith(root+sep)) throw new Error('Feed path traversal');
    const text=await readFile(file,'utf8');
    if(checksum(text)!==entry.sha256) throw new Error('Checksum mismatch');
    const rows=validateCSV(name,text);
    if(rows.length!==entry.records || (rows.length===0)!==(entry.status==='empty')) throw new Error('Record/status mismatch');
    feeds[name]=text;
  }
  return {manifest,feeds};
}
export async function fetchPublic(name,{fetchImpl=fetch,maxBytes=2_000_000,timeout=15000,direct=false}={}) {
  const config=await readFile(resolve(zone,'../../src/catalog/config.js'),'utf8');
  const key={trees:'SHEET_CSV_URL',decor:'DECOR_SHEET_CSV_URL',promos:'PROMO_SHEET_CSV_URL'}[name];
  const storageURL=config.match(new RegExp(`export const ${key} = '([^']+)'`))?.[1];
  if(storageURL!==`https://mgnotvaahftrbifqtahf.supabase.co/storage/v1/object/public/le-catalog-feeds/${name}.csv`) throw new Error('Public feed URL not proven');
  const url=direct ? `https://mgnotvaahftrbifqtahf.supabase.co/functions/v1/catalog/feeds/${name}.csv` : storageURL;
  const response=await fetchImpl(url,{method:'GET',redirect:'error',signal:AbortSignal.timeout(timeout),headers:{Accept:'text/csv','Cache-Control':'no-cache'}});
  if(!response.ok || !response.body || !/^(text\/csv|text\/plain|application\/octet-stream)/i.test(response.headers.get('content-type')||'')) throw new Error(`Unavailable ${name}: HTTP ${response.status}`);
  const reader=response.body.getReader();let bytes=0;const chunks=[];
  try {while(true) {const {done,value}=await reader.read();if(done)break;bytes+=value.length;if(bytes>maxBytes)throw new Error('Response byte limit');chunks.push(Buffer.from(value));}} finally {await reader.cancel();}
  const text=new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks));validateCSV(name,text);
  return {text,source:url,receivedAt:new Date().toISOString(),http:{status:response.status,etag:response.headers.get('etag'),lastModified:response.headers.get('last-modified')},bytes};
}
export async function inventory(rowsByName,assetRoot=resolve(zone,'../public')) {
  const root=await realpath(assetRoot),photos=[];
  for(const name of ['trees','decor']) for(const row of rowsByName[name]) for(const [index,url] of row.photos.split('|').map(s=>s.trim()).filter(Boolean).entries()) {
    const mapped=localAsset(url);let found=false,path=null;
    if(mapped.startsWith('/')&&!mapped.startsWith('//')) {
      const file=resolve(root,decodeURIComponent(mapped).replace(/^\//,''));
      if(!file.startsWith(root+sep)) throw new Error('Asset traversal');
      try {const actual=await realpath(file);found=actual.startsWith(root+sep)&&(await stat(actual)).isFile();if(found)path=actual;}catch{}
    }
    photos.push({feed:name,productId:row.id,variantId:name==='trees'?`${row.id}:${row.category}:${row.height_cm}`:`${row.id}:${row.category}:${row.variants}`,active:isCatalogActive(row.active),index,url,localPath:path,status:found?'present':'missing'});
  }
  return photos;
}
export function reviewDiff(oldRows,newRows,name) {
  const key=r=>name==='trees'?`${r.id}:${r.category}:${r.height_cm}`:`${r.id}:${r.category}:${r.variants==='-'?'':r.variants}`;
  const old=new Map(oldRows.map(r=>[key(r),r])),next=new Map(newRows.map(r=>[key(r),r]));
  return {added:[...next.keys()].filter(k=>!old.has(k)),removed:[...old.keys()].filter(k=>!next.has(k)),changed:[...next].filter(([k])=>old.has(k)).flatMap(([k,r])=>{const fields=Object.keys(r).filter(f=>r[f]!==old.get(k)[f]);return fields.length?[{variantId:k,fields:Object.fromEntries(fields.map(f=>[f,{before:old.get(k)[f],after:r[f]}]))}]:[]})};
}
export async function accept(inputs,{output,assetRoot,beforeCommit}={}) {
  const target=resolve(output||join(zone,'candidates',new Date().toISOString().replace(/[:.]/g,'-')));
  if(!target.startsWith(zone+sep) || target===zone) throw new Error('Output outside catalog import zone');
  await mkdir(dirname(target),{recursive:true});
  if(!(await realpath(dirname(target))).startsWith(zone+sep)) throw new Error('Output parent traversal');
  try {await stat(target);throw new Error('Refusing to overwrite existing artifact');} catch(e) {if(e.code!=='ENOENT')throw e;}
  const rows={},feeds={};
  for(const name of names) {const input=inputs[name];if(!input?.receivedAt || !Number.isFinite(Date.parse(input.receivedAt)) || !input.source)throw new Error(`Unavailable/provenance missing ${name}`);rows[name]=validateCSV(name,input.text);feeds[name]={path:`${name}.csv`,status:rows[name].length?'available':'empty',records:rows[name].length,sha256:checksum(input.text),source:input.source,receivedAt:input.receivedAt,http:input.http||null};}
  const photos=await inventory(rows,assetRoot),diff={};
  const routes=JSON.parse(await readFile(resolve(zone,'../product-routes.json'),'utf8'));
  const routeReview=routes.map(route=>{const feed=route.kind==='tree'?'trees':'decor';const current=rows[feed].filter(r=>r.id===route.id);return {path:route.path,productId:route.id,feed,currentRows:current.length,activeRows:current.filter(r=>isCatalogActive(r.active)).length,savedDescriptionStatus:!route.richTextHtml&&!route.liveDescription?'absent-in-route-metadata-use-feed' :route.liveDescription?.trim()==='Текст'?'placeholder':'saved-unconfirmed'};});
  const knownRoutes=new Set(routes.map(r=>`${r.kind==='tree'?'trees':'decor'}:${r.id}`));
  const productsWithoutRoutes=['trees','decor'].flatMap(feed=>[...new Set(rows[feed].map(r=>r.id))].filter(id=>!knownRoutes.has(`${feed}:${id}`)).map(id=>({feed,productId:id})));
  const savedRoutePhotos=await inventory({trees:routes.filter(r=>r.kind==='tree').map(r=>({id:r.id,category:'saved-route',height_cm:r.path,active:'TRUE',photos:[r.fallbackImage,...Object.values(r.mainImages||{}),...Object.values(r.galleryImages||{})].filter(Boolean).join('|')})),decor:routes.filter(r=>r.kind!=='tree').map(r=>({id:r.id,category:'saved-route',variants:r.path,active:'TRUE',photos:[r.fallbackImage,...Object.values(r.mainImages||{}),...Object.values(r.galleryImages||{})].filter(Boolean).join('|')}))},assetRoot);
  for(const name of ['trees','decor']) {const baselineText=await readFeedText(name,defaultManifest);diff[name]=reviewDiff((() => {const [h,...rs]=parseCSV(baselineText);return rs.map(v=>Object.fromEntries(h.map((k,i)=>[k,v[i]])));})(),rows[name],name);}
  const summary=Object.fromEntries(names.map(name=>[name,{records:rows[name].length,products:name==='promos'?null:new Set(rows[name].map(r=>r.id)).size,activeRows:name==='promos'?null:rows[name].filter(r=>isCatalogActive(r.active)).length}]));
  const descriptionIssues=['trees','decor'].flatMap(name=>rows[name].filter(r=>!r.description.trim()||r.description==='-'||r.description.trim()==='Текст').map(r=>({feed:name,productId:r.id,category:r.category,height:r.height_cm,label:r.variants,description:r.description,active:isCatalogActive(r.active)})));
  const report={summary,diff,photos,savedRoutePhotos,routeReview,productsWithoutRoutes,photoSummary:{references:photos.length,presentReferences:photos.filter(p=>p.status==='present').length,uniqueURLs:new Set(photos.map(p=>p.url)).size,missingUniqueURLs:[...new Set(photos.filter(p=>p.status==='missing').map(p=>p.url))],savedRouteMissing:savedRoutePhotos.filter(p=>p.status==='missing')},descriptionIssues,missingPhotos:photos.filter(p=>p.status==='missing').length,merchantFreshness:'unknown',pricesBusinessConfirmed:false,promoScope:'Published enabled codes only; no disabled records or owner validity confirmation',baseline:defaultManifest};
  const manifest={schemaVersion:1,id:target.split(sep).at(-1),snapshotDate:new Date().toISOString().slice(0,10),artifactGeneratedAt:new Date().toISOString(),dataAsOf:null,freshness:'unknown',productionReady:false,source:{kind:'public-read-only-catalog-export'},assetCoverage:'inventory-only-no-download',feeds,limitations:['Retrieval time does not establish merchant freshness or price provenance','Not activated; raw inactive variants retained','Media and descriptions require owner review']};
  const temp=join(dirname(target),`.pending-${randomUUID()}`);await mkdir(temp);
  try {for(const name of names)await writeFile(join(temp,`${name}.csv`),inputs[name].text,{flag:'wx'});await writeFile(join(temp,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');await writeFile(join(temp,'review.json'),JSON.stringify(report,null,2)+'\n');await readCandidate(join(temp,'manifest.json'));await beforeCommit?.();await rename(temp,target);}finally {await rm(temp,{recursive:true,force:true});}
  return {target,report};
}
if(process.argv[1] && import.meta.url===pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const mode=process.argv[2];
    if(mode==='fetch') {const inputs={};for(const name of names) inputs[name]=await fetchPublic(name);const result=await accept(inputs);console.log(JSON.stringify({target:result.target,summary:result.report.summary,missingPhotos:result.report.missingPhotos}));}
    else if(mode==='check') {const result=await readCandidate(resolve(process.argv[3]));console.log(JSON.stringify(result.manifest.feeds));}
    else if(mode==='import') {const source=await readCandidate(resolve(process.argv[3]));const inputs=Object.fromEntries(names.map(name=>[name,{text:source.feeds[name],...source.manifest.feeds[name]}]));console.log((await accept(inputs,{output:process.argv[4]})).target);}
    else throw new Error('Usage: node import.mjs fetch | check manifest.json | import manifest.json [new-output]');
  }catch(error) {console.error(error.message);process.exitCode=1;}
}
