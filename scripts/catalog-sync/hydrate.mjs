// Restore captured binary build inputs from immutable Git blobs; verify SHA256.
// No extra copy of the already published media is committed to source directories.
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {dirname,resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
const root=resolve(import.meta.dirname,'../..');
const entries=JSON.parse(await readFile(resolve(root,'storefront/build-inputs/assets.json')));
for(const a of entries) {
 const file=resolve(root,a.path);if(!file.startsWith(root+'/'))throw Error('Asset path escapes root');
 let b;try{b=await readFile(file);if(createHash('sha256').update(b).digest('hex')===a.sha256)continue;}catch(e){if(e.code!=='ENOENT')throw e;}
 if(!/^[a-f0-9]{40}$/.test(a.blob))throw Error('Invalid Git blob');
 b=execFileSync('git',['cat-file','blob',a.blob],{cwd:root,maxBuffer:100*1024**2});
 if(b.length!==a.bytes||createHash('sha256').update(b).digest('hex')!==a.sha256)throw Error('Build input checksum mismatch');
 await mkdir(dirname(file),{recursive:true});await writeFile(file,b);
}
console.log(`Hydrated ${entries.length} SHA256-verified build inputs`);
// Every newly acknowledged catalog can bootstrap from its published pinned media,
// even after cache eviction on a fresh runner.
const pointer=JSON.parse(await readFile(resolve(root,'storefront/catalog-snapshots/active.json')));
const media=JSON.parse(await readFile(resolve(root,pointer.media)));
for(const a of media.assets){
 const file=resolve(root,a.localPath);if(!file.startsWith(root+'/'))throw Error('Pinned media path escapes root');
 const verify=b=>b.length===a.bytes&&createHash('sha256').update(b).digest('hex')===a.sha256;
 try{if(verify(await readFile(file)))continue;}catch(e){if(e.code!=='ENOENT')throw e;}
 const ext=a.localPath.slice(a.localPath.lastIndexOf('.'));
 const b=await readFile(resolve(root,`site/media/catalog-pinned/${a.sha256}${ext}`));
 if(!verify(b))throw Error('Published media checksum mismatch');
 await mkdir(dirname(file),{recursive:true});await writeFile(file,b);
}

// Blog cover snapshot is also reproducible from the successful published site.
try {
 const blog=JSON.parse(await readFile(resolve(root,'storefront/blog/snapshot.json')));
 for(const a of Object.values(blog.assets)) {
  const file=resolve(root,'storefront/public',a.url.replace(/^\//,''));
  if(!file.startsWith(resolve(root,'storefront/public')+'/'))throw Error('Blog path escapes root');
  let b;try{b=await readFile(file);if(createHash('sha256').update(b).digest('hex')===a.sha256)continue;}catch(e){if(e.code!=='ENOENT')throw e;}
  b=await readFile(resolve(root,'site',a.url.replace(/^\//,'')));
  if(createHash('sha256').update(b).digest('hex')!==a.sha256)throw Error('Blog cover checksum mismatch');
  await mkdir(dirname(file),{recursive:true});await writeFile(file,b);
 }
}catch(e){if(e.code!=='ENOENT')throw e;}
