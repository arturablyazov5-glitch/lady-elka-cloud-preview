const fail=(message,status=400)=>{throw Object.assign(new Error(message),{status});};
export function validatePost(raw){
 if(!raw || typeof raw!=='object')fail('Некорректная статья');
 const post={};
 for(const [key,max] of Object.entries({title:200,slug:160,excerpt:1000,cover:2000,alt:300,text:100000,seoTitle:200,seoDescription:500})){
  if(typeof raw[key]!=='string'||raw[key].length>max)fail(`Проверьте поле ${key} (до ${max} символов)`);
  post[key]=key==='text'?raw[key]:raw[key].trim();
 }
 if(raw.content!==undefined){if(raw.contentFormat!=='le-richtext-v1')fail('Неизвестный формат текста');post.content=validateContent(raw.content);post.contentFormat='le-richtext-v1';post.text=contentText(post.content);}else if(raw.contentFormat!==undefined)fail('Отсутствует документ текста');
 if(!post.title||!post.slug)fail('Укажите заголовок и адрес');
 if(!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(post.slug))fail('Адрес: латинские буквы, цифры и дефисы');
 if(post.cover && !(/^\/images\/[a-zA-Z0-9_/-]+\.(png|jpg|jpeg|webp)$/i.test(post.cover)||safeHttps(post.cover)))fail('Обложка: HTTPS или /images/имя.jpg');
 if(post.cover&&!post.alt)fail('Добавьте описание обложки');
 if(!['draft','published','archived'].includes(raw.status))fail('Неверный статус');
 if(raw.status==='published'&&(!post.text.trim()||!post.excerpt))fail('Для публикации заполните анонс и текст');
 return {...post,status:raw.status};
}
function safeHttps(s){try{const u=new URL(s);return u.protocol==='https:'&&!u.username&&!u.password;}catch{return false;}}

export function safeLink(value){
 if(typeof value!=='string'||value.length>2000||/[\u0000-\u0020\u007f]/.test(value))return false;
 try{const u=new URL(value);return (['https:','http:'].includes(u.protocol)&&!!u.hostname&&!u.username&&!u.password)||(u.protocol==='mailto:'&&/^[^\s@]+@[^\s@]+$/.test(u.pathname)&&!u.search&&!u.hash);}catch{return false;}
}
export function validateContent(raw){
 if(!raw||raw.version!==1||!Array.isArray(raw.blocks)||raw.blocks.length>1000||Object.keys(raw).some(k=>!['version','blocks'].includes(k)))fail('Некорректный формат текста');
 let size=0,runsCount=0;
 const runs=input=>{if(!Array.isArray(input)||input.length>1000)fail('Некорректный фрагмент текста');return input.map(r=>{
  if(!r||typeof r.text!=='string'||Object.keys(r).some(k=>!['text','bold','italic','href'].includes(k)))fail('Некорректный фрагмент текста');
  size+=r.text.length;if(size>100000||++runsCount>10000)fail('Слишком большой текст');
  if(r.bold!==undefined&&r.bold!==true||r.italic!==undefined&&r.italic!==true||r.href!==undefined&&!safeLink(r.href))fail('Небезопасное форматирование или ссылка');
  return {text:r.text,...(r.bold?{bold:true}:{}),...(r.italic?{italic:true}:{}),...(r.href?{href:r.href}:{})};
 });};
 return {version:1,blocks:raw.blocks.map(b=>{
  if(!b||typeof b!=='object')fail('Некорректный блок');
  if(['paragraph','heading2','heading3'].includes(b.type)){if(Object.keys(b).some(k=>!['type','runs'].includes(k)))fail('Неизвестные поля блока');return {type:b.type,runs:runs(b.runs)};}
  if(['bulletList','orderedList'].includes(b.type)){if(!Array.isArray(b.items)||b.items.length>1000||Object.keys(b).some(k=>!['type','items'].includes(k)))fail('Некорректный список');return {type:b.type,items:b.items.map(runs)};}
  fail('Неизвестный тип блока');
 })};
}
export function contentText(doc){return doc.blocks.flatMap(b=>b.items?b.items.map(rs=>rs.map(r=>r.text).join('')):[b.runs.map(r=>r.text).join('')]).join('\n');}
export function legacyContent(text){return {version:1,blocks:[{type:'paragraph',runs:[{text}]}]};}
export function contentHTML(input){const doc=validateContent(input),escape=s=>s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])).replace(/\r/g,'&#13;');const runs=rs=>rs.map(r=>{let h=escape(r.text);if(r.bold)h=`<strong>${h}</strong>`;if(r.italic)h=`<em>${h}</em>`;if(r.href)h=`<a href="${escape(r.href)}" rel="noopener noreferrer">${h}</a>`;return h;}).join('');return doc.blocks.map(b=>{if(b.items){const tag=b.type==='bulletList'?'ul':'ol';return `<${tag}>${b.items.map(r=>`<li>${runs(r)}</li>`).join('')}</${tag}>`;}const tag={paragraph:'p',heading2:'h2',heading3:'h3'}[b.type];return `<${tag}>${runs(b.runs)}</${tag}>`;}).join('');}
