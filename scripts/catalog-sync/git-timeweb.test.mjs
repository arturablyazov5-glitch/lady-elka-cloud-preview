import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';import {join} from 'node:path';
import {publish} from './publish.mjs';import {copySite,waitActive,smoke,publishable} from './git-timeweb.mjs';
import {telegramTarget} from './notify.mjs';import {checkCatalog} from './guards.mjs';
import {readFeedsOf} from './snapshot.mjs';import {readPointer} from '../../storefront/products/snapshot-acceptance.mjs';
import {csvRecords} from '../../supabase/functions/_shared/product-rules.mjs';
test('git-timeweb adapter plan is preview only with one deploy and acknowledgement after smoke',async()=>{
 const p=await publish('/tmp/dist',{method:'git-timeweb',planOnly:true});assert.equal(p.app,266305);assert.match(p.repo,/cloud-preview$/);assert.match(p.steps.at(-1),/acknowledgement/);
});
test('filtered mirror deletes stale files and preserves both SW scripts',async()=>{
 const w=await mkdtemp('/tmp/le-copy-test-');try{
  const d=join(w,'dist'),s=join(w,'site');await mkdir(d);await mkdir(s);await writeFile(join(s,'old.html'),'stale');
  for(const n of ['sw.js','sw-kill.js','index.html','sitemap.xml','build-manifest.json','.htaccess','request-assets.json'])await writeFile(join(d,n),n);
  await mkdir(join(d,'audit'));await writeFile(join(d,'audit/evidence.json'),'{}');
  await copySite(d,s);assert.equal(await readFile(join(s,'sw.js'),'utf8'),'sw.js');assert.equal(await readFile(join(s,'sw-kill.js'),'utf8'),'sw-kill.js');
  for(const n of ['old.html','build-manifest.json','.htaccess','request-assets.json','audit/evidence.json'])await assert.rejects(readFile(join(s,n)),{code:'ENOENT'});
 }finally{await rm(w,{recursive:true,force:true});}
});
test('active on old commit is never success; timeout does not restart deploy',async()=>{
 let time=0,calls=0;
 await assert.rejects(waitActive('new','id',{now:()=>time,timeout:30,pause:async()=>{time+=15},apiImpl:async path=>{calls++;return path?{deploys:[{id:'id',status:'success'}]}:{app:{status:'active',commit_sha:'old'}}}}),/timeout/);assert.equal(calls,4);
 const r=await waitActive('new','id',{apiImpl:async path=>path?{deploys:[{id:'id',status:'success'}]}:{app:{status:'active',commit_sha:'new'}}});assert.equal(r.commit,'new');
 await assert.rejects(waitActive('new','id',{apiImpl:async path=>path?{deploys:[{id:'id',status:'failure'}]}:{app:{status:'active',commit_sha:'old'}}}),/failed/);
});
test('private Telegram only',()=>{assert.equal(telegramTarget({TG_BOT_TOKEN:'fixture',LE_SYNC_TG_CHAT_ID:'-100123'}).ok,false);assert.equal(telegramTarget({TG_BOT_TOKEN:'fixture',LE_SYNC_TG_CHAT_ID:'123456'}).ok,true)});
test('mock price change passes; empty price/photo, >50% jump and product drop block',async()=>{
 const {feeds}=await readFeedsOf(readPointer().manifestPath);const rows=csvRecords(feeds.trees),headers=Object.keys(rows[0]);
 const encode=rs=>[headers,...rs.map(r=>headers.map(h=>r[h]))].map(r=>r.map(v=>'"'+String(v).replaceAll('"','""')+'"').join(',')).join('\n');
 const active=rows.findIndex(r=>r.active==='TRUE');assert.ok(active>=0);
 const edit=fn=>{const copy=structuredClone(rows);fn(copy);return {...feeds,trees:encode(copy)}};
 assert.equal(checkCatalog({prev:feeds,next:edit(r=>r[active].price=String(Math.round(Number(r[active].price)*1.01)))}).passed,true);
 for(const next of [edit(r=>r[active].price=''),edit(r=>r[active].photos=''),edit(r=>r[active].price=String(Number(r[active].price)*2)),edit(r=>r.splice(0,170))])assert.equal(checkCatalog({prev:feeds,next}).passed,false);
});
