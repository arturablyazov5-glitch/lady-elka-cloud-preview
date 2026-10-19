import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { encrypt, decrypt, snapshot, debit, run } from './report.mjs';
const services = [{ type: 'app_frontend', service_id: 266305 }];
const snap = (balance, paid, at) => snapshot({ balance, total_paid: paid, currency: 'RUB' }, services, at);
test('recharges do not hide spending; negative net adjustments remain negative', () => {
 const previous = snap(100, 500, '2026-10-19T07:00:00Z');
 assert.equal(debit(previous, snap(550, 1000, '2026-10-26T07:00:00Z')), 50);
 assert.equal(debit(previous, snap(110, 500, '2026-10-26T07:00:00Z')), -10);
 assert.throws(() => snapshot({ balance: 100, total_paid: 500, currency: 'RUB' }, [...services, { type: 'server' }]));
 assert.throws(() => snapshot({ balance: NaN, total_paid: 500, currency: 'RUB' }, services));
});
test('financial state is encrypted, authenticated, and rejects another key', () => {
 const value = { balance: 123.45, paid: 500 };
 const sealed = encrypt(value, 'fixture-secret');
 assert.ok(!sealed.includes('123.45')); assert.deepEqual(decrypt(sealed, 'fixture-secret'), value);
 assert.throws(() => decrypt(sealed, 'wrong-key'));
 const changed = JSON.parse(sealed); changed.tag = Buffer.alloc(16).toString('base64');
 assert.throws(() => decrypt(JSON.stringify(changed), 'fixture-secret'));
});
test('bootstrap, weekly report, repeated invocation and ambiguous Telegram delivery', async () => {
 const dir = await mkdtemp(join(tmpdir(), 'le-billing-test-'));
 try {
 const env = { TIMEWEB_API_TOKEN: 'fixture-key', TG_BOT_TOKEN: 'fixture-bot', LE_SYNC_TG_CHAT_ID: '123456', REPORT_STATE_PATH: join(dir, 'state.enc') };
 let balance = 100, sends = 0, failSend = false;
 const request = async (url, options) => {
  if (url.includes('telegram.org')) { sends++; assert.equal(JSON.parse(options.body).chat_id, '123456'); if(failSend) throw Error('timeout'); return { ok: true, json: async () => ({ ok: true, result: { message_id: sends, chat: { type: 'private' } } }) }; }
  return { ok: true, json: async () => url.endsWith('finances') ? { finances: { balance, total_paid: 500, currency: 'RUB' } } : { meta: { total: 1 }, services_costs: services } };
 };
 await run({ env, request, bootstrap: true, now: '2026-10-19T07:00:00Z' });
 balance = 90; await run({ env, request, now: '2026-10-26T07:00:00Z' });
 assert.equal(sends, 2);
 await run({ env, request, now: '2026-10-26T08:00:00Z' }); assert.equal(sends, 2);
 failSend = true;
 await assert.rejects(run({ env, request, now: '2026-11-02T07:00:00Z' }), /ambiguous/);
 assert.equal(decrypt(await readFile(env.REPORT_STATE_PATH, 'utf8'), env.TIMEWEB_API_TOKEN).delivery, 'pending');
 await assert.rejects(run({ env, request, now: '2026-11-02T08:00:00Z' }), /ambiguous/); assert.equal(sends, 3);
 } finally { await rm(dir, { recursive: true, force: true }); }
});
test('group chat is refused and cannot receive financial information', async () => {
 const dir = await mkdtemp(join(tmpdir(), 'le-billing-private-')); let sends = 0;
 try {
 await assert.rejects(run({ bootstrap:true, env:{TIMEWEB_API_TOKEN:'fixture',TG_BOT_TOKEN:'fixture',LE_SYNC_TG_CHAT_ID:'-12345',REPORT_STATE_PATH:join(dir,'state.enc')}, request:async url=> {
 if(url.includes('telegram.org')) sends++;
 return {ok:true,json:async()=>url.endsWith('finances')?{finances:{balance:100,total_paid:500,currency:'RUB'}}:{meta:{total:1},services_costs:services}};
 }}), /Private Telegram/); assert.equal(sends,0);
 } finally {await rm(dir,{recursive:true,force:true});}
});
