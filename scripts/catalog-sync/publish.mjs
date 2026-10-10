// Publication adapters for the built static site. Chosen by --publish / LE_DEPLOY_METHOD.
//   none     — build only (default; nothing leaves the machine)
//   dir      — local immutable release + symlink switch (LE_DEPLOY_DIR)
//   rsync    — rsync over SSH to the hosting document root (LE_DEPLOY_RSYNC_TARGET=user@host:/path, LE_DEPLOY_SSH_KEY=file)
//   command  — reviewed atomic version uploader (LE_DEPLOY_COMMAND, gets LE_DIST env)
// dir/rsync publish immutable releases and atomically swap a document-root symlink. The last 5 releases are retained (minimum 2).
import { spawn } from 'node:child_process';
import { readdir, mkdir, copyFile, rename, stat, lstat, readFile, rm, symlink, realpath, link } from 'node:fs/promises';
import { join, relative, dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { constants } from 'node:fs';

function run(command, args, options = {}) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'inherit', 'inherit'], ...options });
    child.on('error', reject);
    child.on('exit', code => code === 0 ? resolvePromise() : reject(new Error(`${command} exited with ${code}`)));
  });
}

async function* files(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) yield* files(path); else if (entry.isFile()) yield path;
  }
}

// Copy-on-write mirror where supported; source edits cannot mutate a published release.
export async function mirrorDir(source, target, { removeStale = false, previous } = {}) {
  let linked = 0, unchanged = 0, removed = 0;
  const seen = new Set();
  for await (const file of files(source)) {
    const rel = relative(source, file), dest = join(target, rel);
    seen.add(rel);
    try {
      const [a, b] = await Promise.all([stat(file), stat(dest)]);
      if (a.ino === b.ino || (a.size === b.size && (await readFile(file)).equals(await readFile(dest)))) { unchanged++; continue; }
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
    await mkdir(dirname(dest), { recursive: true });
    const temp = join(dirname(dest), `.publish-${randomUUID()}`);
    let reused=false;
    if(previous) {try{const old=join(previous,rel);if((await readFile(file)).equals(await readFile(old))){await link(old,temp);reused=true;unchanged++;}}catch(e){if(!['ENOENT','EXDEV'].includes(e.code))throw e;}}
    if(!reused)await copyFile(file, temp, constants.COPYFILE_FICLONE);
    await rename(temp, dest);
    linked++;
  }
  if (removeStale) for await (const file of files(target)) if (!seen.has(relative(target, file))) { await rm(file); removed++; }
  return { linked, unchanged, removed };
}

export async function publish(dist, { method = process.env.LE_DEPLOY_METHOD || 'none', env = process.env, log = console.log, planOnly = false, runImpl = run, signal, pointer, blogSnapshot } = {}) {
  const execute=(command,args,options={})=>runImpl(command,args,{...options,signal});
  const keep=Number(env.LE_DEPLOY_KEEP_RELEASES || 5);
  if(!Number.isInteger(keep)||keep<2||keep>100)throw new Error('Release retention must be 2..100');
  if (method === 'git-timeweb') {
    const {publishGitTimeweb} = await import('./git-timeweb.mjs');
    return publishGitTimeweb(dist, {env, signal, pointer, blogSnapshot, planOnly});
  }
  if (method === 'none') return { method, skipped: true };
  if (method === 'dir') {
    if (!env.LE_DEPLOY_DIR) throw new Error('LE_DEPLOY_DIR is required');
    const target = env.LE_DEPLOY_DIR;
    if(planOnly)return {method,source:dist,target,keep,steps:['deduplicate against current release','atomic symlink switch','prune old managed releases after switch']};
    try { if (!(await lstat(target)).isSymbolicLink()) throw new Error('Atomic deployment root must be absent or a symlink'); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    const releases = `${target}.releases`, release = join(releases, randomUUID());
    await mkdir(release, { recursive: true });
    let previous;try{previous=await realpath(target);}catch(e){if(e.code!=='ENOENT')throw e;}
    let result;try{result = await mirrorDir(dist, release,{previous});}catch(e){await rm(release,{recursive:true,force:true});throw e;}
    const temp = `${target}.publish-${randomUUID()}`;
    try { await symlink(relative(dirname(target), release), temp); await rename(temp, target); }
    finally { await rm(temp, {force: true}); }
    const old=(await readdir(releases)).filter(n=>/^[a-f0-9-]{36}$/.test(n));
    const ordered=await Promise.all(old.map(async n=>({path:join(releases,n),time:(await stat(join(releases,n))).mtimeMs})));
    ordered.sort((a,b)=>b.time-a.time);
    const retained=new Set([release,...ordered.filter(r=>r.path!==release).slice(0,keep-1).map(r=>r.path)]);
    for(const entry of ordered)if(!retained.has(entry.path))await rm(entry.path,{recursive:true,force:true});
    return { method, release, ...result };
  }
  if (method === 'rsync') {
    const target = env.LE_DEPLOY_RSYNC_TARGET;
    const match = /^([\w.-]+@[\w.-]+):(\/[\w./-]+)$/.exec(target || '');
    if (!match || match[2] === '/' || match[2].includes('..')) throw new Error('Invalid rsync target');
    const [, host, root] = match, release = `${root}.releases/${randomUUID()}`, temp = `${root}.next-${randomUUID()}`;
    const sshArgs = ['-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes'];
    if (env.LE_DEPLOY_SSH_PORT) { if (!/^\d+$/.test(env.LE_DEPLOY_SSH_PORT)) throw new Error('Invalid SSH port'); sshArgs.push('-p', env.LE_DEPLOY_SSH_PORT); }
    if (env.LE_DEPLOY_SSH_KEY) { if (!/^[\w./-]+$/.test(env.LE_DEPLOY_SSH_KEY)) throw new Error('Invalid SSH key path'); sshArgs.push('-i', env.LE_DEPLOY_SSH_KEY); }
    // Reviewed plan: immutable release, byte comparison/hardlinks, switch, then bounded retention.
    const commands=[
      ['ssh',[...sshArgs,host,`test -L '${root}' && mkdir -p '${release}'`]],
      ['rsync',['-rlz','--checksum',`--link-dest=${root}`,'--exclude=.DS_Store','-e',['ssh',...sshArgs].join(' '),`${dist.replace(/\/$/,'')}/`,`${host}:${release}/`]],
      ['ssh',[...sshArgs,host,`ln -s '${release}' '${temp}' && mv -Tf '${temp}' '${root}'`]],
      ['ssh',[...sshArgs,host,`find '${root}.releases' -mindepth 1 -maxdepth 1 -type d -regextype posix-extended -regex '.*/[0-9a-f-]{36}' -printf '%T@ %p\n' | sort -nr | tail -n +${keep+1} | cut -d' ' -f2- | while IFS= read -r d; do [ "$d" = "$(readlink -f '${root}')" ] || rm -rf -- "$d"; done`]],
    ];
    if(planOnly)return {method,release,keep,commands};
    let switched=false;
    try {for(let i=0;i<commands.length;i++){await execute(...commands[i]);if(i===2)switched=true;}}
    catch(error){if(!switched)await execute('ssh',[...sshArgs,host,`rm -rf -- '${release}'; rm -f -- '${temp}'`]).catch(()=>{});throw error;}
    return { method, release };
  }
  if (method === 'command') {
    if (!env.LE_DEPLOY_COMMAND) throw new Error('LE_DEPLOY_COMMAND is required for --publish=command');
    if(planOnly)return {method,requiresReviewedAdapter:true};
    await execute('/bin/sh', ['-c', env.LE_DEPLOY_COMMAND], { env: { ...env, LE_DIST: dist } });
    return { method };
  }
  throw new Error(`Unknown publish method ${method}`);
}
