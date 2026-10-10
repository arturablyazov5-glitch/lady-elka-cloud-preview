import { readFile, writeFile, readdir, mkdir } from 'node:fs/promises';
import { join, dirname, resolve } from 'node:path';
import { createHash } from 'node:crypto';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
export async function buildServiceWorker(target, { kill = false, previous } = {}) {
  const template = await readFile(new URL('./service-worker.js', import.meta.url), 'utf8');
  const assets = {}, inventory = [];
  const pattern = /^(?:assets|media\/(?:catalog-pinned|catalog-thumbs))\/([a-f0-9]{64})\.(?:css|js|woff2?|png|jpe?g|webp|avif|gif|svg|ico)$/;
  const currentAssets = (await readdir(target, { recursive: true })).filter(file => pattern.test(file)).map(file => '/' + file).sort();
  if (previous) {
    if (resolve(previous) === resolve(target)) throw new Error('Previous assets must be a separate retained artifact');
    let manifest;
    try { manifest = JSON.parse(await readFile(join(previous, 'immutable-manifest.json'), 'utf8')); }
    catch (error) {
      if (error.code !== 'ENOENT') throw error;
      // First SW rollout can retain a pre-SW content-addressed artifact too.
      manifest = { assets: Object.fromEntries((await readdir(previous, { recursive: true })).filter(file => pattern.test(file)).map(file => ['/' + file, null])) };
    }
    // Retain one previous generation's own assets, not its inherited history.
    for (const url of manifest.currentAssets || Object.keys(manifest.assets)) {
      const match = pattern.exec(url.slice(1));
      if (!match || !Object.hasOwn(manifest.assets, url)) throw new Error('Invalid previous immutable path');
      const bytes = await readFile(join(previous, url));
      if (hash(bytes) !== match[1]) throw new Error('Previous immutable checksum mismatch');
      await mkdir(dirname(join(target, url)), { recursive: true });
      await writeFile(join(target, url), bytes);
    }
  }
  for (const file of (await readdir(target, { recursive: true })).sort()) {
    if (/^(?:sw\.js|sw-kill\.js|immutable-manifest\.json)$/.test(file)) continue;
    try {
      const bytes = await readFile(join(target, file));
      const digest = hash(bytes);
      inventory.push([file, digest]);
      const match = pattern.exec(file);
      if (match) {
        if (match[1] !== digest) throw new Error(`Immutable asset checksum mismatch: ${file}`);
        assets['/' + file] = bytes.length;
      }
    } catch (error) { if (error.code !== 'EISDIR') throw error; }
  }
  const release = hash(JSON.stringify(inventory) + template + String(kill));
  const render = emergency => `const LE_SW_CONFIG = ${JSON.stringify({ release, kill: emergency, assets: emergency ? {} : assets })};\n${template}`;
  await writeFile(join(target, 'sw.js'), render(kill));
  await writeFile(join(target, 'sw-kill.js'), render(true));
  await writeFile(join(target, 'immutable-manifest.json'), JSON.stringify({ release, kill, assets, currentAssets }, null, 2) + '\n');
  return release;
}
