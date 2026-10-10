import {readFile,writeFile,appendFile,cp} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {fetchInputs} from '../catalog-sync.mjs';
import {feedsDigest,readFeedsOf} from './snapshot.mjs';
import {readPointer} from '../../storefront/products/snapshot-acceptance.mjs';
import {recoverPending} from './git-timeweb.mjs';
import {notify,formatMessage} from './notify.mjs';
const mode=process.argv[2];
if(mode==='check'){
 const inputs=await fetchInputs(), baseline=await readFeedsOf(readPointer().manifestPath);
 const digest=feedsDigest(Object.fromEntries(Object.entries(inputs).map(([n,v])=>[n,{sha256:createHash('sha256').update(v.text).digest('hex')}])))
 const changed=digest!==feedsDigest(baseline.manifest.feeds);
 console.log(changed?'changed':'unchanged');
 if(process.env.GITHUB_OUTPUT)await appendFile(process.env.GITHUB_OUTPUT,`changed=${changed}\n`);
}else if(mode==='recover'){
 if(process.env.LE_DRY_RUN!=='true')await recoverPending();
}else if(mode==='previous'){
 // Metadata is kept outside /site. The build needs it to retain only one previous generation.
 try{await cp('catalog-state/immutable-manifest.json','site/immutable-manifest.json');}catch(e){if(e.code!=='ENOENT')throw e;}
}else if(mode==='alert'){
 const url=`https://github.com/arturablyazov5-glitch/lady-elka-cloud-preview/actions/runs/${process.env.GITHUB_RUN_ID}`;
 const r=await notify(formatMessage({title:'Каталог: CI завершился ошибкой',lines:['Активный снимок не переключён.',url]}));
 if(!r.sent)throw Error('Private Telegram alert failed');
}else throw Error('Unknown CI mode');
