// Scan tracked tree/index and new commit history; report filenames/counts, never matching values.
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
const git=args=>execFileSync('git',args,{maxBuffer:200*1024**2});
const names=git(['ls-files','-z']).toString().split('\0').filter(Boolean);
const deny=/(^|\/)(?:\.env[^/]*|[^/]*\.ini|agent-context|integration-qa|node_modules|audit)(\/|$)|\.(pem|key)$/i;
const patterns=[/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,/\bgh[pousr]_[A-Za-z0-9]{30,}\b/,/\bgithub_pat_[A-Za-z0-9_]{50,}\b/,/\b\d{7,12}:[A-Za-z0-9_-]{30,}\b/,/\beyJ[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{15,}\b/];
const failures=[];
const sizes=git(['ls-files','--stage']).toString().trim().split('\n').filter(Boolean).map(l=>l.split(/\s+/)[1]);
const metadata=execFileSync('git',['cat-file','--batch-check=%(objectname) %(objectsize)'],{input:sizes.join('\n')+'\n'}).toString().trim().split('\n');
for(const m of metadata)if(Number(m.split(' ')[1])>95*1024**2)failures.push('tracked blob exceeds 95 MB budget');
const textFile=name=>/\.(?:m?js|cjs|html|css|csv|json|ya?ml|md|txt|xml|conf|sql|toml|py)$/.test(name)||name==='.gitignore';
for(const name of names){
 if(deny.test(name)){failures.push(name+': forbidden path');continue;}
 if(!textFile(name))continue;
 const b=git(['show',':'+name]);if(b.length>95*1024**2)failures.push(name+': exceeds blob budget');
 if(b.includes(0))continue;
 const s=b.toString();if(patterns.some(p=>p.test(s)))failures.push(name+': credential pattern');
}
// Inspect all newly introduced blobs, including values subsequently removed in the same series.
const base=process.env.LE_SCAN_BASE || 'origin/main';
const objects=git(['rev-list','--objects',`${base}..HEAD`]).toString().trim().split('\n').filter(Boolean);
for(const line of objects){const [oid,...path]=line.split(' ');if(!textFile(path.join(' ')))continue;if(git(['cat-file','-t',oid]).toString().trim()!=='blob')continue;const b=git(['cat-file','blob',oid]);if(!b.includes(0)&&patterns.some(p=>p.test(b.toString())))failures.push('new history blob: credential pattern');}
if(failures.length){console.error('Secret/size scan blocked:',[...new Set(failures)].join('\n'));process.exit(1);}
console.log(`Secret/path/size scan PASS: ${names.length} tracked files; ${objects.length} new history objects`);
