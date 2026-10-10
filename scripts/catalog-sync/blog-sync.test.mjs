import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdtemp, rm, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { syncCatalog } from '../catalog-sync.mjs';
import { readPointer, defaultPointerPath } from '../../storefront/products/snapshot-acceptance.mjs';
import { readFeedsOf } from './snapshot.mjs';
import { pinMedia } from './media.mjs';
const baseline = await readFeedsOf(readPointer().manifestPath), basePointer = await readFile(defaultPointerPath);
const inputs = Object.fromEntries(['trees','decor','promos'].map(n=>[n,{...baseline.manifest.feeds[n],text:baseline.feeds[n]}]));
test('blog-only change rebuilds with current catalog pointer, publishes, then activates blog; pointer untouched', async () => {
  const work = await mkdtemp(join(tmpdir(), 'le-sync-blog-')), pointerPath = join(work, 'active.json'); await writeFile(pointerPath, basePointer);
  const media = await pinMedia(baseline.feeds, { refreshRemote: false }), seen = [];
  const base = { fetchInputs: async () => inputs, pinMedia: async () => media, notify: async m => { seen.push(['notify', m]); return { sent: true }; },
    build: async ({ output, pointerPath: p, blogSnapshot }) => { seen.push(['build', p, blogSnapshot]); await mkdir(output); await writeFile(join(output, 'product-routes.json'), '[]'); },
    publish: async () => { seen.push(['publish']); return { method: 'dir' }; }, activateBlog: async f => { seen.push(['activate', f]); } };
  try {
    const un = await syncCatalog({ pointerPath, dryRun: false, method: 'dir' }, { ...base, prepareBlog: async () => ({ status: 'unchanged', posts: 2, warnings: [] }) });
    assert.equal(un.status, 'unchanged'); assert.equal(seen.length, 0);
    const failed = await syncCatalog({ pointerPath, dryRun: false, method: 'dir' }, { ...base, prepareBlog: async () => { throw new Error('offline'); } });
    assert.equal(failed.status, 'unchanged'); assert.equal(failed.blog.status, 'failed'); assert.equal(seen.length, 0);
    const dry = await syncCatalog({ pointerPath, dryRun: true }, { ...base, prepareBlog: async ({ output }) => ({ status: 'changed', file: output, posts: 1, previousPosts: 0, warnings: [] }) });
    assert.equal(dry.status, 'dry-run'); assert.deepEqual(seen.map(s => s[0]), ['build']); assert.equal(seen[0][1], pointerPath); assert.match(seen[0][2], /blog-snapshot\.json$/);
    seen.length = 0;
    const res = await syncCatalog({ pointerPath, dryRun: false, method: 'dir' }, { ...base, prepareBlog: async ({ output }) => ({ status: 'changed', file: output, posts: 1, previousPosts: 0, warnings: ['w1'] }) });
    assert.equal(res.status, 'published'); assert.equal(res.catalogChanged, false);
    assert.deepEqual(seen.map(s => s[0]), ['build', 'publish', 'activate', 'notify']);
    assert.match(seen[3][1], /Блог на сайте обновлён/); assert.match(seen[3][1], /w1/);
    assert.deepEqual(await readFile(pointerPath), basePointer);
    seen.length = 0;
    await assert.rejects(syncCatalog({ pointerPath, dryRun: false, method: 'dir' }, { ...base, publish: async () => { throw new Error('upload failed'); }, prepareBlog: async ({ output }) => ({ status: 'changed', file: output, posts: 1, warnings: [] }) }), /upload failed/);
    assert.ok(!seen.some(s => s[0] === 'activate'));
  } finally { await rm(work, { recursive: true, force: true }); assert.deepEqual(await readFile(defaultPointerPath), basePointer); }
});
