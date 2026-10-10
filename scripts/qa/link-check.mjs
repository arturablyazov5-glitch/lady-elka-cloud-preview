#!/usr/bin/env node
// Краулер сайта: статусы, битые ссылки/ресурсы, редиректы, canonical/noindex, H1/title/description,
// дубли title, внешние хотлинки, сверка старого sitemap lady-elka.ru с новым.
// Запуск: node scripts/qa/link-check.mjs [--base=http://localhost:4174] [--old=https://lady-elka.ru/sitemap.xml]
//         [--out=agent-context/link-check-report.md] [--max=800] [--json]
// Без зависимостей (Node 18+). Код сайта не меняет.
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const arg = (n, d) => (process.argv.find((a) => a.startsWith(`--${n}=`)) || '').split('=').slice(1).join('=') || d;
const BASE = arg('base', process.env.LINK_CHECK_BASE || 'http://localhost:4174').replace(/\/$/, '');
const OLD_SITEMAP = arg('old', 'https://lady-elka.ru/sitemap.xml');
const OUT = resolve(arg('out', 'agent-context/link-check-report.md'));
const MAX = Number(arg('max', 800));
const ALLOWED = [/(^|\.)mc\.yandex\.(ru|com)$/, /(^|\.)supabase\.(co|in)$/, /(^|\.)(vk\.com|vk\.ru|t\.me|telegram\.me|telegram\.org|wa\.me|whatsapp\.com|instagram\.com|youtube\.com|youtu\.be|ok\.ru|dzen\.ru|pinterest\.com|facebook\.com|max\.ru)$/];
const baseHost = new URL(BASE).host;
const OWN = new Set([baseHost, 'lady-elka.ru', 'www.lady-elka.ru']);
const issues = []; // {p, where, what, repro}
const add = (p, where, what, repro) => issues.push({ p, where, what, repro: repro || `curl -sIL '${BASE}${where.startsWith('/') ? where.split(',')[0] : ''}'` });

