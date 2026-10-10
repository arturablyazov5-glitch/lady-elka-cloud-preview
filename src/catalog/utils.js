// Мелкие переиспользуемые хелперы каталога (без зависимостей от других модулей).

export const $$ = s => Array.from(document.querySelectorAll(s));
export const num = s => Number(String(s || '').replace(/[^\d.-]/g, ''));        // "22 000" -> 22000
export const rub = n => (Number(n) || 0).toLocaleString('ru-RU') + ' ₽';
export const norm = s => String(s || '').trim().toLowerCase().replace(/[ёЁ]/g, 'е').replace(/\s+/g, ' ');

// Делаем norm доступной глобально для скрипта промокодов (отдельный <script> на Taptop)
if (typeof window !== 'undefined') window.norm = norm;

export const normCat = s => norm(String(s || '')
  .replace(/&quot;|&#34;/gi, '"')
  .replace(/^"(.*)"$/, '$1')
);

export function parseCSV(txt){const o=[],r=[];let i=0,c="",q=false;while(i<txt.length){const ch=txt[i];
if(q){if(ch=='"'&&txt[i+1]=='"'){c+='"';i+=2;continue} if(ch=='"'){q=false;i++;continue} c+=ch;i++;continue}
if(ch=='"'){q=true;i++;continue} if(ch==','){r.push(c);c="";i++;continue}
if(ch=='\n'){r.push(c);o.push(r.slice());r.length=0;c="";i++;continue}
if(ch=='\r'){i++;continue} c+=ch;i++} if(c.length||r.length){r.push(c);o.push(r)} return o}

export function isThankUrl(href){
  try{
    const u = new URL(href, location.href);
    const p = (u.pathname||'').toLowerCase();
    return /(?:^|\/)(spasibo|thanks)(?:\/|$)/.test(p);
  }catch{ return false; }
}

export function hideCard(card){
  if (!card) return;
  card.classList.add('is-inactive','no-active-rows');
  card.setAttribute('hidden','');                                // UA-стили прячут
  card.style.setProperty('display','none','important');          // перебиваем всё
  card.style.visibility = 'hidden';
  card.style.pointerEvents = 'none';
  // на всякий случай физически удалим из DOM кадром позже
  requestAnimationFrame(()=>{ if (card.isConnected) card.remove(); });
}

export function findField(form, label){
  // ищем И по name, И по placeholder
  return form.querySelector(`[name="${label}"], input[placeholder="${label}"]`);
}

export function ghostify(el){
  if (!el) return;
  const wrap = el.closest('.form__field') || el;
  // один атрибут — и всё
  wrap.setAttribute('data-le-hide', '');
  el.removeAttribute('required');
  el.setAttribute('tabindex','-1');
  el.setAttribute('aria-hidden','true');
}

export function haveBuilderFields(form){
  // Проверяем только необходимые поля: Товар и Общая сумма
  const labels = ['Товар','Общая сумма'];
  return labels.every(n => !!findField(form, n));
}

export function formatCartItem(item){
  const decor = String(item.category || '').trim() === 'Декор';
  return [
    item.name || 'Товар',
    item.height ? (decor ? String(item.height) : `${item.height} см`) : '',
    item.variantType || '',
    item.category ? `(${item.category})` : '',
  ].filter(Boolean).join(' ');
}

export function fillBuilderFields(form, item){
  const set = (label, val) => {
    const el = findField(form, label);
    if (!el) return;
    el.value = String(val ?? '');
    ghostify(el);                 // ← прячем обёртку одним атрибутом
  };
  // Формируем полное описание товара с параметрами и ценой
  const price = Number(String(item.price||0).replace(/[^\d.-]/g,'')) || 0;
  const qty = Number(item.qty||1);
  const itemTotal = price * qty;

  const itemDesc = [
    formatCartItem(item),
    qty > 1 ? `x${qty}` : '',
    `${itemTotal} ₽`
  ].filter(Boolean).join(' ');

  // Итоговая цена со скидкой (применяем промокод)
  let totalPrice = itemTotal;
  try {
    const promoState = JSON.parse(localStorage.getItem('lady_promo_state')||'null');
    if(promoState && promoState.rub>0){
      totalPrice = Math.max(0, itemTotal - promoState.rub);
    } else if(promoState && promoState.pct>0){
      totalPrice = Math.max(0, Math.round(itemTotal * (1 - promoState.pct/100)));
    }
  } catch(e){}

  set('Товар',            itemDesc);
  // Категория и высота уже включены в поле "Товар", не дублируем
  set('Общая сумма', String(totalPrice || 0));
}

// Заполняет поля конструктора для нескольких товаров
export function fillBuilderFieldsMultiple(form, cart){
  if(!cart || !cart.length) return;

  const set = (label, val) => {
    const el = findField(form, label);
    if (!el) return;
    el.value = String(val ?? '');
    ghostify(el);
  };

  // Формируем читаемый список товаров с параметрами и ценами
  const itemsList = cart.map(item => {
    const price = Number(String(item.price||0).replace(/[^\d.-]/g,'')) || 0;
    const qty = Number(item.qty||1);
    const itemTotal = price * qty;

    const parts = [formatCartItem(item)];
    if(qty > 1) parts.push(`x${qty}`);
    parts.push(`${itemTotal} ₽`);
    return parts.join(' ');
  }).join('; ');

  // Категории всех товаров (уникальные)
  const categories = [...new Set(cart.map(i => i.category).filter(Boolean))].join('; ');

  // Высоты всех товаров (если есть)
  const heights = cart.map(i => i.height).filter(Boolean).join('; ');

  // Итоговая цена со скидкой
  const baseTotal = cart.reduce((sum, item) => {
    const price = Number(String(item.price||0).replace(/[^\d.-]/g,'')) || 0;
    const qty = Number(item.qty||1);
    return sum + (price * qty);
  }, 0);

  let totalPrice = baseTotal;
  try {
    const promoState = JSON.parse(localStorage.getItem('lady_promo_state')||'null');
    if(promoState && promoState.rub>0){
      totalPrice = Math.max(0, baseTotal - promoState.rub);
    } else if(promoState && promoState.pct>0){
      totalPrice = Math.max(0, Math.round(baseTotal * (1 - promoState.pct/100)));
    }
  } catch(e){}

  set('Товар', itemsList);
  // Категория и высота уже включены в поле "Товар", не дублируем
  set('Общая сумма', String(totalPrice || 0));
}
