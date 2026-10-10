import {readFile,writeFile,rename,rm} from 'node:fs/promises';
import {createHash,randomUUID} from 'node:crypto';
// Telegram notification for catalog sync problems. Sends to exactly ONE chat: LE_SYNC_TG_CHAT_ID.
// Deliberately ignores TG_CHAT_IDS (that list contains the group). Negative group/channel ids are always refused.
// Missing config means no network request.
const escapeHtml = value => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');

export function telegramTarget(env = process.env) {
  const token = env.TG_BOT_TOKEN, chat = String(env.LE_SYNC_TG_CHAT_ID || '').trim();
  if (!token || !chat) return { ok: false, reason: 'TG_BOT_TOKEN/LE_SYNC_TG_CHAT_ID not set' };
  if (!/^-?\d{3,20}$/.test(chat)) return { ok: false, reason: 'LE_SYNC_TG_CHAT_ID must be one numeric chat id' };
  if (chat.startsWith('-') || /^0+$/.test(chat)) return { ok: false, reason: 'group/channel chat refused' };
  return { ok: true, token, chat };
}

export function formatMessage({ title, lines = [], site }) {
  const truncate = (text, max) => { let result=''; for(const char of String(text ?? '')) { const escaped=escapeHtml(char); if(result.length+escaped.length>max)break;result+=escaped; } return result; };
  let message=`<b>${truncate(title,600)}</b>`;
  for(const line of [...(site?[site]:[]), ...lines.slice(0,25).map(l=>`• ${l}`), ...(lines.length>25?[`… ещё ${lines.length-25}`]:[])]) {
    const room=3900-message.length-1;if(room<=0)break;message+='\n'+truncate(line,room);
  }
  return message;
}

export async function notify(message, { env = process.env, fetchImpl = fetch, log = console.log } = {}) {
  const target = telegramTarget(env);
  if (!target.ok) { log(`[notify skipped: ${target.reason}]\n${message.replace(/<[^>]+>/g, '')}`); return { sent: false, reason: target.reason }; }
  const response = await fetchImpl(`https://api.telegram.org/bot${target.token}/sendMessage`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(15000),
    body: JSON.stringify({ chat_id: target.chat, text: message, parse_mode: 'HTML', disable_web_page_preview: true }),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || !result.ok) { log(`[notify failed: HTTP ${response.status}]`); return { sent: false, reason: `HTTP ${response.status}` }; }
  return { sent: true, messageId: result.result?.message_id };
}

export async function throttledNotify(message,{statePath,send=notify,interval=6*60*60*1000,now=Date.now(),key=message}={}) {
  const digest=createHash('sha256').update(key).digest('hex');
  let state={};try{state=JSON.parse(await readFile(statePath,'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;}
  if(state[digest] && now-state[digest]<interval)return {sent:false,reason:'duplicate-throttled'};
  const result=await send(message);
  if(result.sent) {state=Object.fromEntries(Object.entries(state).filter(([,time])=>now-time<interval));state[digest]=now;
    const tmp=statePath+'.'+randomUUID()+'.tmp';try{await writeFile(tmp,JSON.stringify(state));await rename(tmp,statePath);}finally{await rm(tmp,{force:true});}}
  return result;
}
