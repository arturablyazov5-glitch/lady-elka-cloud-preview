import { mkdir, readFile, writeFile, rename, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { hostname } from 'node:os';
import { randomUUID } from 'node:crypto';

const TTL = 30 * 60 * 1000;
function alive(pid) {
  try { process.kill(pid, 0); return true; }
  catch (error) { return error.code !== 'ESRCH'; }
}
const busy = () => Object.assign(new Error('Catalog sync lock занят: другой запуск ещё работает'), { code: 'SYNC_BUSY' });
async function inspect(path, ttl) {
  const info = await stat(path);
  let owner;
  try { owner = JSON.parse(await readFile(join(path, 'owner.json'), 'utf8')); } catch {}
  const local = owner?.hostname === hostname() && Number.isInteger(owner.pid) && owner.pid > 0;
  const stale = local ? !alive(owner.pid) : Date.now() - (owner?.heartbeat || info.mtimeMs) >= ttl;
  return { owner, info, stale };
}

export async function acquireLock(path, { ttl = TTL, heartbeatMs = 10000 } = {}) {
  const token = randomUUID();
  let work;
  const owner = { token, pid: process.pid, hostname: hostname(), startedAt: Date.now() };
  const save = async () => {
    const temp = join(path, `${token}.tmp`);
    await writeFile(temp, JSON.stringify({ ...owner, work, heartbeat: Date.now() }));
    await rename(temp, join(path, 'owner.json'));
  };
  try {
    await mkdir(path);
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
    const old = await inspect(path, ttl);
    if (!old.stale) throw busy();
    // A reclaim lease also has PID/TTL recovery. Recheck under it; never remove a new owner's directory.
    const reclaim = await acquireLock(`${path}.reclaim`, { ttl, heartbeatMs });
    try {
      const current = await inspect(path, ttl);
      if (!current.stale || current.info.ino !== old.info.ino || current.owner?.token !== old.owner?.token) throw busy();
      await rm(path, { recursive: true, force: true });
      if (/^\/tmp\/le-catalog-sync-[A-Za-z0-9_-]+$/.test(old.owner?.work || '')) {
        await rm(old.owner.work, { recursive: true, force: true });
      }
      await mkdir(path);
      await save(); // Publish ownership before releasing the reclaim lease.
    } finally { await reclaim.release(); }
  }
  await save();
  let pending = Promise.resolve();
  const timer = setInterval(() => { pending = pending.then(save).catch(() => {}); }, heartbeatMs);
  timer.unref();
  return {
    setWork: async value => { work = value; pending = pending.then(save); await pending; },
    release: async () => {
      clearInterval(timer);
      await pending;
      let current;
      try { current = JSON.parse(await readFile(join(path, 'owner.json'), 'utf8')); } catch {}
      if (current?.token === token) await rm(path, { recursive: true, force: true });
    },
  };
}
