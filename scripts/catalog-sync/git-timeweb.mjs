import {readFile,writeFile,mkdir,rm,copyFile,readdir} from 'node:fs/promises';
import {resolve,join,dirname} from 'node:path';
import {execFileSync} from 'node:child_process';
import {mirrorDir} from './publish.mjs';
import {writePointer} from './snapshot.mjs';
import {activateBlog} from '../../storefront/blog/sync.mjs';
const ROOT=resolve(import.meta.dirname,'../..'), REPO='arturablyazov5-glitch/lady-elka-cloud-preview';
const STATE=join(ROOT,'catalog-state'), PENDING=join(STATE,'pending.json');
const OMIT=new Set(['build-manifest.json','audit','nginx.conf.example','.htaccess','catalog-snapshot.json','immutable-manifest.json','request-assets.json']);
const git=(args)=>execFileSync('git',args,{cwd:ROOT,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
export const publishable=path=>!path.split('/').some(p=>OMIT.has(p)||p==='.DS_Store');
export async function copySite(dist,target=join(ROOT,'site')) {
 // mirror a filtered staging directory outside Git; remove only files absent in the new build.
 const {mkdtemp}=await import('node:fs/promises');const filtered=await mkdtemp('/tmp/le-site-');
 try{for(const path of await readdir(dist,{recursive:true})) {
  if(!publishable(path))continue; const file=join(dist,path);
  const {stat}=await import('node:fs/promises');if(!(await stat(file)).isFile())continue;
  await mkdir(dirname(join(filtered,path)),{recursive:true});await copyFile(file,join(filtered,path));
 }
 for(const file of ['sw.js','sw-kill.js','index.html','sitemap.xml'])await readFile(join(filtered,file));
 return await mirrorDir(filtered,target,{removeStale:true});
 }finally{await rm(filtered,{recursive:true,force:true});}
}
function assertRepo(){
 const remote=git(['remote','get-url','origin']);
 if(!remote.includes(REPO)||git(['branch','--show-current'])!=='main')throw Error('Preview main only');
}
async function commitPush(paths,title){
 assertRepo();git(['config','user.name','lady-elka-catalog[bot]']);git(['config','user.email','41898282+github-actions[bot]@users.noreply.github.com']);
 git(['add','--',...paths]);
 // Scan both index and history before each publication; never print matched values.
 execFileSync(process.execPath,['scripts/catalog-sync/scan.mjs'],{cwd:ROOT,stdio:'inherit'});
 if(git(['diff','--cached','--name-only']))git(['commit','-m',title]);
 const expectedSite=git(['rev-parse','HEAD:site']);
 for(let n=0;n<3;n++){
  try{git(['pull','--rebase','origin','main']);if(git(['rev-parse','HEAD:site'])!==expectedSite)throw Error('Site changed during rebase; refusing mixed release');execFileSync(process.execPath,['scripts/catalog-sync/scan.mjs'],{cwd:ROOT,stdio:'inherit'});git(['push','origin','HEAD:main']);return git(['rev-parse','HEAD']);}
  catch{if(n===2)throw Error('Non-force push failed after three attempts');await sleep(2000*(n+1));}
 }
}
export async function api(path,{env=process.env,method='GET',body,fetchImpl=fetch}={}){
 if(!env.TIMEWEB_API_TOKEN)throw Error('TIMEWEB_API_TOKEN required');
 const r=await fetchImpl('https://api.timeweb.cloud/api/v1/apps/266305'+path,{method,headers:{Authorization:`Bearer ${env.TIMEWEB_API_TOKEN}`,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(30000)});
 if(!r.ok)throw Error(`Timeweb HTTP ${r.status}`);return r.json();
}
export async function waitActive(sha,id,{env=process.env,apiImpl=api,pause=sleep,timeout=15*60*1000,now=Date.now}={}){
 const until=now()+timeout;
 while(now()<until){
  const [{app},{deploys}]=await Promise.all([apiImpl('',{env}),apiImpl('/deploys',{env})]);
  const d=deploys.find(d=>d.id===id);
  if(d&&['failure','error','failed','cancelled','canceled','stopped','access_error'].includes(d.status))throw Error('Timeweb deployment failed');
  if(app.status==='active'&&app.commit_sha===sha&&d?.status==='success')return {commit:sha,deploy:id};
  if(['failure','startup_error','no_paid','paused'].includes(app.status))throw Error('Timeweb app unavailable');
  await pause(15000);
 }
 throw Error('Timeweb timeout after 15 minutes; no restart attempted. Pending deployment requires inspection');
}
export async function smoke({fetchImpl=fetch,site=join(ROOT,'site'),base='https://arturablyazov5-glitch-lady-elka-cloud-preview-3626.twc1.net'}={}){
 for(const [url,file,status] of [['/','index.html',200],['/catalog/','catalog/index.html',200],['/sw.js','sw.js',200],['/zzz-check','404.html',404],['/sitemap.xml','sitemap.xml',200]]) {
  const r=await fetchImpl(base+url,{redirect:'error',signal:AbortSignal.timeout(30000),headers:{'Cache-Control':'no-cache'}});
  if(r.status!==status)throw Error(`Smoke ${url}: HTTP ${r.status}`);
  const bytes=Buffer.from(await r.arrayBuffer()),expected=await readFile(join(site,file));
  if(!bytes.equals(expected))throw Error(`Smoke ${url}: content mismatch`);
 }
 console.log('Smoke PASS: /, /catalog/, /sw.js, /zzz-check=404, sitemap (exact bytes)');
}
async function finish(pending){
 if(pending.pointer)await writePointer(join(ROOT,'storefront/catalog-snapshots/active.json'),pending.pointer);
 if(pending.blog)await activateBlog(join(STATE,'blog-candidate.json'));
 await rm(PENDING,{force:true});await rm(join(STATE,'blog-candidate.json'),{force:true});
 return commitPush(['catalog-state','storefront/catalog-snapshots/active.json','storefront/blog'],'catalog: acknowledge successful Timeweb deployment');
}
export async function recoverPending({env=process.env}={}){
 let p;try{p=JSON.parse(await readFile(PENDING));}catch(e){if(e.code==='ENOENT')return false;throw e;}
 const sha=git(['log','-1','--format=%H','--','catalog-state/pending.json']);
 const [{app},{deploys}]=await Promise.all([api('',{env}),api('/deploys',{env})]);
 if(app.status!=='active'||app.commit_sha!==sha||!deploys.some(d=>d.commit_sha===sha&&d.status==='success'))throw Error('Unacknowledged deployment: inspect Timeweb and pending.json; automatic redeploy refused');
 await smoke();await finish(p);console.log('Recovered already successful deployment');return true;
}
export async function publishGitTimeweb(dist,{env=process.env,signal,pointer,blogSnapshot,planOnly=false}={}){
 if(planOnly)return {method:'git-timeweb',repo:REPO,app:266305,steps:['filtered /site mirror','non-force bot commit/push','one deploy POST','wait active + matching commit + success (15 min)','exact-byte smoke','active snapshot acknowledgement']};
 assertRepo();await mkdir(STATE,{recursive:true});
 try{await readFile(PENDING);throw Error('Pending deployment must be reconciled first');}catch(e){if(e.code!=='ENOENT')throw e;}
 await copySite(dist);
 await copyFile(join(dist,'immutable-manifest.json'),join(STATE,'immutable-manifest.json'));
 const pending={pointer:pointer?Object.fromEntries(Object.entries(pointer).filter(([k])=>!['path','manifestPath','mediaPath'].includes(k))):null,blog:!!blogSnapshot};
 if(blogSnapshot)await copyFile(blogSnapshot,join(STATE,'blog-candidate.json'));
 await writeFile(PENDING,JSON.stringify(pending,null,2)+'\n');
 const sha=await commitPush(['site','catalog-state','storefront/catalog-snapshots'],'catalog: stage guarded static release for Timeweb');
 // This POST is never retried: an ambiguous network failure leaves pending state for inspection.
 const {deploy}=await api('/deploy',{env,method:'POST',body:{commit_sha:sha}});
 if(!deploy?.id)throw Error('Timeweb returned no deployment id');
 console.log(`Timeweb deploy ${deploy.id} for ${sha}`);
 await waitActive(sha,deploy.id,{env});await smoke();await finish(pending);
 return {method:'git-timeweb',commit:sha,deploy:deploy.id};
}
