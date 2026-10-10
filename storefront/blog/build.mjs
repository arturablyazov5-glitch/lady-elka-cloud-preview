import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { escapeHtml as esc } from './snapshot.mjs';
function divBounds(html, id) {
 const opening = new RegExp(`<div\\b[^>]*\\bid=['"]${id}['"][^>]*>`).exec(html);
 if (!opening) throw new Error(`Missing approved blog template block ${id}`);
 const start = opening.index + opening[0].length;
 const tags = /<\/?div\b[^>]*>/g; tags.lastIndex = start;
 let depth = 1;
 for (let tag; (tag = tags.exec(html));) {
  depth += tag[0].startsWith('</') ? -1 : 1;
  if (!depth) return {opening,start,end:tag.index,after:tags.lastIndex};
 }
 throw new Error(`Unclosed blog block ${id}`);
}
function inner(html,id,body) { const b=divBounds(html,id);return html.slice(0,b.start)+body+html.slice(b.end); }
function heading(html,id,title) {
 const b=divBounds(html,id);
 return html.slice(0,b.opening.index)+b.opening[0].replace(/^<div/,'<h1').replace(/>$/, ' style="margin:0;font-weight:400">')+`<span class="text-block-wrap-div">${esc(title)}</span></h1>`+html.slice(b.after);
}
const SITE='https://lady-elka.ru';
const ruDate=iso=>new Intl.DateTimeFormat('ru-RU',{timeZone:'Europe/Moscow',day:'2-digit',month:'2-digit',year:'numeric'}).format(new Date(iso));
// SEO-шапка новой статьи: canonical, Open Graph/Twitter и JSON-LD BlogPosting (JSON экранирован от </script>).
function seoHead(post,coverURL) {
 const url=SITE+post.url, title=post.seoTitle || post.title, description=post.seoDescription || post.excerpt, image=coverURL ? SITE+coverURL : '';
 const meta=(attr,key,value)=>value ? `<meta ${attr}="${key}" content="${esc(value)}">` : '';
 const ld={'@context':'https://schema.org','@type':'BlogPosting',headline:post.title.slice(0,110),description,url,mainEntityOfPage:{'@type':'WebPage','@id':url},
  datePublished:post.createdAt,dateModified:post.updatedAt,inLanguage:'ru-RU',...(image?{image:[image]}:{}),
  author:{'@type':'Organization',name:'Lady Elka',url:SITE+'/'},publisher:{'@type':'Organization',name:'Lady Elka',url:SITE+'/'}};
 return [`<link rel="canonical" href="${esc(url)}">`,meta('property','og:type','article'),meta('property','og:site_name','Lady Elka'),meta('property','og:locale','ru_RU'),
  meta('property','og:url',url),meta('property','og:title',title),meta('property','og:description',description),meta('property','og:image',image),meta('property','og:image:alt',image&&post.alt),
  meta('property','article:published_time',post.createdAt),meta('property','article:modified_time',post.updatedAt),
  meta('name','twitter:card',image?'summary_large_image':'summary'),meta('name','twitter:title',title),meta('name','twitter:description',description),meta('name','twitter:image',image),
  `<script type="application/ld+json">${JSON.stringify(ld).replace(/</g,'\\u003c')}</script>`].filter(Boolean).join('');
}
export async function buildBlog(snapshot,{source,target}) {
 if (!snapshot?.posts.length) return [];
 const template = await readFile(join(source,'blog','iskusstvennaya-yelka-cena-i-chto-na-nee-vliyaet.html'),'utf8');
 const records=[];
 const rich = snapshot.posts.some(p=>p.content) ? await import('../../app/public/js/blog-model.js') : null;
 for (const post of snapshot.posts) {
  const coverURL=post.cover ? snapshot.assets[post.cover].url : '';
  let html=template.replace(/<title>[\s\S]*?<\/title>/i,()=>`<title>${esc(post.seoTitle || post.title)}</title>`)
   .replace(/<meta\b[^>]*name=["']description["'][^>]*>/i,()=>`<meta name="description" content="${esc(post.seoDescription || post.excerpt)}">`)
   .replace(/<link\b[^>]*rel=["']canonical["'][^>]*>/gi,'')
   .replace(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>[\s\S]*?<\/script>/gi,'')
   .replace(/<meta\b[^>]*(?:property|name)=["'](?:og|twitter|article):[^"']*["'][^>]*>\s*/gi,'')
   .replace(/<\/head>/i,()=>seoHead(post,coverURL)+'</head>')
   .replaceAll("href='/moya-kollekciya'","href='/blog'");
  html=inner(html,'iiqrs9wjh_0',`<span class="text-block-wrap-div">${esc(post.title)}</span>`);
  html=heading(html,'icduoufky_0',post.title);
  const cover=coverURL ? `<img src="${esc(coverURL)}" alt="${esc(post.alt)}" decoding="async" style="max-width:100%;height:auto">` : '';
  const paragraphs=post.content ? rich.contentHTML(post.content).replace(/\r?\n/g,'<br>') : post.text.split(/\r?\n\s*\r?\n/).map(p=>`<p>${esc(p).replace(/\r?\n/g,'<br>')}</p>`).join('\n');
  html=inner(html,'idm088ivb_0',`<div class="text-block-wrap-div">${cover}${paragraphs}</div>`);
  // Captured source/date label is not provenance for newly authored text.
  const sourceBlock=divBounds(html,'ix3l1s0f3_0');
  html=html.slice(0,sourceBlock.opening.index)+html.slice(sourceBlock.after);
  await writeFile(join(target,'blog',`${post.slug}.html`),html);
  records.push({path:post.url,title:post.title,description:post.seoDescription || post.excerpt,text:post.text,lastmod:post.updatedAt});
 }
 let list=await readFile(join(target,'blog.html'),'utf8');
 const b=divBounds(list,'iuhysab4l_0');
 // Новые статьи — сверху (свежие первыми), в том же виде, что исходные карточки: заголовок + дата + «читать».
 const newest=[...snapshot.posts].sort((a,c)=>Date.parse(c.createdAt)-Date.parse(a.createdAt));
 const cards=newest.map(post=>`<div role="listitem" class="collection__item product-card"><div class="div content__product"><div class="div div--u-i9qesohzg"><div class="text color__h2 site-catalog__h1"><span class="text-block-wrap-div">${esc(post.title)}</span></div><div class="text site__h4 color__h3"><span class="text-block-wrap-div">${esc(ruDate(post.createdAt))}</span></div></div><a href="${post.url}" class="button standart__button-4"><span class="text-button"><span class="text-block-wrap-div">читать</span></span></a></div></div>`).join('\n');
 list=list.slice(0,b.start)+cards+list.slice(b.start);
 await writeFile(join(target,'blog.html'),list);
 await mkdir(join(target,'blog'),{recursive:true});
 return records;
}
export function extendSitemap(xml, records) {
 if (!records.length) return xml;
 return xml.replace('</urlset>',records.map(p=>`<url><loc>https://lady-elka.ru${p.path}</loc>${p.lastmod?`<lastmod>${p.lastmod.slice(0,10)}</lastmod>`:''}</url>`).join('\n')+'\n</urlset>');
}