async function get(url, method = 'GET') {
  const hops = [];
  let cur = url;
  for (let i = 0; i < 10; i++) {
    let r;
    try { r = await fetch(cur, { method, redirect: 'manual', signal: AbortSignal.timeout(20000), headers: { 'user-agent': 'link-check' } }); }
    catch (e) { return { hops, status: 0, error: e.message, url: cur }; }
    if (r.status >= 300 && r.status < 400 && r.headers.get('location')) {
      const next = new URL(r.headers.get('location'), cur).href;
      hops.push({ status: r.status, from: cur, to: next });
      cur = next; continue;
    }
    return { hops, status: r.status, url: cur, res: r };
  }
  return { hops, status: 0, error: 'redirect loop', url: cur };
}
// URL сайта (в т.ч. абсолютные lady-elka.ru) -> локальный
const local = (u) => { const x = new URL(u); return OWN.has(x.host) ? BASE + x.pathname + x.search : u; };
const attr = (tag, n) => (tag.match(new RegExp(`\\b${n}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i')) || []).slice(2).find((v) => v !== undefined);
const strip = (s) => s.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();

const sitemapLocs = (xml) => [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)].map((m) => m[1]);
const pages = new Map(); // path -> info
const assets = new Map(); // url -> {from:Set}
const ext = new Map(); // host -> Set(from)
const queue = [];
const seen = new Set();
const enqueue = (u, from) => {
  const x = new URL(u); x.hash = '';
  const k = x.pathname + x.search;
  if (seen.has(k)) return; seen.add(k); queue.push({ k, from });
};

// 1) новый sitemap
const sm = await get(BASE + '/sitemap.xml');
if (sm.status !== 200) { console.error(`База ${BASE} недоступна или нет sitemap.xml (${sm.status} ${sm.error || ''})`); process.exit(2); }
const newSitemap = sitemapLocs(await sm.res.text());
const newPaths = new Set(newSitemap.map((u) => new URL(u).pathname));
enqueue(BASE + '/', 'start');
for (const u of newSitemap) enqueue(local(u), 'sitemap');

// 2) обход
const titles = new Map();
while (queue.length && pages.size < MAX) {
  const { k, from } = queue.shift();
  const url = BASE + k;
  const r = await get(url);
  const info = { k, from, status: r.status, hops: r.hops };
  pages.set(k, info);
  if (r.hops.length > 1) add('P1', k, `цепочка редиректов (${r.hops.length}): ${r.hops.map((h) => h.status).join('>')}`);
  if (r.status !== 200) {
    add(r.status === 0 || r.status >= 500 ? 'P0' : 'P1', k, `статус ${r.status || r.error}${from !== 'sitemap' && from !== 'start' ? `, ссылка с ${from}` : ' (из sitemap)'}`);
    continue;
  }
  const ct = r.res.headers.get('content-type') || '';
  if (!ct.includes('html')) continue;
  const html = await r.res.text();
  const head = html.match(/<head[\s\S]*?<\/head>/i)?.[0] || html;
  const title = strip((head.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || '');
  const metas = [...head.matchAll(/<meta\b[^>]*>/gi)].map((m) => m[0]);
  const desc = metas.map((t) => (attr(t, 'name') || '').toLowerCase() === 'description' ? attr(t, 'content') : null).find(Boolean) || '';
  const robots = metas.map((t) => (attr(t, 'name') || '').toLowerCase() === 'robots' ? attr(t, 'content') : null).find(Boolean) || '';
  const canon = [...head.matchAll(/<link\b[^>]*>/gi)].map((m) => m[0]).filter((t) => /canonical/i.test(attr(t, 'rel') || '')).map((t) => attr(t, 'href'))[0];
  const h1s = [...html.matchAll(/<h1\b[\s\S]*?<\/h1>/gi)].length;
  const noindex = /noindex/i.test(robots) || /noindex/i.test(r.res.headers.get('x-robots-tag') || '');
  info.noindex = noindex; info.title = title;
  if (canon) {
    const check = await get(local(new URL(canon, url).href), 'HEAD');
    if (check.hops.length) add('P1', k, `canonical на редирект: ${canon}`);
    if (check.status !== 200) add('P1', k, `canonical статус ${check.status}: ${canon}`);
  }
  const inSitemap = newPaths.has(k);
  if (noindex && inSitemap) add('P1', k, 'noindex, но страница есть в sitemap.xml');
  if (!noindex) {
    if (!title) add('P0', k, 'нет <title>');
    if (!desc) add('P1', k, 'нет meta description');
    if (h1s === 0) add('P1', k, 'нет H1'); else if (h1s > 1) add('P2', k, `несколько H1 (${h1s})`);
    if (!canon) add('P1', k, 'нет canonical');
    else {
      const cp = new URL(canon, url).pathname;
      if (cp !== k) { add('P2', k, `canonical на другую страницу ${canon} (дубль-алиас, ок если намеренно)`); info.alias = true; }
      if (new URL(canon, url).host !== 'lady-elka.ru') add('P2', k, `canonical на хост ${new URL(canon, url).host} (ожидается lady-elka.ru)`);
    }
    if (title && !info.alias) { if (!titles.has(title)) titles.set(title, []); titles.get(title).push(k); }
  }
  // ссылки и ресурсы
  const tags = [...html.matchAll(/<(a|img|source|script|link|iframe|video|audio)\b[^>]*>/gi)];
  for (const [tag, name] of tags) {
    const n = name.toLowerCase();
    const vals = [];
    if (n === 'a') vals.push(['link', attr(tag, 'href')]);
    else if (n === 'link') { const rel = (attr(tag, 'rel') || '').toLowerCase(); if (/stylesheet|icon|preload|manifest|modulepreload/.test(rel)) vals.push(['asset', attr(tag, 'href')]); }
    else if (n === 'img' || n === 'source' || n === 'video' || n === 'audio') { vals.push(['asset', attr(tag, 'src')]); for (const s of (attr(tag, 'srcset') || '').split(',')) vals.push(['asset', s.trim().split(/\s+/)[0]]); }
    else vals.push(['asset', attr(tag, 'src')]);
    for (const [kind, v] of vals) {
      if (!v || /^(#|mailto:|tel:|javascript:|data:|blob:|sms:|viber:|whatsapp:|tg:)/i.test(v)) continue;
      let u; try { u = new URL(v.replace(/&amp;/g, '&'), url); } catch { add('P2', k, `невалидный URL: ${v.slice(0, 80)}`); continue; }
      if (!/^https?:$/.test(u.protocol)) continue;
      if (!OWN.has(u.host)) {
        if (!ext.has(u.host)) ext.set(u.host, new Set()); ext.get(u.host).add(`${k} <${n}>`);
        continue;
      }
      if (u.host !== baseHost && kind === 'asset') add('P1', k, `ресурс с боевого домена ${u.host}: ${u.pathname}`);
      if (kind === 'link' && !/\.(jpe?g|png|webp|gif|svg|pdf|xml|txt|zip|docx?|xlsx?|css|js|mp4|ico|avif)$/i.test(u.pathname)) enqueue(local(u.href), k);
      else { const a = local(u.href); if (!assets.has(a)) assets.set(a, new Set()); assets.get(a).add(k); }
    }
  }
}
for (const [t, ps] of titles) if (ps.length > 1) add('P2', ps.slice(0, 4).join(', ') + (ps.length > 4 ? ` +${ps.length - 4}` : ''), `дубль title «${t.slice(0, 60)}» (${ps.length} стр.)`);

// 3) ресурсы (параллельно, по 8)
const aList = [...assets.entries()];
let ai = 0;
await Promise.all(Array.from({ length: 8 }, async () => {
  while (ai < aList.length) {
    const [u, froms] = aList[ai++];
    const r = await get(u);
    const rel = u.replace(BASE, '');
    const f = [...froms][0] + (froms.size > 1 ? ` +${froms.size - 1}` : '');
    if (r.status !== 200) add(r.status === 0 || r.status >= 500 ? 'P0' : 'P1', rel, `битый ресурс/файл: ${r.status || r.error} (на ${f})`, `curl -sI '${u}'`);
    else if (r.hops.length) add('P2', rel, `ресурс через редирект (${r.hops.map((h) => h.status).join('>')}) на ${f}`, `curl -sIL '${u}'`);
    try { await r.res?.body?.cancel(); } catch {}
  }
}));

// 4) хотлинки
const extRows = [];
for (const [h, froms] of ext) {
  const ok = ALLOWED.some((re) => re.test(h));
  extRows.push({ h, ok, n: froms.size, ex: [...froms][0] });
  if (!ok) add('P2', [...froms][0], `внешний домен вне белого списка: ${h} (${froms.size} мест)`, `grep -rl '${h}' storefront/public storefront/products | head`);
}

// 5) старые URL
const oldRes = await get(OLD_SITEMAP);
const oldRows = [];
if (oldRes.status !== 200) add('P1', OLD_SITEMAP, `старый sitemap недоступен: ${oldRes.status || oldRes.error}`, `curl -sI ${OLD_SITEMAP}`);
else {
  const oldUrls = sitemapLocs(await oldRes.res.text());
  let i = 0;
  await Promise.all(Array.from({ length: 6 }, async () => {
    while (i < oldUrls.length) {
      const ou = oldUrls[i++];
      const path = new URL(ou).pathname;
      const r = await get(BASE + path);
      const final = r.hops.length ? new URL(r.hops.at(-1).to).pathname : path;
      let verdict = 'ok';
      if (r.status !== 200) verdict = `FAIL ${r.status || r.error}`;
      else if (r.hops.length) {
        if (!r.hops.every((h) => h.status === 301 || h.status === 308)) verdict = `редирект не 301 (${r.hops.map((h) => h.status)})`;
        else if (r.hops.length > 1) verdict = `цепочка ${r.hops.length}`;
      }
      if (r.status === 200 && r.res) { const t = await r.res.text(); if (/noindex/i.test((t.match(/<meta[^>]*name=["']robots["'][^>]*>/i) || [''])[0])) verdict = 'ответ 200, но noindex'; }
      oldRows.push({ path, status: r.status, final, verdict });
      if (verdict !== 'ok') add(verdict.startsWith('FAIL') ? 'P0' : verdict.includes('noindex') ? 'P2' : 'P1', path, `старый URL: ${verdict}${r.hops.length ? ` → ${final}` : ''}`, `curl -sIL '${BASE}${path}'`);
    }
  }));
  oldRows.sort((a, b) => a.path.localeCompare(b.path));
  const missingInNew = oldRows.filter((r) => !newPaths.has(r.final) && r.verdict === 'ok' && !r.final.length);
}

// отчёт
const order = { P0: 0, P1: 1, P2: 2 };
issues.sort((a, b) => order[a.p] - order[b.p] || a.where.localeCompare(b.where));
const uniq = []; const sk = new Set();
for (const x of issues) { const key = x.p + x.where + x.what; if (!sk.has(key)) { sk.add(key); uniq.push(x); } }
const cnt = (p) => uniq.filter((x) => x.p === p).length;
const bad = oldRows.filter((r) => r.verdict !== 'ok');
const redir = oldRows.filter((r) => r.verdict === 'ok' && r.final !== r.path).length;
const esc = (s) => String(s).replace(/\|/g, '\\|');
let md = `# Link-check report\n\nСкрипт: \`node scripts/qa/link-check.mjs\` · база ${BASE} · ${new Date().toISOString().slice(0, 16)}Z\n\n`;
md += `Страниц обойдено: ${pages.size} (sitemap: ${newSitemap.length}) · ресурсов проверено: ${assets.size} · старых URL: ${oldRows.length} (ok ${oldRows.length - bad.length}, из них 301: ${redir}, проблемы: ${bad.length})\nПроблем: P0 ${cnt('P0')}, P1 ${cnt('P1')}, P2 ${cnt('P2')}\n\n`;
md += `## Проблемы\n\n| P | Где | Что | Как воспроизвести |\n|---|---|---|---|\n`;
const LIM = 60; let shown = 0;
for (const x of uniq) { if (shown++ >= LIM) { md += `| | … | ещё ${uniq.length - LIM} (см. --json) | |\n`; break; } md += `| ${x.p} | ${esc(x.where)} | ${esc(x.what)} | \`${esc(x.repro)}\` |\n`; }
if (!uniq.length) md += '| - | - | проблем не найдено | - |\n';
md += `\n## Внешние домены\n\n| Домен | Статус | Мест | Пример |\n|---|---|---|---|\n`;
for (const e of extRows.sort((a, b) => a.h.localeCompare(b.h))) md += `| ${e.h} | ${e.ok ? 'допустим' : '**вне списка**'} | ${e.n} | ${esc(e.ex)} |\n`;
if (!extRows.length) md += '| (нет) | | | |\n';
md += `\n## Старые URL lady-elka.ru -> новый сайт\n\nКритерий: 200 или 301 на живую страницу. Отклонения:\n\n`;
md += bad.length ? `| Путь | Статус | Итог | Вердикт |\n|---|---|---|---|\n` + bad.map((r) => `| ${esc(r.path)} | ${r.status} | ${esc(r.final)} | ${esc(r.verdict)} |\n`).join('') : 'Все старые URL отвечают 200/301 на живую страницу.\n';
writeFileSync(OUT, md);
if (process.argv.includes('--json')) writeFileSync(OUT.replace(/\.md$/, '.json'), JSON.stringify({ issues: uniq, old: oldRows, external: extRows, redirectChains: [...pages.values()].filter(p => p.hops.length > 1).length + oldRows.filter(p => p.verdict.startsWith('цепочка')).length, canonicalRedirects: uniq.filter(p => p.what.startsWith('canonical на редирект')).length, internalRedirects: [...pages.values()].filter(p => p.hops.length).length }, null, 1));
console.log(`OK -> ${OUT}\nP0 ${cnt('P0')} P1 ${cnt('P1')} P2 ${cnt('P2')} | pages ${pages.size}, assets ${assets.size}, old bad ${bad.length}/${oldRows.length}`);
