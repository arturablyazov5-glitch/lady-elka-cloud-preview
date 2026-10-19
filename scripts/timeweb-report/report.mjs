import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto';
import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const AAD = Buffer.from('lady-elka-timeweb-weekly-v1');
const key = token => Buffer.from(hkdfSync('sha256', token, AAD, 'encrypted-report-state', 32));
export function encrypt(state, token) {
  const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', key(token), iv);
  cipher.setAAD(AAD);
  const data = Buffer.concat([cipher.update(JSON.stringify(state), 'utf8'), cipher.final()]);
  return JSON.stringify({ v: 1, iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), data: data.toString('base64') });
}
export function decrypt(text, token) {
  const value = JSON.parse(text);
  if (value.v !== 1) throw Error('Unsupported report state');
  const cipher = createDecipheriv('aes-256-gcm', key(token), Buffer.from(value.iv, 'base64'));
  cipher.setAAD(AAD); cipher.setAuthTag(Buffer.from(value.tag, 'base64'));
  return JSON.parse(Buffer.concat([cipher.update(Buffer.from(value.data, 'base64')), cipher.final()]));
}
export function snapshot(finances, services, at = new Date().toISOString()) {
  if (services.length !== 1 || services[0].type !== 'app_frontend' || String(services[0].service_id) !== '266305')
    throw Error('OTHER_SERVICES');
  const { balance, total_paid: paid, currency } = finances;
  if (![balance, paid].every(Number.isFinite) || currency !== 'RUB') throw Error('Invalid financial response');
  return { at, balance, paid, currency, app: 266305 };
}
export function debit(previous, current) {
  if (previous.app !== current.app || previous.currency !== current.currency || Date.parse(previous.at) >= Date.parse(current.at)
    || ![previous.balance, previous.paid, current.balance, current.paid].every(Number.isFinite)
    || current.paid < previous.paid) throw Error('Incompatible financial snapshots');
  // Recharge is not negative spending. Refunds/credits remain net billing adjustments.
  return Math.round(((current.paid - previous.paid) + previous.balance - current.balance) * 100) / 100;
}
const money = value => value.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' ₽';
const date = value => new Date(value).toLocaleString('ru-RU', { timeZone: 'Europe/Moscow', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
export function message(previous, current) {
  const amount = debit(previous, current);
  return `Lady Elka — расходы Timeweb\n${date(previous.at)} — ${date(current.at)} МСК\n\n`
    + (amount >= 0 ? `Списано за период: ${money(amount)}.` : `Возвраты/корректировки превысили списания на ${money(-amount)}.`)
    + '\nСумма учитывает возвраты и корректировки; пополнения исключены.\nСайт — единственный сервис аккаунта на проверенных срезах.';
}
async function api(path, token, request) {
  let response;
  try { response = await request('https://api.timeweb.cloud/api/v1/' + path, { headers: { Authorization: 'Bearer ' + token }, signal: AbortSignal.timeout(20000) }); }
  catch { throw Error('Timeweb API unavailable'); }
  if (!response.ok) throw Error('Timeweb API HTTP ' + response.status);
  return response.json();
}
async function telegram(text, env, request) {
  const chat = String(env.LE_SYNC_TG_CHAT_ID || '');
  if (!/^\d{3,20}$/.test(chat) || /^0+$/.test(chat) || !env.TG_BOT_TOKEN) throw Error('Private Telegram target missing');
  let response, result;
  try {
    response = await request(`https://api.telegram.org/bot${env.TG_BOT_TOKEN}/sendMessage`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(15000),
      body: JSON.stringify({ chat_id: chat, text, disable_web_page_preview: true }),
    }); result = await response.json();
  } catch { throw Error('Telegram delivery ambiguous; automatic resend refused'); }
  if (!response.ok || !result.ok || result.result?.chat?.type !== 'private') throw Error('Telegram delivery not confirmed');
  return result.result.message_id;
}
export async function run({ env = process.env, request = fetch, now = new Date().toISOString(), bootstrap = false } = {}) {
  if (!env.TIMEWEB_API_TOKEN) throw Error('TIMEWEB_API_TOKEN missing');
  if (Number(env.GITHUB_RUN_ATTEMPT || 1) > 1) throw Error('Rerun refused to prevent duplicate messages; inspect previous delivery');
  const path = resolve(env.REPORT_STATE_PATH || '.timeweb-report/state.enc');
  let state;
  try { state = decrypt(await readFile(path, 'utf8'), env.TIMEWEB_API_TOKEN); }
  catch (error) { if (error.code !== 'ENOENT') throw Error('Report state cannot be decrypted; manual review required'); }
  const save = async () => { await mkdir(dirname(path), { recursive: true }); await writeFile(path + '.tmp', encrypt(state, env.TIMEWEB_API_TOKEN), { mode: 0o600 }); await rename(path + '.tmp', path); };
  if (bootstrap && state) throw Error('Baseline already exists; automatic reset refused');
  if (!bootstrap && !state) throw Error('Baseline missing; initialize manually before weekly reports');
  if (state?.delivery === 'pending') throw Error('Previous delivery ambiguous; inspect Telegram before resuming');
  const [finance, costs] = await Promise.all([api('account/finances', env.TIMEWEB_API_TOKEN, request), api('account/services/cost', env.TIMEWEB_API_TOKEN, request)]);
  if (!Array.isArray(costs.services_costs) || costs.meta?.total !== costs.services_costs.length) throw Error('Incomplete service inventory');
  let current;
  try { current = snapshot(finance.finances, costs.services_costs, now); }
  catch (error) {
    if (error.message !== 'OTHER_SERVICES') throw error;
    state ||= { v: 1 }; state.blocked = true; await save();
    await telegram('Lady Elka — расчёт расходов Timeweb приостановлен: изменился список сервисов аккаунта. Общие списания не приписаны сайту. Нужна проверка.', env, request);
    throw Error('Site-only billing requires review: service inventory changed');
  }
  if (state?.blocked) throw Error('Billing attribution was blocked; manual review required');
  const week = new Date(now); week.setUTCHours(0, 0, 0, 0); week.setUTCDate(week.getUTCDate() - (week.getUTCDay() + 6) % 7);
  const period = week.toISOString().slice(0, 10);
  if (!bootstrap && state.lastPeriod === period) { console.log('Weekly report already delivered'); return; }
  const text = bootstrap
    ? 'Lady Elka — еженедельный отчёт Timeweb подключён.\nПо понедельникам, около 10:00 МСК, буду присылать списания по сайту за период с предыдущего замера. Начальный замер сохранён; первый отчёт придёт в следующий понедельник.\nЕсли в аккаунте появятся другие сервисы, расчёт будет остановлен для проверки.'
    : message(state.snapshot, current);
  const previous = state;
  state = { ...state, v: 1, delivery: 'pending' }; await save();
  const messageId = await telegram(text, env, request); // Never retry an ambiguous send.
  state = { v: 1, snapshot: current, delivery: 'sent', messageId, lastPeriod: period, previousAt: previous?.snapshot?.at || null };
  await save(); console.log(bootstrap ? 'Baseline saved; private setup message delivered' : 'Weekly report delivered; baseline advanced');
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  run({ bootstrap: process.argv.includes('--bootstrap') }).catch(error => { console.error(error.message); process.exitCode = 1; });
