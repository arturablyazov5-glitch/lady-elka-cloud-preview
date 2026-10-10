import { initForms } from '../../storefront/client/forms.js';
const mountLeadForms = () => initForms();
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mountLeadForms, { once: true });
else mountLeadForms();
import { setPriceStatus, guardPricePurchase } from './price-recovery.js';
document.addEventListener('click', guardPricePurchase, true);
// === Каталог Lady Elka — точка входа ===
// Исходники разбиты на модули в src/catalog/. Сборка: npm run build -> dist/catalog.js
import {
  CARD_SEL, IMG_WRAP_SEL, EXTRA_IMG_WRAP_SEL, PROMO_SHEET_CSV_URL,
} from './config.js';
import {
  $$, num, rub, norm, normCat, isThankUrl, hideCard,
  findField, ghostify, haveBuilderFields, fillBuilderFields, fillBuilderFieldsMultiple,
  formatCartItem,
} from './utils.js';
import { loadDict, loadDecorDict } from './sheets.js';

// === КАТЕГОРИИ &#x2194; ФОТО ===
const CAT_LABELS = ['Зелёная','С освещением','Заснеженная','Заснеженная с освещением'];
const CAT_ORDER = CAT_LABELS.map(normCat);

// Если для выбранной категории нет фото: true — не показываем ничего; false — показываем первое валидное
const STRICT_PHOTO_BY_CAT = false;

// Актуальные таблицы цен. Заполняются при загрузке страницы (initCards) и обновляются
// в фоне при открытии корзины — чтобы сверка цен перед оплатой была мгновенной.
// Важно: сверку нельзя делать через await прямо в обработчике клика — оплата на десктопе
// открывается через window.open, и браузер заблокирует окно, если до него был сетевой запрос.
let priceDict = null;
let priceDecorDict = null;
const KEY = 'cart';

function updatePhotos(card, catKey){
  const want = normCat(catKey);
  const wraps = Array.from(card.querySelectorAll(IMG_WRAP_SEL));
  if(!wraps.length){ card.setAttribute('data-photos-ready',''); return; }

  // карта категория → обёртка
  const byCat = new Map();
  wraps.forEach(w=>{
    const raw = (w.getAttribute('data-cat') || '').replace(/&quot;|&#34;/gi,'"').trim();
    byCat.set(normCat(raw), w);
  });

  // целевой слот
  let target = byCat.get(want);
  if(!target){
    const idx = CAT_ORDER.indexOf(want);
    target = wraps[idx] || wraps[0];
  }

  const isValidSrc = (w)=>{
    const img = w.querySelector('img');
    const src = img?.getAttribute('data-origin-src') ||
                img?.getAttribute('data-src') ||
                img?.getAttribute('src') || '';
    return !!src && src !== '/d/' && !/\/d\/?$/.test(src);
  };

  if(!isValidSrc(target)){
    target = wraps.find(isValidSrc) || target;
  }

  // показать/спрятать
  wraps.forEach(w=>{
    const on = (w === target);

    if(on){
      w.removeAttribute('hidden');
      w.style.setProperty('display','block','important');
      w.style.removeProperty('opacity');
      w.style.removeProperty('visibility');

      const img = w.querySelector('img');
      if(img){
        const src = img.getAttribute('data-origin-src') || img.getAttribute('data-src');
        if(src && !img.getAttribute('src')) img.setAttribute('src', src);
        watchImageLoading(w, img);
        img.removeAttribute('hidden');
        img.style.setProperty('display','block','important');
        img.style.removeProperty('opacity');
        img.style.removeProperty('visibility');
      }
    } else {
      w.setAttribute('hidden','');
      w.style.setProperty('display','none','important');
      const img = w.querySelector('img');
      if(img){
        img.setAttribute('hidden','');
        img.style.setProperty('display','none','important');
      }
    }
  });

  // обновляем data-photo для корзины
  const img = target.querySelector('img');
  card.__curPhoto = img?.src || '';
  const buy = card.querySelector('.buy-btn');
  if(buy){
    if(card.__curPhoto) buy.dataset.photo = card.__curPhoto;
    else delete buy.dataset.photo;
  }

  card.setAttribute('data-photos-ready','');
}

// ДОБАВЬ выше refreshExtraPhotos
function ensureImg(w){
  // куда вставлять картинку
  const holder = w.querySelector('.image') || w;
  // пробуем найти img
  let img = holder.querySelector('img');
  if(!img){
    // пробуем клонировать любой существующий img из блока ещё-фото (сохранятся классы)
    const tpl = w.closest(CARD_SEL)?.querySelector(`${EXTRA_IMG_WRAP_SEL} img`);
    if (tpl){
      img = tpl.cloneNode(false);
      img.removeAttribute('src'); img.removeAttribute('srcset');
    } else {
      img = document.createElement('img');
      img.className = 'image__img';
      img.alt = '';
      img.loading = 'lazy';
      img.decoding = 'async';
      img.style.width = '100%';
      img.style.height = '100%';
      img.style.objectFit = 'cover';
    }
    holder.appendChild(img);
  }
  return img;
}
    
    
function refreshExtraPhotos(card, catKey, photoList, showAll){
  // убираем слоты, добавленные динамически на предыдущий вызов (иначе будут копиться)
  card.querySelectorAll(`${EXTRA_IMG_WRAP_SEL}[data-extra-photo-dynamic]`).forEach(w => w.remove());

  const wraps = Array.from(card.querySelectorAll(EXTRA_IMG_WRAP_SEL));
  if(!wraps.length) return;

  const want = normCat(catKey);

  // 10 слотов: 0..3 — категории (TapTop), 4..9 — CSV
  const hasDataCat = wraps.some(w => w.hasAttribute('data-cat'));
  const catSlots  = hasDataCat ? wraps.filter(w => w.hasAttribute('data-cat')) : wraps.slice(0, 4);
  const csvSlots  = hasDataCat ? wraps.filter(w => !w.hasAttribute('data-cat')) : wraps.slice(4);

  // Если фото из таблицы больше, чем готовых слотов-заглушек в Taptop — донаращиваем
  // недостающие слоты, клонируя последний CSV-слот (заглушку), как на GitHub.
  const urlsForCount = (photoList || []).filter(Boolean);
  if (csvSlots.length && urlsForCount.length > csvSlots.length){
    const template = csvSlots[csvSlots.length - 1];
    let lastEl = template;
    const extraCount = urlsForCount.length - csvSlots.length;
    for (let i = 0; i < extraCount; i++){
      const clone = template.cloneNode(true);
      clone.setAttribute('data-extra-photo-dynamic', '1');
      clone.removeAttribute('hidden');
      clone.style.removeProperty('display');
      const img = clone.querySelector('img');
      if (img){
        img.removeAttribute('src');
        img.removeAttribute('data-origin-src');
        img.removeAttribute('srcset');
      }
      lastEl.insertAdjacentElement('afterend', clone);
      lastEl = clone;
      csvSlots.push(clone);
    }
  }

  // есть ли в слоте реальное фото (а не заглушка/пусто)
  const slotHasPhoto = w => {
    const img = w.querySelector('img');
    const src = img?.getAttribute('src') || img?.getAttribute('data-origin-src') || img?.getAttribute('data-src') || '';
    return !!src && !/placeholder/i.test(src) && src !== '/d/' && !/\/d\/?$/.test(src);
  };

  if (showAll) {
    // Туи и товары с одной категорией: показываем ВСЕ категорийные слоты с реальным фото
    // (это галерея ракурсов, не зависящая от категории)
    catSlots.forEach(w => { w.style.display = slotHasPhoto(w) ? '' : 'none'; });
  } else {
    // 1) Категорийные слоты: показываем только слот текущей категории, остальные прячем
    const byCat = new Map();
    catSlots.forEach(w => byCat.set(normCat(w.dataset.cat || ''), w));

    let target = byCat.get(want);
    if(!target){
      const idx = Math.max(0, CAT_ORDER.indexOf(want));
      target = catSlots[idx] || null;
    }
    catSlots.forEach(w => { w.style.display = (w === target) ? '' : 'none'; });
  }

  // 2) CSV-слоты: заполняем ссылками, лишние скрываем
  const urls = urlsForCount.slice(0, csvSlots.length);
  csvSlots.forEach((w, i) => {
    const url = urls[i] || '';
    if (url){
      const img = ensureImg(w);
      img.removeAttribute('srcset');
      img.setAttribute('src', url);
      img.setAttribute('data-origin-src', url);
      img.alt = card.querySelector('[data-prop-title]')?.textContent.trim() || img.alt || '';
      watchImageLoading(w, img);
      w.style.display = '';
    } else {
      w.style.display = 'none';
    }
  });

  // Если ни одного фото в «Ещё фото» не показано — прячем весь блок (заголовок + слоты).
  // Надёжный хук — атрибут data-extra-photos на блоке «Ещё фото» (проставь в Taptop).
  // Fallback (если атрибута нет): поднимаемся до самого верхнего .dop__img__cms —
  // он содержит и заголовок, и слоты (их бывает два вложенных).
  const anyShown = catSlots.concat(csvSlots).some(w => w.style.display !== 'none');
  let section = card.querySelector('[data-extra-photos]');
  if (!section) {
    section = wraps[0].closest('.dop__img__cms');
    while (section && section.parentElement) {
      const up = section.parentElement.closest('.dop__img__cms');
      if (!up) break;
      section = up;
    }
  }
  if (section) section.style.display = anyShown ? '' : 'none';

  card.setAttribute('data-photos-ready','');
}

// «Ещё фото» у декора устроено проще, чем у ёлок: категорий-ракурсов нет, просто список
// фотографий ТЕКУЩЕГО выбранного варианта (тип+размер). Слоты в Taptop могут быть помечены
// data-cat (например, скопировали блок с ёлки) — здесь это неважно, любой найденный слот
// используется как шаблон и клонируется, если фото больше, чем слотов.
function renderDecorExtraPhotos(card, photos) {
  card.querySelectorAll(`${EXTRA_IMG_WRAP_SEL}[data-extra-photo-dynamic]`).forEach(w => w.remove());
  const wraps = Array.from(card.querySelectorAll(EXTRA_IMG_WRAP_SEL));
  if (!wraps.length) return;

  const list = (photos || []).filter(Boolean);
  if (list.length > wraps.length) {
    const template = wraps[wraps.length - 1];
    let lastEl = template;
    for (let i = 0; i < list.length - wraps.length; i++) {
      const clone = template.cloneNode(true);
      clone.setAttribute('data-extra-photo-dynamic', '1');
      clone.removeAttribute('hidden');
      clone.style.removeProperty('display');
      const img = clone.querySelector('img');
      if (img) { img.removeAttribute('src'); img.removeAttribute('data-origin-src'); img.removeAttribute('srcset'); }
      lastEl.insertAdjacentElement('afterend', clone);
      lastEl = clone;
      wraps.push(clone);
    }
  }

  wraps.forEach((w, i) => {
    const url = list[i] || '';
    if (url) {
      const img = ensureImg(w);
      img.removeAttribute('srcset');
      img.setAttribute('src', url);
      img.setAttribute('data-origin-src', url);
      img.alt = card.querySelector('[data-prop-title]')?.textContent.trim() || img.alt || '';
      watchImageLoading(w, img);
      w.style.display = '';
    } else {
      w.style.display = 'none';
    }
  });

  const anyShown = wraps.some(w => w.style.display !== 'none');
  let section = card.querySelector('[data-extra-photos]');
  if (!section) {
    section = wraps[0].closest('.dop__img__cms');
    while (section && section.parentElement) {
      const up = section.parentElement.closest('.dop__img__cms');
      if (!up) break;
      section = up;
    }
  }
  if (section) section.style.display = anyShown ? '' : 'none';
}


// === ВСПОМОГАТЕЛЬНОЕ для «псевдо-селектов»
const setText = (el, txt) => { (el?.querySelector?.('.text-block-wrap-div')||el).textContent = txt; };

function watchImageLoading(wrapper, img){
  if (!wrapper || !img) return;
  const finish = () => wrapper.classList.remove('le-image-skeleton');
  const fail = () => {
    img.setAttribute('hidden', '');
    img.style.setProperty('display', 'none', 'important');
    finish();
  };
  wrapper.classList.add('le-image-skeleton');
  img.addEventListener('load', finish, { once: true });
  img.addEventListener('error', fail, { once: true });
  if (img.complete && img.naturalWidth > 0) finish();
}

// До ответа каталога не показываем шаблонную/устаревшую цену из CMS.
// Проходим по уже отрендеренным карточкам до первого await в initCards().
function markPricesLoading(){
  $$(CARD_SEL).filter(card => !card.hasAttribute('data-storefront-product')).forEach(card => {
    card.querySelectorAll('[data-price-decor], .price').forEach(priceEl => {
      setText(priceEl, 'Загрузка...');
    });
  });
}

function isDecorCard(card){
  return !!card.querySelector('[data-product-id-decor]') || (
    !!card.querySelector('[data-variants-decor]') &&
    !card.querySelector('[data-prop-category]') &&
    !card.querySelector('[data-prop-height]')
  );
}

function neededPriceFeeds(cards, cart){
  const need = { trees:false, decor:false };
  cards.forEach(card => { need[isDecorCard(card) ? 'decor' : 'trees'] = true; });
  if (Array.isArray(cart)) cart.forEach(item => {
    need[String(item?.category || '').trim() === 'Декор' ? 'decor' : 'trees'] = true;
  });
  return need;
}

async function loadNeededPriceFeeds(need, cache = 'default'){
  const results = await Promise.allSettled([
    need.trees ? loadDict(cache) : Promise.resolve(null),
    need.decor ? loadDecorDict(cache) : Promise.resolve(null)
  ]);
  const [trees, decor] = results;
  if (trees.status === 'fulfilled' && trees.value){
    priceDict = trees.value;
    console.log('Таблица елок загружена, записей:', priceDict.byId.size + priceDict.byTitle.size);
  } else if (trees.status === 'rejected') { priceDict = null; console.error('таблица елок не загрузилась', trees.reason); }
  if (decor.status === 'fulfilled' && decor.value){
    priceDecorDict = decor.value;
    console.log('Таблица декора загружена, записей:', priceDecorDict.byId.size + priceDecorDict.byTitle.size);
  } else if (decor.status === 'rejected') { priceDecorDict = null; console.error('таблица декора не загрузилась', decor.reason); }
  return { dict:trees.status === 'fulfilled' ? trees.value : null, decorDict:decor.status === 'fulfilled' ? decor.value : null };
}

function escapeHtml(s){
  return String(s||'').replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
}
function setHtmlWithNewlines(el, text){
  const target = el?.querySelector?.('.text-block-wrap-div') || el;
  target.innerHTML = escapeHtml(text||'').replace(/\n/g,'<br>');
}

// создаёт контейнер списка (скролл внутри)
function ensureList(holder, role){
  if(!holder) return null;
  holder.style.position = holder.style.position || 'relative';
  let list = holder.querySelector('[data-dd-list]');
  if(!list){
    list = document.createElement('div');
    list.setAttribute('data-dd-list', role||'');
    Object.assign(list.style,{
      position:'absolute',
      display:'none',
      left:'0',
      right:'0',
      zIndex:'50',
      background:'#fff',
      boxShadow:'0 8px 18px rgba(0,0,0,.08)',
      borderRadius:'10px',
      overflowY:'auto',
      maxHeight:'280px'
    });
    holder.appendChild(list);
  }
  return list;
}

// открывает список: вниз/вверх + вписываем высоту в границы карточки
function openDD(holder, list){
  const card = holder.closest(CARD_SEL) || holder;
  const hr = holder.getBoundingClientRect();
  const cr = card.getBoundingClientRect();

  const spaceBelow = Math.max(0, cr.bottom - hr.bottom - 8);
  const spaceAbove = Math.max(0, hr.top - cr.top - 8);

  // по умолчанию — вниз
  list.style.removeProperty('bottom');
  list.style.top = '100%';

  let side = 'down', avail = spaceBelow;
  if(spaceAbove > spaceBelow){
    side = 'up';
    list.style.removeProperty('top');
    list.style.bottom = '100%';
    avail = spaceAbove;
  }

  const maxH = Math.max(140, Math.min(280, avail));
  list.style.maxHeight = maxH + 'px';

  list.style.display = '';
  holder.classList.add('dd-open');

  if(avail < 60){
    list.style.maxHeight = '160px';
    if(side === 'down'){ list.style.top = 'calc(100% + 6px)'; }
    else { list.style.bottom = 'calc(100% + 6px)'; }
  }
}

// Кэш для выпадающих списков
let ddListsCache = null;
let ddOpenCache = null;

function closeAllDD(){
  // Используем кэш, если он есть и актуален
  if(!ddListsCache || !ddListsCache.length){
    ddListsCache = Array.from(document.querySelectorAll('[data-dd-list]'));
  }
  if(!ddOpenCache || !ddOpenCache.length){
    ddOpenCache = Array.from(document.querySelectorAll('.dd-open'));
  }
  
  // Быстрое обновление стилей
  ddListsCache.forEach(el=>{ 
    if(el.style.display !== 'none') el.style.display='none'; 
  });
  ddOpenCache.forEach(el=>{
    if(el.classList.contains('dd-open')) el.classList.remove('dd-open');
  });
  
  // Очищаем кэш после использования (он обновится при следующем вызове)
  ddListsCache = null;
  ddOpenCache = null;
}

// клик вне плашек — закрыть
document.addEventListener('click', e=>{
  if(!e.target.closest('[data-dd-list],[data-prop-category],[data-prop-height],.input__catalog,[data-variants-decor]')){
    closeAllDD();
  }
});

function attachHover(listEl){
  listEl.querySelectorAll('[data-dd-option] .site__h5').forEach(span=>{
    const btn = span.closest('[data-dd-option]');
    btn.addEventListener('mouseenter', ()=>{ span.classList.remove('color__h3'); span.classList.add('color__h2'); });
    btn.addEventListener('mouseleave', ()=>{ span.classList.remove('color__h2'); span.classList.add('color__h3'); });
  });
}

function getCsvPhotos(entry, catKey){
  const arr = entry?.cats?.get(catKey) || [];
  const out = [];
  const seen = new Set();
  for (const o of arr){
    for (const u of (o.photos || [])){
      const s = String(u||'').trim();
      if (!s) continue;
      if (s === '/d/' || /\/d\/?$/.test(s)) continue; // выкидываем заглушки
      if (!seen.has(s)){ seen.add(s); out.push(s); }   // уникализируем
    }
  }
  return out; // массив URL из таблицы в порядке без дублей
}


// Функция для выбора варианта размера декора
function selectVariant(card, variantsDecorEl, entry, variantIndex) {
  if (!entry.variants || !entry.variants[variantIndex]) return;
  
  const variant = entry.variants[variantIndex];
  // Используем цену напрямую из варианта (из колонки price таблицы)
  const variantPrice = variant.price || entry.price || 0;
  const variantSize = variant.size || '';
  
  // Обновляем отображаемый размер в поле вариантов (используем size из варианта)
  const sizeTextEl = variantsDecorEl.querySelector('.text.site-catalog__h3, .site-catalog__h3');
  if (sizeTextEl) {
    setText(sizeTextEl, variantSize);
  }
  
  // Обновляем плашку с высотой выбранным вариантом
  const hTextEl = card.querySelector('[data-prop-height]');
  if (hTextEl) {
    setText(hTextEl, variantSize);
    // Убеждаемся, что плашка видна
    const hLabel = hTextEl.closest('.input__catalog') || hTextEl;
    if (hLabel) {
      hLabel.style.display = '';
    }
  }
  
  // Обновляем цену в элементе с data-price-decor
  const priceFormatted = rub(variantPrice);
  const priceDecorEl = card.querySelector('[data-price-decor]');
  if (priceDecorEl) {
    setText(priceDecorEl, priceFormatted);
    // Также напрямую обновляем textContent для надежности
    const textEl = priceDecorEl.querySelector('.text-block-wrap-div');
    if (textEl) {
      textEl.textContent = priceFormatted;
    } else {
      priceDecorEl.textContent = priceFormatted;
    }
  }
  
  // Обновляем данные в кнопке "Купить" (только data-price, текст кнопки не трогаем)
  const buyBtn = card.querySelector('.buy-btn');
  if (buyBtn) {
    buyBtn.dataset.price = variantPrice;
    buyBtn.dataset.height = variantSize; // Сохраняем размер варианта в data-height
  }
  
  // Сохраняем выбранный индекс
  variantsDecorEl.dataset.selectedIndex = variantIndex;
  
  // Обновляем класс dd-open для визуального состояния
  variantsDecorEl.classList.remove('dd-open');
}

// Декор использует тот же принцип, что и ёлки: сначала выбирается тип,
// затем доступный для него размер. Разметка типа создаётся из готового
// Taptop-контрола размера, поэтому вручную добавлять блок в каждую карточку не нужно.
function initDecorCard(card, entry, titleEl, titleNow) {
  const sheetTitle = entry.title || titleNow;
  if (titleEl && sheetTitle && sheetTitle !== titleNow) {
    (titleEl.querySelector?.('.text-block-wrap-div') || titleEl).textContent = sheetTitle;
  }

  const priceEl = card.querySelector('[data-price-decor]');
  const buy = card.querySelector('.buy-btn');
  const image = card.querySelector('.product__img img, .product__img__cms img, .image__img, img');
  const descriptionEl = card.querySelector('.text--u-ibls00792, [data-product-id].text--u-ibls00792');
  const sizeControl = card.querySelector('[data-variants-decor]');
  const allVariants = entry.variants || [];
  const types = [...new Set(allVariants.map(v => String(v.category || '').trim()).filter(Boolean))];

  const setImage = variant => {
    const photos = (variant?.photos?.length ? variant.photos : entry.photos) || [];
    const photo = photos[0] || '';
    if (image && photo) {
      image.src = photo;
      image.setAttribute('data-origin-src', photo);
      image.classList.add('can-zoom');
    }
    // Первое фото уже ушло в основную картинку — остальные показываем в «Ещё фото».
    renderDecorExtraPhotos(card, photos.slice(1));
  };
  const setDescription = variant => {
    if (!descriptionEl) return;
    const text = (variant?.description || entry.description || '').trim();
    const target = descriptionEl.querySelector('.text-block-wrap-div') || descriptionEl;
    setHtmlWithNewlines(target, text);
    descriptionEl.style.display = text ? '' : 'none';
  };
  const setPriceAndBuy = variant => {
    const price = variant?.price || entry.price || 0;
    if (priceEl) setText(priceEl, rub(price));
    if (!buy) return;
    buy.dataset.name = sheetTitle;
    buy.dataset.price = price;
    buy.dataset.photo = variant?.photos?.[0] || entry.photos?.[0]
      || image?.getAttribute('data-origin-src') || image?.currentSrc || image?.src || '';
    buy.dataset.category = 'Декор';
    buy.dataset.height = variant?.size || '';
    buy.dataset.diam = '';
    buy.dataset.branches = '';
  };
  const setControlText = (control, text) => {
    const target = control?.querySelector('.text.site-catalog__h3, .site-catalog__h3');
    if (target) setText(target, text);
  };
  const bindControl = (control, values, label, onSelect) => {
    if (!control) return;
    const list = ensureList(control, control.hasAttribute('data-decor-type') ? 'decor-type' : 'variants-decor');
    list.innerHTML = '';
    values.forEach((value, index) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.setAttribute('data-dd-option', '');
      button.style.cssText = 'display:block;width:100%;text-align:left;padding:10px 12px;border:0;background:transparent;cursor:pointer';
      const span = document.createElement('span');
      span.className = 'site__h5 color__h3';
      span.textContent = label(value);
      button.appendChild(span);
      button.addEventListener('click', event => { event.stopPropagation(); onSelect(value, index); closeAllDD(); });
      list.appendChild(button);
    });
    control.onclick = event => {
      if (event.target.closest('[data-dd-option]')) return;
      event.stopPropagation();
      const open = list.style.display !== 'none' && list.style.display !== '' && control.classList.contains('dd-open');
      closeAllDD();
      if (!open) openDD(control, list);
    };
    control.style.position = 'relative';
    control.style.cursor = 'pointer';
    control.style.userSelect = 'none';
    attachHover(list);
  };

  let typeControl = card.querySelector('[data-decor-type]');
  if (types.length > 1 && sizeControl && !typeControl) {
    typeControl = sizeControl.cloneNode(true);
    typeControl.removeAttribute('data-variants-decor');
    typeControl.removeAttribute('data-variants');
    typeControl.removeAttribute('data-selected-index');
    typeControl.setAttribute('data-decor-type', '');
    typeControl.querySelectorAll('[data-dd-list]').forEach(node => node.remove());
    typeControl.querySelectorAll('[id]').forEach(node => node.removeAttribute('id'));
    typeControl.removeAttribute('id');
    sizeControl.parentNode.insertBefore(typeControl, sizeControl);
  }

  // В конструкторе Taptop эта плашка (класс вида div--u-XXXXXXXX) у части карточек
  // скрыта через display:none!important — обычный style.display это не перебивает,
  // поэтому показываем/прячем тоже через !important.
  const showRow = el => el && el.style.setProperty('display', 'flex', 'important');
  const hideRow = el => el && el.style.setProperty('display', 'none', 'important');

  const renderType = type => {
    const variants = type ? allVariants.filter(v => String(v.category || '').trim() === type) : allVariants;
    const first = variants[0] || null;
    setDescription(first);
    setImage(first);
    setPriceAndBuy(first);

    if (typeControl) {
      setControlText(typeControl, type);
      (types.length > 1 ? showRow : hideRow)(typeControl);
    }
    if (!sizeControl) return;
    const needsSize = variants.length > 1 || !!first?.size;
    (needsSize ? showRow : hideRow)(sizeControl);
    if (!needsSize) return;
    setControlText(sizeControl, first?.size || first?.variantText || 'Выберите размер');
    bindControl(sizeControl, variants, variant => variant.variantText || variant.size || 'Вариант', variant => {
      setControlText(sizeControl, variant.size || variant.variantText || 'Вариант');
      setDescription(variant);
      setImage(variant);
      setPriceAndBuy(variant);
      sizeControl.classList.remove('dd-open');
    });
  };

  if (typeControl) bindControl(typeControl, types, type => type, type => renderType(type));
  renderType(types[0] || '');
}

/* --- initCards: ID-first matching, кликабельна вся плашка --- */
(async function initCards(){
  const toId = s => String(s||'').trim().toLowerCase();

  const savedCart = getCart();

  if (document.readyState === 'loading') {
    await new Promise(resolve => document.addEventListener('DOMContentLoaded', resolve, { once:true }));
  }
  const cards = $$(CARD_SEL).filter(card => !card.hasAttribute('data-storefront-product'));
  markPricesLoading();
  cards.forEach(card => setPriceStatus(card, 'loading'));
  const neededFeeds = neededPriceFeeds(cards, []);
  if (!neededFeeds.trees && !neededFeeds.decor) return;
  const { dict, decorDict } = await loadNeededPriceFeeds(neededFeeds);
  
  cards.forEach(card => setPriceStatus(card, (isDecorCard(card) ? decorDict : dict) ? 'loading' : 'error'));
  if (!dict && !decorDict) {
    console.warn('Ни одна таблица не загрузилась');
    return;
  }

  cards.forEach(card=>{
    if(card.__inited) return; card.__inited = true;

    // выпилим любые старые <select>
    card.querySelectorAll('select.category-select, select.height-select').forEach(el=>el.remove());

    const buy = card.querySelector('.buy-btn'); if(!buy) return;

    // --- ID из разметки и скрыть его ---
    // Проверяем, это декор или елка
    const idBlockDecor = card.querySelector('[data-product-id-decor]');
    const idBlock = card.querySelector('[data-product-id]');
    
    let pid = '';
    if (idBlockDecor) {
      // Для декора используем data-product-id-decor
      pid = (idBlockDecor.getAttribute('data-product-id-decor') || idBlockDecor.textContent || '').trim();
      // Извлекаем ID из текста элемента (например, "1d", "2d")
      if (!pid || pid === '') {
        const idText = idBlockDecor.querySelector('.text-block-wrap-div')?.textContent || idBlockDecor.textContent || '';
        pid = idText.trim();
      }
      // Скрываем элемент с ID декора
      idBlockDecor.style.display = 'none';
    } else if (idBlock) {
      // Для елок используем data-product-id
      pid = (idBlock.getAttribute('data-product-id') || idBlock.textContent || '').trim();
      idBlock.style.display = 'none';
    }
    
    // Также проверяем атрибуты на самой карточке
    if (!pid) {
      pid = (card.getAttribute('data-product-id') || card.getAttribute('data-id') || '').trim();
    }

    // --- текущий заголовок из верстки (чтобы заменить, если в таблице другое) ---
    const titleEl  = card.querySelector('[data-prop-title] .text-block-wrap-div, [data-prop-title]');
    const titleNow = (titleEl?.textContent || '').trim();

    // --- проверяем, это декор или елка ---
    // Декор определяется по наличию data-product-id-decor ИЛИ по наличию data-variants-decor без признаков елки
    // Если есть data-product-id-decor - это декор
    // Если есть data-variants-decor И нет data-prop-category И data-prop-height - это тоже декор
    // Если есть data-prop-category И data-prop-height - это елка
    const catTextEl = card.querySelector('[data-prop-category]');
    const hTextEl   = card.querySelector('[data-prop-height]');
    const variantsDecorEl = card.querySelector('[data-variants-decor]');
    // Декор, если есть data-product-id-decor ИЛИ (есть data-variants-decor И нет признаков елки)
    const isDecor = isDecorCard(card);

    if (isDecor) {
      // Обработка декора (без категорий и высот)
      if (!decorDict) return;
      const { byId: decorById, byTitle: decorByTitle } = decorDict;
      
      let entry = pid ? decorById.get(toId(pid)) : null;
      if (!entry) entry = decorByTitle.get(norm(titleNow));
      if (!entry){
        console.warn('нет активных строк для декора', pid || titleNow);
        setPriceStatus(card, 'unavailable');
        return; // таблица загружена, активной записи нет
      }

      setPriceStatus(card, 'ready');
      initDecorCard(card, entry, titleEl, titleNow);
      return;

      const sheetTitle = entry.title || titleNow;
      if (titleEl && sheetTitle && sheetTitle !== titleNow) {
        (titleEl.querySelector?.('.text-block-wrap-div') || titleEl).textContent = sheetTitle;
      }

      // --- описание из таблицы ---
      // Ищем элемент с описанием (обычно это элемент рядом с заголовком)
      const descEl = card.querySelector('.text--u-ibls00792, [data-product-id].text--u-ibls00792');
      if (descEl && entry.description) {
        const descSpan = descEl.querySelector('.text-block-wrap-div') || descEl;
        setHtmlWithNewlines(descSpan, entry.description);
      }

      // --- цена из таблицы (будет обновлена при выборе варианта, если есть варианты) ---
      const priceDecorEl = card.querySelector('[data-price-decor]');
      if (priceDecorEl) {
        // Если есть варианты, используем цену первого варианта из таблицы, иначе базовую цену
        const initialPrice = entry.variants && entry.variants.length > 0 
          ? (entry.variants[0].price || entry.price)
          : entry.price;
        setText(priceDecorEl, rub(initialPrice));
        // Также напрямую обновляем textContent для надежности
        const textEl = priceDecorEl.querySelector('.text-block-wrap-div');
        if (textEl) {
          textEl.textContent = rub(initialPrice);
        }
      }

      // --- фото (одно на товар — для корзины) ---
      const pic   = card.querySelector('.product__img img, .product__img__cms img, .image__img, img');
      const photo = pic?.getAttribute('data-origin-src') || pic?.currentSrc || pic?.src || '';

      // --- обработка вариантов размера ---
      const variantsDecorEl = card.querySelector('[data-variants-decor]');
      const hTextEl = card.querySelector('[data-prop-height]');
      const hasVariants = variantsDecorEl && entry.variants && entry.variants.length > 0;
      
      if (hasVariants) {
        // Есть варианты - не скрываем плашку с высотой, а заполняем её выбранным вариантом
        const firstVariant = entry.variants[0];
        const initialSize = firstVariant.size || '';
        
        // Показываем плашку с высотой и заполняем выбранным вариантом
        if (hTextEl) {
          const hLabel = hTextEl.closest('.input__catalog') || hTextEl;
          if (hLabel) {
            hLabel.style.display = '';
          }
          // Заполняем плашку размером первого варианта
          setText(hTextEl, initialSize);
        }
        
        // Устанавливаем начальные данные в кнопку «Купить»
        const initialPrice = entry.variants[0].price || entry.price;
        buy.dataset.name     = sheetTitle;
        buy.dataset.price    = initialPrice;
        buy.dataset.photo    = photo;
        buy.dataset.category = 'Декор';
        buy.dataset.height   = initialSize; // Сохраняем размер варианта в data-height
        buy.dataset.diam     = '';
        buy.dataset.branches = '';
      } else {
        // Нет вариантов - скрываем плашку с высотой и оставляем height пустым
        if (hTextEl) {
          const hLabel = hTextEl.closest('.input__catalog') || hTextEl;
          if (hLabel) {
            hLabel.style.display = 'none';
          }
        }
        
        // Данные в кнопку «Купить» без вариантов
        buy.dataset.name     = sheetTitle;
        buy.dataset.price    = entry.price;
        buy.dataset.photo    = photo;
        buy.dataset.category = 'Декор';
        buy.dataset.height   = '';
        buy.dataset.diam     = '';
        buy.dataset.branches = '';
      }
      
      if (hasVariants) {
        // Показываем поле вариантов только если есть варианты
        variantsDecorEl.style.setProperty('display', 'flex', 'important');
        variantsDecorEl.style.position = 'relative';
        variantsDecorEl.style.cursor = 'pointer';
        variantsDecorEl.style.userSelect = 'none';
        
        // Сохраняем данные вариантов в элемент
        variantsDecorEl.dataset.variants = JSON.stringify(entry.variants);
        variantsDecorEl.dataset.selectedIndex = '0';
        
        // Устанавливаем начальный вариант (первый в списке)
        const firstVariant = entry.variants[0];
        const sizeTextEl = variantsDecorEl.querySelector('.text.site-catalog__h3, .site-catalog__h3');
        if (sizeTextEl && firstVariant.size) {
          setText(sizeTextEl, firstVariant.size);
        }
        
        // Создаем dropdown список вариантов
        const list = ensureList(variantsDecorEl, 'variants-decor');
        if (list) {
          list.innerHTML = '';
          entry.variants.forEach((variant, index) => {
            const button = document.createElement('button');
            button.type = 'button';
            button.setAttribute('data-dd-option', '');
            button.setAttribute('data-variant-index', index);
            button.style.cssText = 'display:block;width:100%;text-align:left;padding:10px 12px;border:0;background:transparent;cursor:pointer';
            
            const span = document.createElement('span');
            span.className = 'site__h5 color__h3';
            // Используем полный текст варианта из таблицы (например, "120x40x60 (+200 ₽)")
            // Если нет variantText, используем size
            const label = variant.variantText || variant.size || '';
            span.textContent = label;
            button.appendChild(span);
            
            // Обработчик клика по варианту
            button.addEventListener('click', (e) => {
              e.stopPropagation();
              selectVariant(card, variantsDecorEl, entry, index);
              closeAllDD();
            });
            
            list.appendChild(button);
          });
          
          attachHover(list);
        }
        
        // Обработчик клика для открытия/закрытия dropdown
        variantsDecorEl.addEventListener('click', (e) => {
          // Не открываем dropdown, если клик был по кнопке внутри dropdown
          if (e.target.closest('[data-dd-option]')) {
            return;
          }
          
          e.stopPropagation();
          const list = variantsDecorEl.querySelector('[data-dd-list]');
          if (list) {
            // Проверяем, открыт ли dropdown (через стили и класс)
            const isCurrentlyOpen = list.style.display !== 'none' && 
                                   list.style.display !== '' && 
                                   variantsDecorEl.classList.contains('dd-open');
            closeAllDD();
            if (!isCurrentlyOpen) {
              openDD(variantsDecorEl, list);
            }
          }
        });
      }

      return; // завершаем обработку декора
    }

    // Обработка елок (с категориями и высотами)
    if (!dict) {
      console.warn('Таблица елок не загружена, пропускаем карточку:', titleNow);
      return;
    }
    
    // Проверяем, что у елки есть необходимые элементы
    if (!catTextEl || !hTextEl) {
      console.warn('У карточки нет data-prop-category или data-prop-height:', titleNow, {
        hasCategory: !!catTextEl,
        hasHeight: !!hTextEl
      });
      return; // Не обрабатываем карточку без необходимых элементов
    }
    
    const { byId, byTitle } = dict;

    // --- запись из таблицы: сначала по id, потом по названию ---
    let entry = pid ? byId.get(toId(pid)) : null;
    if (!entry) entry = byTitle.get(norm(titleNow));
    if (!entry){
      console.warn('нет активных строк для карточки', pid || titleNow, 'byId size:', byId.size, 'byTitle size:', byTitle.size);
      setPriceStatus(card, 'unavailable'); hideCard(card); return
    }
    setPriceStatus(card, 'ready');
    console.log('Найдена запись для карточки:', titleNow, 'категорий:', entry.cats.size);

    const sheetTitle = entry.title || titleNow;
    if (titleEl && sheetTitle && sheetTitle !== titleNow) {
      (titleEl.querySelector?.('.text-block-wrap-div') || titleEl).textContent = sheetTitle;
    }
      
    // --- описание из таблицы ---
    const descEl = card.querySelector('[data-prop-description]');
    const setDescForCategory = (catKey) => {
      if (!descEl) return;
      const list = entry.cats.get(catKey) || [];
      const txt  = (list[0]?.description || entry.description || '').trim();
      const wrap = (descEl.closest('.item-desc') || descEl);
      if (txt) { setHtmlWithNewlines(descEl, txt); wrap.style.display=''; }
      else { setHtmlWithNewlines(descEl, ''); wrap.style.display='none'; }
    };

    // делаем кликабельной всю плашку (обычно .input__catalog)
    const catLabel  = catTextEl.closest('.input__catalog') || catTextEl;
    const hLabel    = hTextEl.closest('.input__catalog')   || hTextEl;

    const priceNode = card.querySelector('.price .text-block-wrap-div') || card.querySelector('.price');
    const diamEl    = card.querySelector('[data-prop-diam]');
    const brEl      = card.querySelector('[data-prop-branches]');
    const oldEl     = card.querySelector('[data-prop-offer]');
    const discEl    = card.querySelector('[data-prop-discount]');

    // фото (одно на товар — для корзины)
    const pic   = card.querySelector('.product__img img, .product__img__cms img, .image__img, img');
    const photo = pic?.getAttribute('data-origin-src') || pic?.currentSrc || pic?.src || '';

    // --- категории из таблицы ---
    const cats = entry.cats;                           // <-- один раз, без дублей
    const catKeys = [...cats.keys()];
    if (catKeys.length === 0) {
      // нет ни одной активной категории/высоты — прячем карточку
      setPriceStatus(card, 'unavailable'); hideCard(card); return
    }

    // порядок категорий: сперва по CAT_ORDER, затем как есть
    const ord = k => {
      const i = CAT_ORDER.indexOf(normCat(k));
      return i >= 0 ? i : 100 + catKeys.indexOf(k);
    };
    const catKeysOrdered = catKeys.slice().sort((a,b)=>ord(a)-ord(b));

    // Туи и любые товары с единственной категорией: дропдаун категории не нужен.
    const singleCategory = catKeysOrdered.length <= 1;

    // дефолтная категория: из текста или первая по порядку
    let curCatKey = (()=>{ 
      const def = normCat(catTextEl.textContent||''); 
      return catKeys.includes(def) ? def : catKeysOrdered[0]; 
    })();
    let curCatText = cats.get(curCatKey)?.[0]?.category || (catTextEl.textContent||'').trim() || 'Категория';
    setText(catTextEl, curCatText);

    // контейнеры выпадашек (рисуются внутри кликабельных контейнеров)
    const catList = ensureList(catLabel,'category');
    const hList   = ensureList(hLabel,'height');

    // курсор-рука и отключение выделения текста
    [catLabel,hLabel].forEach(el=>{ el.style.cursor='pointer'; el.style.userSelect='none'; });

    // список категорий (в нужном порядке)
    catList.innerHTML = catKeysOrdered.map(k=>{
      const t = cats.get(k)?.[0]?.category || k;
      return `<button type="button" data-dd-option data-cat="${k}"
                style="display:block;width:100%;text-align:left;padding:10px 12px;border:0;background:transparent;cursor:pointer">
                <span class="site__h5 color__h3">${t}</span>
              </button>`;
    }).join('');
    attachHover(catList);

    // Туи: скрываем плашку категории целиком, остаётся только высота.
    if (singleCategory) {
      catLabel.style.display = 'none';
    }

    // размеры (ТОЛЬКО размер без цены)
    function renderHeights(){
      const list = cats.get(curCatKey) || [];
      if (!list.length){
        hList.innerHTML = '';
        setText(hTextEl, '—');
        return;
      }
      hList.innerHTML = list.map(o=>`
        <button type="button" data-dd-option
          data-height="${o.height}" data-price="${o.price}"
          data-d="${o.diam}" data-b="${o.branches}"
          data-offer="${o.offer}" data-discount="${o.discount}"
          style="display:block;width:100%;text-align:left;padding:10px 12px;border:0;background:transparent;cursor:pointer">
          <span class="site__h5 color__h3">${o.height} см</span>
        </button>`).join('');
      attachHover(hList);
      if(list[0]) {
        applySize(list[0]); // дефолт - применяем первую высоту
      } else {
        console.warn('Нет данных для применения размера для карточки', sheetTitle);
      }
    }

    function applySize(o){
      if(!o){
        console.warn('applySize вызван с некорректными данными:', o, 'для карточки', sheetTitle);
        return;
      }
      
      // данные в кнопку «Купить»
      buy.dataset.name     = sheetTitle;
      buy.dataset.height   = o.height || '';
      buy.dataset.price    = o.price || 0;
      if (card.__curPhoto) buy.dataset.photo = card.__curPhoto; // фото выставляет updatePhotos()
      buy.dataset.category = curCatText;
      buy.dataset.diam     = o.diam || '';
      buy.dataset.branches = o.branches || '';

      // визуал карточки
      if(priceNode) setText(priceNode, rub(o.price));
      // диаметр / кол-во веток: если значения нет — прячем всю строку свойства
      const setProp = (el, val, suffix) => {
        if (!el) return;
        const line = el.closest('.list__item') || el;
        if (val) { setText(el, `${val} ${suffix}`); line.style.display = ''; }
        else { setText(el, ''); if (line !== el) line.style.display = 'none'; }
      };
      setProp(diamEl, o.diam, 'см');
      setProp(brEl,   o.branches, 'шт.');
      setText(hTextEl, `${o.height} см`);
        
      // старая цена
      if(oldEl){
        let off = num(o.offer||0);
        const pNow = num(o.price||0);
        const pct  = Math.abs(Number(o.discount||0));
        if(!off && pNow && pct>0 && pct<100) off = Math.round(pNow/(1-pct/100));
        if(off>0){ setText(oldEl, rub(off)); oldEl.style.display=''; }
        else { setText(oldEl,''); oldEl.style.display='none'; }
      }

      // бейдж «-Х%»
      if(discEl){
        let pct = Math.abs(Number(o.discount||0));
        if(!pct){
          const pNow = num(o.price||0), off = num(o.offer||0);
          if(pNow && off && off > pNow) pct = Math.round((1 - pNow/off)*100);
        }
        setText(discEl, pct ? `-${pct}%` : '');
      }
    }

    // открыть/закрыть выпадашки
    if (!singleCategory) catLabel.addEventListener('click', e=>{
      if(e.target.closest('[data-dd-option]')) return;
      const shown = catList.style.display !== 'none';
      closeAllDD();
      if(!shown) openDD(catLabel, catList);
    });
    hLabel.addEventListener('click', e=>{
      if(e.target.closest('[data-dd-option]')) return;
      const shown = hList.style.display !== 'none';
      closeAllDD();
      if(!shown) openDD(hLabel, hList);
    });

    // выбор категории
    catList.addEventListener('click', e=>{
      const btn = e.target.closest('[data-dd-option]'); if(!btn) return;
      curCatKey  = btn.dataset.cat;
      curCatText = cats.get(curCatKey)?.[0]?.category || curCatText;
      setText(catTextEl, curCatText);
      catList.style.display='none'; catLabel.classList.remove('dd-open');

      renderHeights();
      updatePhotos(card, curCatKey);                 // обновили главное фото и card.__curPhoto

      const phList = getCsvPhotos(entry, curCatKey); // собираем ссылки из таблицы
      refreshExtraPhotos(card, curCatKey, phList, singleCategory);   // туи: показать все ракурсы

      setDescForCategory(curCatKey);
    });



    // выбор высоты
    hList.addEventListener('click', e=>{
      const b = e.target.closest('[data-dd-option]'); if(!b) return;
      applySize({
        height:   num(b.dataset.height),
        price:    num(b.dataset.price),
        diam:     num(b.dataset.d),
        branches: num(b.dataset.b),
        offer:    num(b.dataset.offer),
        discount: num(b.dataset.discount)
      });
      hList.style.display='none'; hLabel.classList.remove('dd-open');
    });

    // старт
    renderHeights();
    updatePhotos(card, curCatKey);
    const phList0 = getCsvPhotos(entry, curCatKey);
    refreshExtraPhotos(card, curCatKey, phList0, singleCategory);
    setDescForCategory(curCatKey);
  });
  // Сверка старой корзины не должна задерживать показ цен на карточках.
  if (savedCart.length) refreshPriceDicts().then(() => {
    try {
      if (revalidateCartPrices(getCart()).changed){
        console.log('Цены в сохранённой корзине обновлены до актуальных');
      }
    } catch(e){ console.warn('не удалось обновить цены сохранённой корзины', e); }
  });
})();

// === ПОПАП (поддержка нескольких товаров)
const popup=document.querySelector('[data-cart-popup]');
function getCart(){ try{return JSON.parse(localStorage.getItem(KEY)||'[]')}catch{return[]} }
function setCart(arr){ try{localStorage.setItem(KEY, JSON.stringify(arr||[]))}catch{} }
// Делаем функции глобально доступными для промокода
window.getCart = getCart;
window.setCart = setCart;
window.updateCartTotal = updateCartTotal;

// Генерируем уникальный ID товара
function getItemId(item){
  if (item.productId && item.variantId) return `${item.productId}:${item.variantId}`;
  // Для декора с вариантами используем height, для декора без вариантов - только name и category
  // Для елок всегда используем height
  const height = String(item.height || '').trim();
  const category = String(item.category || '').trim();
  const name = (item.name||'').trim();
  
  if (category === 'Декор') {
    // Для декора: если есть height (вариант), используем его для различия вариантов
    // Если height пустой (нет вариантов), используем только name и category
    if (height && height !== '') {
      // Декора с вариантом - используем height для различия вариантов
      return `${name}_${category}_${height}`;
    } else {
      // Декор без вариантов - используем только name и category
      return `${name}_${category}`;
    }
  }
  // Для елок используем name, height и category
  return `${name}_${height}_${category}`;
}

function refreshPriceDicts(){
  return loadNeededPriceFeeds(neededPriceFeeds([], getCart()), 'no-store');
}

// Обновляет цены уже лежащих в корзине товаров и перерисовывает корзину.
// Нужно для «отлежавшихся» корзин: человек добавил товар давно, цена в таблице с тех пор
// изменилась — он должен увидеть актуальную цену сразу при открытии корзины, а не при оплате.
function syncCartPricesAndRender(){
  return refreshPriceDicts().then(() => {
    const cart = getCart();
    if (!revalidateCartPrices(cart).changed) return false;
    try {
      popupCache.lastUpdate = 0;
      itemElementsCache = new WeakMap();
      fillPopup();
      updateCartTotal();
      if (typeof window.LE_Promo !== 'undefined' && window.LE_Promo.render) window.LE_Promo.render();
    } catch(e){ console.warn('не удалось перерисовать корзину после обновления цен', e); }
    return true;
  });
}

// Сверяет цены товаров в корзине с таблицей перед оплатой.
// Цена в корзине — это снимок на момент добавления товара (addToCart её не обновляет),
// а цены в таблице меняются; без этой проверки можно оплатить по устаревшей цене.
// Если товара нет в таблице или таблица не загрузилась — тихо оставляем сохранённую цену,
// чтобы не сломать оплату.
function revalidateCartPrices(cart){
  if (!Array.isArray(cart) || !cart.length) return { changed:false, raised:false };
  const freshDict = priceDict;
  const freshDecorDict = priceDecorDict;
  if (!freshDict && !freshDecorDict) return { changed:false, raised:false };
  let changed = false;
  let raised = false; // цена выросла — покупателю нельзя молча выставить больше, чем он видел
  cart.forEach(item => {
    const isDecor = String(item.category||'').trim() === 'Декор';
    const src = isDecor ? freshDecorDict : freshDict;
    if (!src) return;
    const tKey = norm(item.name||'');
    const entry = (item.productId && src.byId.get(String(item.productId).trim().toLowerCase()))
      || src.byTitle.get(tKey) || src.byTitle.get(normCat(item.name||''));
    if (!entry) return;

    // У декора своя структура таблицы: варианты размеров, а не категории/высоты как у ёлок
    let freshPrice = 0;
    if (isDecor){
      const variants = entry.variants || [];
      if (variants.length){
        // height у декора хранит размер варианта (например «120х40х60»)
        const v = item.variantId
          ? variants.find(o => o.variantId === item.variantId)
          : variants.find(o => String(o.size) === String(item.height)) || (variants.length===1 ? variants[0] : null);
        if (!v) return;
        freshPrice = num(v.price||0);
      } else {
        freshPrice = num(entry.price||0);
      }
    } else {
      const list = entry.cats?.get(normCat(item.category||''));
      if (!list || !list.length) return;
      const match = item.variantId
        ? list.find(o => o.variantId === item.variantId)
        : list.find(o => String(o.height) === String(item.height)) || (list.length===1 ? list[0] : null);
      if (!match) return;
      freshPrice = num(match.price||0);
    }
    const oldPrice = num(item.price||0);
    if (freshPrice > 0 && freshPrice !== oldPrice){
      console.log('Цена товара обновлена перед оплатой:', item.name, oldPrice, '->', freshPrice);
      item.price = freshPrice;
      if (typeof item.basePrice === 'number') item.basePrice = freshPrice;
      changed = true;
      if (freshPrice > oldPrice) raised = true;
    }
  });
  if (changed) { try{ setCart(cart); }catch(e){} }
  return { changed, raised };
}

// Добавляет товар в корзину или увеличивает количество
function addToCart(item){
  const cart = getCart();
  const itemId = getItemId(item);
  const existing = cart.findIndex(it => getItemId(it) === itemId);
  
  if(existing >= 0){
    cart[existing].qty = (cart[existing].qty || 1) + 1;
    if (item.photo && !cart[existing].photo) cart[existing].photo = item.photo;
  } else {
    cart.push({...item, qty: 1, id: itemId});
  }
  setCart(cart);
}

// Функция для восстановления скролла (агрессивная версия)
function restoreScroll(){
  try {
    // Восстанавливаем скролл на body
    if(document.body){
      // Убираем классы, блокирующие скролл
      document.body.classList.remove('no-scroll', 'overflow-hidden', 'lock-scroll', 'scroll-lock', 'modal-open');
      
      // Убираем inline стили, которые могут блокировать скролл
      const bodyStyle = document.body.getAttribute('style');
      if(bodyStyle && (bodyStyle.includes('overflow') || bodyStyle.includes('position:fixed'))){
        // Сохраняем все стили кроме overflow и position
        const styleObj = {};
        const styles = bodyStyle.split(';').filter(s => s.trim());
        styles.forEach(s => {
          const [prop, val] = s.split(':').map(x => x.trim());
          if(prop && val && !['overflow', 'overflowY', 'overflowX', 'position'].includes(prop.toLowerCase())){
            styleObj[prop] = val;
          }
        });
        // Применяем только нужные стили обратно
        const newStyle = Object.entries(styleObj).map(([k,v]) => `${k}: ${v}`).join('; ');
        if(newStyle){
          document.body.setAttribute('style', newStyle);
        } else {
          document.body.removeAttribute('style');
        }
      }
      
      // Явно устанавливаем разрешенный скролл
      document.body.style.overflow = '';
      document.body.style.overflowY = '';
      document.body.style.overflowX = '';
      if(document.body.style.position === 'fixed'){
        document.body.style.position = '';
      }
    }
    
    // Восстанавливаем скролл на html
    if(document.documentElement){
      document.documentElement.classList.remove('no-scroll', 'overflow-hidden', 'lock-scroll', 'scroll-lock', 'modal-open');
      document.documentElement.style.overflow = '';
      document.documentElement.style.overflowY = '';
      document.documentElement.style.overflowX = '';
      if(document.documentElement.style.position === 'fixed'){
        document.documentElement.style.position = '';
      }
    }
    
    // Проверяем все возможные контейнеры
    const containers = document.querySelectorAll('html, body, main, [role="main"]');
    containers.forEach(el => {
      if(el && el.style){
        if(el.style.overflow === 'hidden' || el.style.overflowY === 'hidden'){
          el.style.overflow = '';
          el.style.overflowY = '';
        }
        if(el.style.position === 'fixed'){
          el.style.position = '';
        }
      }
    });
    
    // Принудительно разрешаем скролл через событие
    try {
      window.scrollTo(0, window.scrollY);
    } catch(e){}
  } catch(e){
    console.warn('restoreScroll error:', e);
  }
}

// Удаляет товар из корзины
function removeFromCart(itemId){
  const cart = getCart();
  const filtered = cart.filter(it => getItemId(it) !== itemId);
  setCart(filtered);
  
  // Если корзина пуста - сбрасываем промокод и закрываем попап
  if(filtered.length === 0){
    // Сбрасываем промокод напрямую (не вызываем reset(), так как корзина уже пуста)
    try {
      localStorage.removeItem('lady_promo_state');
      // Очищаем поле промокода
      const promoInput = document.querySelector('[data-promo-input]');
      if(promoInput) promoInput.value = '';
      // Скрываем красную плашку со скидкой
      if(totalOfferCache){
        setText(totalOfferCache, '');
        const offerEl = totalOfferCache.closest('[data-cart-sum-offer]');
        if(offerEl && offerEl.style) offerEl.style.display = 'none';
      }
    } catch(e){}
    
    // Очищаем шаблон от старых данных перед закрытием
    if(popupCache.firstItem){
      popupCache.firstItem.removeAttribute('data-cart-item');
      popupCache.firstItem.style.display = 'none';
      // Очищаем данные товара в шаблоне
      const photoEl = popupCache.firstItem.querySelector('[data-cart-photo] img');
      if(photoEl) photoEl.src = '';
      const titleEl = popupCache.firstItem.querySelector('[data-cart-title] .text-block-wrap-div');
      if(titleEl) titleEl.textContent = 'Наименование товара';
      const categoryEl = popupCache.firstItem.querySelector('[data-cart-category] .text-block-wrap-div');
      if(categoryEl) categoryEl.textContent = 'Раздел';
      const heightEl = popupCache.firstItem.querySelector('[data-cart-height] .text-block-wrap-div');
      if(heightEl) heightEl.textContent = 'Размер';
      const sumEl = popupCache.firstItem.querySelector('[data-cart-sum] .text-block-wrap-div');
      if(sumEl) sumEl.textContent = 'Цена';
      const qtyEl = popupCache.firstItem.querySelector('.count-summ-wrapper .text .text-block-wrap-div, .count-wrapper-2 .text .text-block-wrap-div');
      if(qtyEl) qtyEl.textContent = '1 шт.';
    }
    
    // Очищаем кэш
    popupCache.firstItem = null;
    totalSumCache = null;
    totalOfferCache = null;
    itemElementsCache = new WeakMap();
    
    // Закрываем попап (несколько способов для надежности)
    if(popup){
      // Способ 1: через style
      popup.style.display = 'none';
      popup.style.visibility = 'hidden';
      popup.style.opacity = '0';
      
      // Способ 2: через атрибуты
      popup.setAttribute('hidden', '');
      popup.setAttribute('aria-hidden', 'true');
      
      // Способ 3: через классы
      popup.classList.add('hidden', 'closed');
      popup.classList.remove('open', 'active', 'show');
      
      // ВАЖНО: Восстанавливаем скролл на body и html (несколько раз для надежности)
      restoreScroll();
      setTimeout(restoreScroll, 10);
      setTimeout(restoreScroll, 50);
      setTimeout(restoreScroll, 100);
      
      // Способ 4: через кнопку закрытия
      const closeBtn = popup.querySelector('[data-cart-close], .close-btn, [aria-label*="закрыть" i], [aria-label*="close" i]');
      if(closeBtn){
        try { 
          closeBtn.click(); 
        } catch(e){
          // Если click не работает, пробуем dispatchEvent
          try {
            const clickEvent = new MouseEvent('click', { bubbles: true, cancelable: true });
            closeBtn.dispatchEvent(clickEvent);
          } catch(e2){}
        }
      }
    }
  }
}

// Изменяет количество товара
function updateCartItemQty(itemId, newQty){
  const cart = getCart();
  const item = cart.find(it => getItemId(it) === itemId);
  if(item){
    if(newQty <= 0){
      removeFromCart(itemId);
    } else {
      item.qty = Math.max(1, Math.floor(newQty));
      setCart(cart);
    }
  }
}

// Находит контейнер для товаров (первый item-wrapper__shop)
function getCartItemsContainer(){
  if(!popup) return null;
  return popup.querySelector('.item-wrapper__shop[data-cart-item]')?.parentElement || 
         popup.querySelector('.div--u-i38rwzo7k.item-wrapper__shop')?.parentElement ||
         popup.querySelector('[data-cart-photo]')?.closest('.item-wrapper__shop')?.parentElement;
}

// НЕ создаем HTML - используем существующий шаблон из HTML

// Кэш для элементов попапа (только для шаблона и места вставки)
let popupCache = {
  firstItem: null,
  bagWrapper: null,
  divider: null
};

// === Лайтбокс фотографий ===
// Работает на всех страницах. На /tree/... стрелки листают фотографии
// внутри текущего контейнера товара; на остальных страницах открывается
// только выбранное изображение.
function initImageLightbox(){
  if(window.__ladyElkaImageLightboxInit) return;
  window.__ladyElkaImageLightboxInit = true;

  const isTreePage = /^\/tree(?:\/|$)/.test(window.location.pathname);
  const denyAttr = 'data-nozoom';
  const galleryRootSelector = [
    '[data-gallery]',
    '[data-product-gallery]',
    '[data-tt-collection-item-id]',
    '.product-card',
    '.product-wrapper__cms',
    '.collection__item'
  ].join(',');
  const photoWrapSelector = [
    '.product__img',
    '.product__img__cms',
    '.product__img-dop',
    '.product__img-dop__cms',
    '[data-gallery-photo]',
    '[data-zoom-photo]'
  ].join(',');

  const style = document.createElement('style');
  style.id = 'lady-elka-image-lightbox-styles';
  style.textContent = `
    #img-zoom-overlay{
      position:fixed; inset:0; display:none;
      align-items:center; justify-content:center;
      background:rgba(0,0,0,.9); z-index:2147483647;
    }
    #img-zoom-overlay.izo-open{
      display:flex; animation:izo-fade .12s ease-out;
    }
    @keyframes izo-fade{ from{opacity:0} to{opacity:1} }
    #img-zoom-overlay .izo-holder{
      max-width:96vw; max-height:96vh;
      display:flex; align-items:center; justify-content:center;
    }
    #img-zoom-overlay .izo-media,
    #img-zoom-overlay .izo-media img{
      display:block !important;
      max-width:96vw; max-height:96vh;
      box-shadow:0 10px 40px rgba(0,0,0,.6);
      border-radius:8px; object-fit:contain;
      user-select:none; -webkit-user-drag:none;
    }
    #img-zoom-overlay .izo-close,
    #img-zoom-overlay .izo-arrow{
      position:fixed; display:flex; align-items:center;
      justify-content:center; padding:0; border:0; color:#fff;
      background:rgba(255,255,255,.12); cursor:pointer; z-index:2;
    }
    #img-zoom-overlay .izo-close{
      top:16px; right:16px; width:40px; height:40px;
      border-radius:10px; font:700 24px/1 ui-sans-serif,system-ui,Arial;
    }
    #img-zoom-overlay .izo-arrow{
      top:50%; width:44px; height:44px; margin-top:-22px;
      border:1px solid rgba(255,255,255,.28);
      border-radius:50%; font-size:0; line-height:0;
      background:rgba(0,0,0,.42);
      box-shadow:0 4px 16px rgba(0,0,0,.3);
    }
    #img-zoom-overlay .izo-arrow::before{
      content:''; display:block; width:9px; height:9px;
      border:solid #fff; border-width:0 2px 2px 0;
    }
    #img-zoom-overlay .izo-prev::before{ transform:rotate(135deg); margin-left:4px; }
    #img-zoom-overlay .izo-next::before{ transform:rotate(-45deg); margin-right:4px; }
    #img-zoom-overlay .izo-prev{ left:24px; }
    #img-zoom-overlay .izo-next{ right:24px; }
    #img-zoom-overlay .izo-close:hover,
    #img-zoom-overlay .izo-arrow:hover{ background:rgba(255,255,255,.24); }
    #img-zoom-overlay .izo-close:focus,
    #img-zoom-overlay .izo-arrow:focus{
      outline:2px solid rgba(255,255,255,.65); outline-offset:3px;
    }
    #img-zoom-overlay [hidden]{ display:none !important; }
    img.can-zoom{ cursor:zoom-in; }
    @media (max-width:600px){
      #img-zoom-overlay .izo-arrow{
        width:38px; height:38px; margin-top:-19px;
      }
      #img-zoom-overlay .izo-prev{ left:8px; }
      #img-zoom-overlay .izo-next{ right:8px; }
    }
  `;

  const overlay = document.createElement('div');
  overlay.id = 'img-zoom-overlay';
  overlay.setAttribute('role','dialog');
  overlay.setAttribute('aria-modal','true');
  overlay.tabIndex = -1;

  const holder = document.createElement('div');
  holder.className = 'izo-holder';

  const prevBtn = document.createElement('button');
  prevBtn.type = 'button';
  prevBtn.className = 'izo-arrow izo-prev';
  prevBtn.setAttribute('aria-label','Предыдущее фото');
  prevBtn.innerHTML = '&#10094;';

  const nextBtn = document.createElement('button');
  nextBtn.type = 'button';
  nextBtn.className = 'izo-arrow izo-next';
  nextBtn.setAttribute('aria-label','Следующее фото');
  nextBtn.innerHTML = '&#10095;';

  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'izo-close';
  closeBtn.setAttribute('aria-label','Закрыть');
  closeBtn.textContent = '×';

  overlay.append(holder, prevBtn, nextBtn, closeBtn);

  function mount(){
    if(!document.head.querySelector('#lady-elka-image-lightbox-styles')){
      document.head.appendChild(style);
    }
    if(document.body && !document.body.contains(overlay)){
      document.body.appendChild(overlay);
    }
  }

  function getPhotoUrl(img){
    return img.getAttribute('data-origin-src')
      || img.currentSrc
      || img.getAttribute('src')
      || '';
  }

  function isPlaceholderImage(img){
    const marker = [
      getPhotoUrl(img),
      img.getAttribute('src'),
      img.getAttribute('data-origin-src'),
      img.getAttribute('data-src'),
      img.getAttribute('alt'),
      img.className
    ].filter(Boolean).join(' ').toLowerCase();

    return /placeholder|no[-_ ]?image|no[-_ ]?photo|empty[-_ ]?image|default[-_ ]?image/.test(marker);
  }

  function isAllowedImage(img){
    if(!img || img.nodeName !== 'IMG') return false;
    if(img.hasAttribute(denyAttr) || img.closest('[' + denyAttr + ']')) return false;
    if(!getPhotoUrl(img)) return false;
    if(isPlaceholderImage(img)) return false;
    if(!img.matches('[data-zoom="on"]') && img.closest('a[href]')) return false;
    return true;
  }

  function isZoomable(img){
    if(!isAllowedImage(img)) return false;
    const box = img.getBoundingClientRect();
    return box.width >= 48 && box.height >= 48;
  }

  function markZoomables(root){
    if(!root) return;
    const images = [];
    if(root.nodeName === 'IMG') images.push(root);
    if(root.querySelectorAll) images.push(...root.querySelectorAll('img'));
    images.forEach(img=>{
      if(isZoomable(img)) img.classList.add('can-zoom');
      else img.classList.remove('can-zoom');
    });
  }

  function getGalleryRoot(img){
    return img.closest(galleryRootSelector) || img.parentElement || document;
  }

  function getGalleryImages(clickedImg){
    const root = getGalleryRoot(clickedImg);
    const candidates = Array.from(root.querySelectorAll('img'));
    if(!candidates.includes(clickedImg)) candidates.push(clickedImg);

    const result = [];
    const seenUrls = new Set();

    candidates.forEach(img=>{
      if(!isAllowedImage(img)) return;

      const inPhotoWrapper = img.closest(photoWrapSelector);
      const explicitGallery = root.matches && root.matches(
        '[data-gallery], [data-product-gallery]'
      );
      const box = img.getBoundingClientRect();
      const largeVisibleImage = box.width >= 48 && box.height >= 48;

      if(
        img !== clickedImg
        && !inPhotoWrapper
        && !explicitGallery
        && !largeVisibleImage
      ) return;

      const url = getPhotoUrl(img);
      if(!url || seenUrls.has(url)) return;

      seenUrls.add(url);
      result.push(img);
    });

    return result.length ? result : [clickedImg];
  }

  let opened = false;
  let gallery = [];
  let galleryIndex = 0;
  let previousOverflow = '';

  function renderSlide(){
    const img = gallery[galleryIndex];
    if(!img) return;

    holder.innerHTML = '';

    const picture = img.closest('picture');
    let node;

    if(picture){
      node = picture.cloneNode(true);
      node.classList.add('izo-media');
      node.removeAttribute('hidden');
      node.style.removeProperty('display');
      node.style.removeProperty('visibility');
      node.style.removeProperty('opacity');
      const clonedImg = node.querySelector('img');
      if(clonedImg){
        clonedImg.classList.add('izo-media');
        clonedImg.removeAttribute('hidden');
        clonedImg.style.removeProperty('display');
        clonedImg.style.removeProperty('visibility');
        clonedImg.style.removeProperty('opacity');
        clonedImg.decoding = 'sync';
        clonedImg.loading = 'eager';
        const url = getPhotoUrl(img);
        if(url) clonedImg.src = url;
      }
    } else {
      node = img.cloneNode(true);
      node.classList.add('izo-media');
      node.removeAttribute('hidden');
      node.style.removeProperty('display');
      node.style.removeProperty('visibility');
      node.style.removeProperty('opacity');
      node.decoding = 'sync';
      node.loading = 'eager';
      const url = getPhotoUrl(img);
      if(url) node.src = url;
    }

    holder.appendChild(node);

    const hasGallery = isTreePage && gallery.length > 1;
    prevBtn.hidden = !hasGallery;
    nextBtn.hidden = !hasGallery;
  }

  function openZoomFrom(img){
    mount();

    gallery = isTreePage ? getGalleryImages(img) : [img];
    galleryIndex = Math.max(0, gallery.indexOf(img));
    renderSlide();

    previousOverflow = document.documentElement.style.overflow;
    document.documentElement.style.overflow = 'hidden';
    overlay.classList.add('izo-open');
    opened = true;

    setTimeout(()=>overlay.focus(), 0);
  }

  function showSlide(step){
    if(!opened || gallery.length < 2) return;
    galleryIndex = (galleryIndex + step + gallery.length) % gallery.length;
    renderSlide();
  }

  function closeZoom(){
    if(!opened) return;
    overlay.classList.remove('izo-open');
    document.documentElement.style.overflow = previousOverflow;
    holder.innerHTML = '';
    gallery = [];
    galleryIndex = 0;
    opened = false;
  }

  document.addEventListener('click', e=>{
    const img = e.target.closest && e.target.closest('img');
    if(!img || overlay.contains(img) || !isZoomable(img)) return;
    e.preventDefault();
    e.stopPropagation();
    openZoomFrom(img);
  }, true);

  prevBtn.addEventListener('click', e=>{
    e.preventDefault();
    e.stopPropagation();
    showSlide(-1);
  });

  nextBtn.addEventListener('click', e=>{
    e.preventDefault();
    e.stopPropagation();
    showSlide(1);
  });

  closeBtn.addEventListener('click', closeZoom);

  overlay.addEventListener('click', e=>{
    if(e.target === overlay) closeZoom();
  });

  document.addEventListener('keydown', e=>{
    if(!opened) return;
    if(e.key === 'Escape') closeZoom();
    if(e.key === 'ArrowLeft'){
      e.preventDefault();
      showSlide(-1);
    }
    if(e.key === 'ArrowRight'){
      e.preventDefault();
      showSlide(1);
    }
  });

  const init = ()=>{
    mount();
    markZoomables(document);
  };

  if(document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', init, {once:true});
  } else {
    init();
  }

  const observer = new MutationObserver(mutations=>{
    mutations.forEach(mutation=>{
      if(mutation.type === 'childList'){
        mutation.addedNodes.forEach(node=>{
          if(node.nodeType === 1) markZoomables(node);
        });
      }

      if(
        mutation.type === 'attributes'
        && mutation.target.nodeName === 'IMG'
      ){
        markZoomables(mutation.target);
      }
    });
  });

  observer.observe(document.documentElement, {
    subtree:true,
    childList:true,
    attributes:true,
    attributeFilter:[
      'src',
      'srcset',
      'data-origin-src',
      'data-nozoom',
      'style'
    ]
  });
}

initImageLightbox();

// Заполняет попап всеми товарами из корзины (упрощенная версия)
function fillPopup(){
  if(!popup) return;
  const cart = getCart();
  
  // ВАЖНО: НЕ закрываем попап в этой функции, даже если корзина пуста!
  // Попап должен управляться только извне (при удалении всех товаров)
  
  // Находим шаблон товара (один раз, кэшируем)
  if(!popupCache.firstItem){
    popupCache.firstItem = popup.querySelector('.item-wrapper__shop:not([data-bag-wrapper]):not([data-cart-item])');
  }
  // Если шаблон не найден без data-cart-item, ищем любой и очищаем его
  if(!popupCache.firstItem){
    const anyItem = popup.querySelector('.item-wrapper__shop:not([data-bag-wrapper])');
    if(anyItem){
      // Очищаем старые данные
      anyItem.removeAttribute('data-cart-item');
      popupCache.firstItem = anyItem;
    }
  }
  if(!popupCache.firstItem) return;
  
  // Если шаблон имеет data-cart-item, но это не текущий товар - очищаем его
  if(popupCache.firstItem.hasAttribute('data-cart-item')){
    const oldItemId = popupCache.firstItem.getAttribute('data-cart-item');
    const currentItemId = cart.length > 0 ? getItemId(cart[0]) : null;
    if(oldItemId !== currentItemId){
      // Это старый товар - очищаем шаблон
      popupCache.firstItem.removeAttribute('data-cart-item');
    }
  }
  
  // Находим место для вставки (один раз, кэшируем)
  if(!popupCache.bagWrapper){
    popupCache.bagWrapper = popup.querySelector('[data-bag-wrapper]');
  }
  if(!popupCache.divider){
    popupCache.divider = popup.querySelector('.divider');
  }
  const insertBefore = popupCache.bagWrapper || popupCache.divider;
  
  // Удаляем все существующие элементы товаров (кроме шаблона)
  const allItems = Array.from(popup.querySelectorAll('.item-wrapper__shop[data-cart-item]'));
  allItems.forEach(el => {
    if(el !== popupCache.firstItem){
      el.remove();
    }
  });
  
  // Если корзина пуста - скрываем шаблон (но НЕ закрываем попап!)
  if(!cart.length){
    if(popupCache.firstItem && popupCache.firstItem.hasAttribute('data-cart-item')){
      popupCache.firstItem.removeAttribute('data-cart-item');
    }
    if(popupCache.firstItem){
      popupCache.firstItem.style.display = 'none';
    }
    // НЕ меняем display попапа здесь - только обновляем итог
    updateCartTotal();
    const form = popup.querySelector('form');
    if(form){
      for(const name of ['cart_total', 'order_price_discounted', 'Общая сумма']){
        const field = form.querySelector(`[name="${name}"]`);
        if(field) field.value = '0';
      }
      const items = form.querySelector('[name="cart_items"]');
      if(items) items.value = '[]';
      for(const name of ['order_title', 'Товар']){
        const field = form.querySelector(`[name="${name}"]`);
        if(field) field.value = '';
      }
    }
    return;
  }
  
  // Создаем элементы для всех товаров
  cart.forEach((item, i) => {
    const itemId = getItemId(item);
    let itemEl;
    
    if(i === 0){
      // Первый товар - используем шаблон
      itemEl = popupCache.firstItem;
      
      // Очищаем старые данные, если шаблон использовался для другого товара
      if(itemEl.hasAttribute('data-cart-item')){
        const oldItemId = itemEl.getAttribute('data-cart-item');
        if(oldItemId !== itemId){
          // Это другой товар - очищаем кэш элементов для этого шаблона
          itemElementsCache.delete(itemEl);
        }
      }
      
      itemEl.setAttribute('data-cart-item', itemId);
      // Убеждаемся, что элемент видим
      itemEl.style.display = '';
      itemEl.style.visibility = '';
      itemEl.style.opacity = '';
      itemEl.removeAttribute('hidden');
      // Убираем классы, которые могут скрывать элемент
      itemEl.classList.remove('hidden');
    } else {
      // Остальные - клонируем шаблон
      itemEl = popupCache.firstItem.cloneNode(true);
      itemEl.setAttribute('data-cart-item', itemId);
      itemEl.querySelectorAll('[id]').forEach(el => el.removeAttribute('id'));
      
      // Вставляем в правильное место
      if(insertBefore && insertBefore.parentElement){
        insertBefore.parentElement.insertBefore(itemEl, insertBefore);
      } else if(popupCache.firstItem.parentElement){
        popupCache.firstItem.parentElement.insertBefore(itemEl, popupCache.firstItem.nextSibling);
      }
    }
    
    // Обновляем данные товара
    if(itemEl){
      updateCartItemDisplay(itemEl, item, itemId);
    }
  });
  
  // Скрываем шаблон, если он не используется
  if(!popupCache.firstItem.hasAttribute('data-cart-item')){
    popupCache.firstItem.style.display = 'none';
  }
  
  updateCartTotal();
  // Количество и удаление меняют корзину, пока форма уже открыта.
  // Синхронизируем поля заказа вместе с видимым итогом.
  const form = popup.querySelector('form');
  if(form){
    ensureTapTopCartFields(form, cart);
    ensureOrderHiddenFields(form, cart);
  }
}

// Функция не нужна - обработчики работают напрямую с data-icons-down/up/remove

// Функция больше не нужна - используем простую перерисовку

// Функция больше не нужна - используем существующие кнопки из шаблона

// Кэш элементов товаров для быстрого доступа
let itemElementsCache = new WeakMap();

// Обновляет отображение одного товара (использует существующий шаблон)
function updateCartItemDisplay(itemEl, item, itemId){
  if(!itemEl || !item) return;
  
  // Если это шаблон с другим itemId - очищаем кэш
  const currentItemId = itemEl.getAttribute('data-cart-item');
  if(currentItemId && currentItemId !== itemId){
    itemElementsCache.delete(itemEl);
  }
  
  // Используем кэш элементов, чтобы не искать их каждый раз
  let cached = itemElementsCache.get(itemEl);
  if(!cached){
    // Ищем элементы по стандартным атрибутам (без itemId, так как они в шаблоне)
    cached = {
      ph: itemEl.querySelector('[data-cart-photo]'),
      img: null,
      tEl: itemEl.querySelector('[data-cart-title]'),
      hEl: itemEl.querySelector('[data-cart-height]'),
      cEl: itemEl.querySelector('[data-cart-category]'),
      qtyEl: itemEl.querySelector('.count-summ-wrapper .text, .count-wrapper-2 .text'),
      sEl: itemEl.querySelector('[data-cart-sum]'),
      minusBtn: itemEl.querySelector('[data-icons-down]'),
      plusBtn: itemEl.querySelector('[data-icons-up]'),
      removeBtn: itemEl.querySelector('[data-icons-remove]')
    };
    if(cached.ph){
      cached.img = cached.ph.querySelector('img');
    }
    if(cached.sEl){
      cached.sElSpan = cached.sEl.querySelector('.text-block-wrap-div') || cached.sEl;
    }
    if(cached.qtyEl){
      cached.qtyElSpan = cached.qtyEl.querySelector('.text-block-wrap-div') || cached.qtyEl;
    }
    itemElementsCache.set(itemEl, cached);
  }
  
  // Обновляем фото (всегда, чтобы убрать старые данные)
  if(cached.ph){
    if(cached.img && item.photo){
      cached.img.src = item.photo;
      cached.img.setAttribute('data-origin-src', item.photo);
      cached.img.alt = item.name;
      cached.img.classList.add('can-zoom');   // курсор-лупа (Taptop CSS) единообразно у всех фото корзины
    } else if(item.photo && !cached.img){
      cached.ph.style.backgroundImage = `url(${item.photo})`;
      cached.ph.setAttribute('aria-label', item.name);
    }
  }
  
  // Обновляем название (всегда)
  if(cached.tEl){
    const tSpan = cached.tEl.querySelector('.text-block-wrap-div') || cached.tEl;
    setText(tSpan, item.name);
  }
  
  // Обновляем категорию (всегда). Для туй (одна категория) и пустой категории — прячем плашку.
  if(cached.cEl){
    const cSpan = cached.cEl.querySelector('.text-block-wrap-div') || cached.cEl;
    const catText = String(item.category || '').trim();
    const hideCat = !catText || catText.toLowerCase() === 'туя';
    setText(cSpan, hideCat ? '' : (item.variantType ? `${catText} · ${item.variantType}` : catText));
    cached.cEl.style.display = hideCat ? 'none' : '';
  }
  
  // Обновляем размер (всегда)
  // Для декора скрываем плашку с высотой только если нет вариантов (height пустой)
  const isDecor = String(item.category || '').trim() === 'Декор';
  if(cached.hEl){
    const hSpan = cached.hEl.querySelector('.text-block-wrap-div') || cached.hEl;
    // Для декора с вариантами показываем размер как есть (без "см"), для елок - с "см"
    const hText = item.height 
      ? (isDecor ? item.height : `${item.height} см`)
      : '';
    setText(hSpan, hText);
    
    // Для декора: показываем плашку только если есть вариант (height не пустой)
    if(isDecor){
      if(item.height && String(item.height).trim() !== ''){
        // Есть вариант - показываем плашку
        cached.hEl.style.display = '';
        const hWrapper = cached.hEl.closest('.input__catalog, .height-wrapper, [data-cart-height-wrapper]');
        if(hWrapper) hWrapper.style.display = '';
      } else {
        // Нет варианта - скрываем плашку
        cached.hEl.style.display = 'none';
        const hWrapper = cached.hEl.closest('.input__catalog, .height-wrapper, [data-cart-height-wrapper]');
        if(hWrapper) hWrapper.style.display = 'none';
      }
    } else {
      // Показываем для елок
      cached.hEl.style.display = '';
      const hWrapper = cached.hEl.closest('.input__catalog, .height-wrapper, [data-cart-height-wrapper]');
      if(hWrapper) hWrapper.style.display = '';
    }
  }
  
  // Обновляем количество (всегда)
  const qty = item.qty || 1;
  if(cached.qtyElSpan){
    const qtyText = `${qty} шт.`;
    setText(cached.qtyElSpan, qtyText);
  }
  
  // Обновляем цену (цена за 1 шт, БЕЗ учета промокода) - всегда
  const pricePerUnit = item.price || 0;
  if(cached.sElSpan){
    const priceText = rub(pricePerUnit);
    setText(cached.sElSpan, priceText);
  }
  
  // Кнопки уже имеют правильные атрибуты data-icons-down/up/remove из шаблона
}

// Кэш для элемента итоговой суммы и красной плашки
let totalSumCache = null;
let totalOfferCache = null;

// Обновляет итоговую сумму корзины (оптимизированная версия с учетом промокода)
function updateCartTotal(){
  const cart = getCart();
  const baseTotal = cart.reduce((sum, item) => sum + ((item.price || 0) * (item.qty || 1)), 0);
  
  // Проверяем промокод
  let promoState = null;
  try {
    promoState = JSON.parse(localStorage.getItem('lady_promo_state')||'null');
  } catch(e){}
  
  // Проверяем, есть ли в корзине только декор
  const onlyDecor = cart.length > 0 && cart.every(item => {
    const category = String(item.category || '').trim();
    return category === 'Декор';
  });
  
  // Применяем скидку к итоговой сумме (только если не только декор)
  let finalTotal = baseTotal;
  let discountText = '';
  
  if(!onlyDecor && promoState && (promoState.rub>0 || promoState.pct>0)){
    if(promoState.rub>0){
      finalTotal = Math.max(0, baseTotal - promoState.rub);
      discountText = '-' + rub(promoState.rub);
    } else if(promoState.pct>0){
      finalTotal = Math.max(0, Math.round(baseTotal * (1 - promoState.pct/100)));
      discountText = '-' + promoState.pct + '%';
    }
  } else if(onlyDecor && promoState){
    // Если только декор, сбрасываем промокод
    try {
      localStorage.removeItem('lady_promo_state');
      const promoInput = document.querySelector('[data-promo-input]');
      if(promoInput) promoInput.value = '';
      
      // Обновляем UI промокода (вызываем render, если доступен)
      if (typeof window.LE_Promo !== 'undefined' && window.LE_Promo.render){
        window.LE_Promo.render();
      }
    } catch(e){}
  }
  
  // Используем кэш, чтобы не искать элемент каждый раз
  if(!totalSumCache || !totalOfferCache){
    const itogoWrapper = popup?.querySelector('.itogo-wrapper');
    if(itogoWrapper){
      const totalEl = itogoWrapper.querySelector('[data-cart-title=""]');
      if(totalEl && totalEl.textContent.trim().includes('Итого:')){
        // Ищем элемент с итоговой суммой - может быть следующий элемент после "Итого:"
        // или элемент с data-cart-sum без data-cart-item внутри itogo-wrapper
        let sumEl = totalEl.nextElementSibling;
        // Проверяем, что это не красная плашка
        if(sumEl && sumEl.hasAttribute('data-cart-sum-offer')){
          sumEl = null;
        }
        // Если не нашли, ищем по атрибуту
        if(!sumEl || !sumEl.hasAttribute('data-cart-sum')){
          sumEl = itogoWrapper.querySelector('[data-cart-sum]:not([data-cart-item]):not([data-cart-sum-offer])');
        }
        if(!sumEl){
          // Если нет элемента, создаем его после "Итого:"
          sumEl = document.createElement('div');
          sumEl.className = 'text site-catalog__h1 color__h2';
          sumEl.setAttribute('data-cart-sum', '');
          const span = document.createElement('span');
          span.className = 'text-block-wrap-div';
          sumEl.appendChild(span);
          // Вставляем после "Итого:" но перед красной плашкой
          const offerEl = itogoWrapper.querySelector('[data-cart-sum-offer]');
          if(offerEl){
            itogoWrapper.insertBefore(sumEl, offerEl);
          } else {
            itogoWrapper.insertBefore(sumEl, totalEl.nextSibling);
          }
        }
        totalSumCache = sumEl.querySelector('.text-block-wrap-div') || sumEl;
        
        // Ищем красную плашку со скидкой
        totalOfferCache = itogoWrapper.querySelector('[data-cart-sum-offer]');
        if(totalOfferCache){
          totalOfferCache = totalOfferCache.querySelector('.text-block-wrap-div') || totalOfferCache;
        }
      }
    }
  }
  
  // Обновляем итоговую сумму
  if(totalSumCache){
    const priceText = rub(finalTotal);
    if(totalSumCache.textContent !== priceText){
      setText(totalSumCache, priceText);
    }
  }
  
  // Обновляем красную плашку со скидкой
  if(totalOfferCache){
    const offerEl = totalOfferCache.closest('[data-cart-sum-offer]') || totalOfferCache.parentElement;
    if(discountText){
      const currentText = totalOfferCache.textContent.trim();
      if(currentText !== discountText){
        setText(totalOfferCache, discountText);
      }
      // Показываем плашку
      if(offerEl && offerEl.style) offerEl.style.display = '';
    } else {
      // Скрываем плашку, если скидки нет
      if(offerEl && offerEl.style) offerEl.style.display = 'none';
      setText(totalOfferCache, '');
    }
  }
}

// Обработчики для кнопок управления корзиной (работают напрямую с data-icons-down/up/remove)
document.addEventListener('click', e=>{
  // Ищем кнопку минус (может быть сам элемент или img внутри)
  let minus = e.target.closest(`[data-icons-down]`);
  // Если не нашли, проверяем, может быть клик по img внутри кнопки
  if(!minus && e.target.tagName === 'IMG'){
    minus = e.target.closest(`[data-icons-down]`) || e.target.parentElement?.closest(`[data-icons-down]`);
  }
  if(minus){
    e.preventDefault();
    e.stopPropagation();
    // Находим родительский элемент товара
    const itemEl = minus.closest('.item-wrapper__shop[data-cart-item]');
    if(!itemEl) {
      console.warn('Не найден элемент товара для кнопки минус');
      return;
    }
    const itemId = itemEl.getAttribute('data-cart-item');
    if(!itemId) {
      console.warn('Не найден itemId для кнопки минус');
      return;
    }
    
    const cart = getCart();
    const item = cart.find(it => getItemId(it) === itemId);
    if(item){
      const newQty = (item.qty || 1) - 1;
      const willBeEmpty = cart.length === 1 && newQty <= 0; // Будет ли корзина пуста
      
      updateCartItemQty(itemId, newQty);
      
      // Обновляем UI
      requestAnimationFrame(()=>{
        const cartAfter = getCart();
        if(cartAfter.length === 0){
          if(popup){
            popup.style.display = 'none';
            popup.setAttribute('hidden', '');
          }
        } else {
          itemElementsCache = new WeakMap();
          fillPopup();
        }
      });
    }
    return;
  }
  
  // Ищем кнопку плюс
  let plus = e.target.closest(`[data-icons-up]`);
  // Если не нашли, проверяем, может быть клик по img внутри кнопки
  if(!plus && e.target.tagName === 'IMG'){
    plus = e.target.closest(`[data-icons-up]`) || e.target.parentElement?.closest(`[data-icons-up]`);
  }
  if(plus){
    e.preventDefault();
    e.stopPropagation();
    const itemEl = plus.closest('.item-wrapper__shop[data-cart-item]');
    if(!itemEl) {
      console.warn('Не найден элемент товара для кнопки плюс');
      return;
    }
    const itemId = itemEl.getAttribute('data-cart-item');
    if(!itemId) {
      console.warn('Не найден itemId для кнопки плюс');
      return;
    }
    
    const cart = getCart();
    const item = cart.find(it => getItemId(it) === itemId);
    if(item){
      updateCartItemQty(itemId, (item.qty || 1) + 1);
      requestAnimationFrame(()=>{
        itemElementsCache = new WeakMap();
        fillPopup();
      });
    }
    return;
  }
  
  // Ищем кнопку удаления
  let remove = e.target.closest(`[data-icons-remove]`);
  // Если не нашли, проверяем, может быть клик по img внутри кнопки
  if(!remove && e.target.tagName === 'IMG'){
    remove = e.target.closest(`[data-icons-remove]`) || e.target.parentElement?.closest(`[data-icons-remove]`);
  }
  if(remove){
    e.preventDefault();
    e.stopPropagation();
    const itemEl = remove.closest('.item-wrapper__shop[data-cart-item]');
    if(!itemEl) {
      console.warn('Не найден элемент товара для кнопки удаления');
      return;
    }
    const itemId = itemEl.getAttribute('data-cart-item');
    if(!itemId) {
      console.warn('Не найден itemId для кнопки удаления');
      return;
    }
    
    const cart = getCart();
    const willBeEmpty = cart.length === 1; // Будет ли корзина пуста после удаления
    
    removeFromCart(itemId);
    
    // Всегда обновляем UI (removeFromCart уже обновил корзину)
    requestAnimationFrame(()=>{
      const cartAfter = getCart();
      if(cartAfter.length === 0){
        // Корзина пуста - removeFromCart уже должен был закрыть попап
        // Но на всякий случай проверяем и закрываем еще раз
        if(popup){
          popup.style.display = 'none';
          popup.style.visibility = 'hidden';
          popup.setAttribute('hidden', '');
          popup.classList.add('hidden');
        }
      } else {
        // Сбрасываем кэш, чтобы fillPopup перерисовал все
        popupCache.lastUpdate = 0;
        itemElementsCache = new WeakMap();
        fillPopup();
      }
    });
    return;
  }
}, true);

// Добавление товара в корзину
document.addEventListener('click',e=>{
  const btn=e.target.closest('.buy-btn'); if(!btn) return;
  
  // Проверяем, что данные установлены (но не блокируем если цена 0 - может быть еще не загружена)
  const name = (btn.dataset.name || '').trim();
  const price = num(btn.dataset.price || 0);
  
  // Блокируем только если имя пустое или "Товар" (но не блокируем по цене - она может быть 0 для некоторых товаров)
  if(!name || name === 'Товар'){
    console.warn('Кнопка "в корзину" не имеет названия:', {
      name: btn.dataset.name,
      price: btn.dataset.price,
      height: btn.dataset.height,
      category: btn.dataset.category
    });
    // Не добавляем товар без названия
    return;
  }
  
  const item={
    ...(btn.dataset.productId && btn.dataset.variantId ? {
      productId: btn.dataset.productId,
      variantId: btn.dataset.variantId,
      diameter: btn.dataset.diam || '',
      branches: btn.dataset.branches || '',
      variantType: btn.dataset.variantType || '',
    } : {}),
    name: name,
    height:btn.dataset.height||'',
    price: price,
    photo:btn.dataset.photo||'',
    category:btn.dataset.category||'',
    qty:1
  };
  addToCart(item);
  
  // Сразу проверяем корзину и открываем попап (синхронно, без задержек)
  const cart = getCart();
  if(popup && cart.length > 0){
    // Сбрасываем кэш шаблона, чтобы он был найден заново (на случай, если он был очищен)
    popupCache.firstItem = null;
    
    // Временно отключаем observer, чтобы он не мешал открытию
    if(popupObserver){
      popupObserver.disconnect();
    }

    syncCartPricesAndRender(); // подтягиваем актуальные цены в уже лежащую корзину

    // Открываем попап сразу
    popup.style.display = 'flex';
    popup.style.visibility = '';
    popup.style.opacity = '';
    popup.removeAttribute('hidden');
    popup.classList.remove('hidden', 'closed');
    wasPopupOpen = true;
    
    // Включаем observer обратно через задержку
    setTimeout(()=>{
      if(popupObserver && popup){
        popupObserver.observe(popup, {attributes:true, attributeFilter:['style','class','hidden']});
      }
    }, 500);
  }
  
  // Пересчитываем промокод и обновляем UI асинхронно
  requestAnimationFrame(()=>{
    try {
      const st = JSON.parse(localStorage.getItem('lady_promo_state')||'null');
      if (st && (st.rub>0 || st.pct>0 || st.gift)){
        const cartCheck = getCart();
        if (cartCheck.length){
          // Сохраняем базовые цены для новых товаров (НЕ меняем цены товаров!)
          var baseTotal = 0;
          cartCheck.forEach(function(cartItem){
            if (typeof cartItem.basePrice !== 'number'){
              cartItem.basePrice = num(cartItem.price || 0);
            }
            baseTotal += (cartItem.basePrice * (cartItem.qty || 1));
          });
          
          // НЕ меняем цены товаров - только обновляем baseTotal в state
          st.baseTotal = baseTotal;
          localStorage.setItem('lady_promo_state', JSON.stringify(st));
        }
      }
    } catch(e){}
    
    // Обновляем содержимое попапа
    const cartAfter = getCart();
    if(cartAfter.length > 0 && popup){
      itemElementsCache = new WeakMap();
      fillPopup();
      
      // Вызываем render промокода, если доступен
      if (typeof window.LE_Promo !== 'undefined' && window.LE_Promo.render){
        window.LE_Promo.render();
      }
      
      // Защита от закрытия: проверяем и показываем попап через небольшие задержки
      const checkAndShow = () => {
        const cartCheck = getCart();
        if(cartCheck.length > 0 && popup){
          const computed = getComputedStyle(popup);
          if(computed.display === 'none' || computed.visibility === 'hidden' || computed.opacity === '0'){
            popup.style.display = 'flex';
            popup.style.visibility = '';
            popup.style.opacity = '';
            popup.removeAttribute('hidden');
            popup.classList.remove('hidden', 'closed');
          }
        }
      };
      setTimeout(checkAndShow, 50);
      setTimeout(checkAndShow, 150);
      setTimeout(checkAndShow, 300);
      setTimeout(checkAndShow, 500);
    }
  });
}, true);

// Обработчик закрытия попапа через кнопку закрытия
if(popup){
  const closeBtn = popup.querySelector('[data-cart-close], .close-btn, [aria-label*="закрыть" i], [aria-label*="close" i], [data-close]');
  if(closeBtn){
    closeBtn.addEventListener('click', function(e){
      restoreScroll();
    }, {once: false});
  }
  
  // Также обрабатываем клики по overlay (фону попапа)
  popup.addEventListener('click', function(e){
    if(e.target === popup || e.target.classList.contains('pop-up') || e.target.hasAttribute('data-cart-popup')){
      restoreScroll();
    }
  });
}

// Легкий наблюдатель только за попапом (не за всей страницей!)
let fillPopupTimer = null;
let wasPopupOpen = false;
let isManuallyOpening = false; // Флаг для предотвращения закрытия при открытии
const popupObserver = popup ? new MutationObserver(()=>{
  // Дебаунсинг - выполняем только если попап виден
  const isOpen = popup && getComputedStyle(popup).display !== 'none';
  if(isOpen){
    // Если попап только что открылся - очищаем кэш элементов
    if(!wasPopupOpen){
      itemElementsCache = new WeakMap();
      isManuallyOpening = false; // Сбрасываем флаг после открытия
      syncCartPricesAndRender(); // цены могли измениться, пока корзина лежала — освежаем
    }
    wasPopupOpen = true;
    
    // НЕ закрываем попап в observer - только обновляем содержимое
    clearTimeout(fillPopupTimer);
    fillPopupTimer = setTimeout(()=>{
      requestAnimationFrame(()=>{
        // Проверяем корзину перед обновлением
        const cart = getCart();
        if(cart.length > 0){
          // Только обновляем содержимое, НЕ меняем display попапа
          fillPopup();
          updateCartTotal();
        }
      });
    }, 50); // небольшая задержка для батчинга изменений
  } else {
    // Если попап закрылся - восстанавливаем скролл
    if(wasPopupOpen){
      restoreScroll();
      setTimeout(restoreScroll, 10);
      setTimeout(restoreScroll, 50);
    }
    wasPopupOpen = false;
  }
}) : null;
// Наблюдаем ТОЛЬКО за попапом, не за всей страницей!
if(popupObserver && popup){
  popupObserver.observe(popup, {attributes:true, attributeFilter:['style','class','hidden']});
}

// Дополнительная защита: периодически проверяем и восстанавливаем скролл, если попап закрыт
let scrollRestoreInterval = null;
function startScrollRestoreWatch(){
  if(scrollRestoreInterval) return; // Уже запущен
  scrollRestoreInterval = setInterval(() => {
    if(popup){
      const isOpen = getComputedStyle(popup).display !== 'none' && 
                     !popup.hasAttribute('hidden') && 
                     !popup.classList.contains('hidden');
      if(!isOpen){
        // Попап закрыт - проверяем, не заблокирован ли скролл
        const bodyOverflow = getComputedStyle(document.body).overflow;
        const htmlOverflow = getComputedStyle(document.documentElement).overflow;
        if(bodyOverflow === 'hidden' || htmlOverflow === 'hidden'){
          restoreScroll();
        }
      }
    }
  }, 200); // Проверяем каждые 200мс
}

// Запускаем наблюдение за скроллом
startScrollRestoreWatch();

// === СКРИПТ 2 ===
// Открыть новую вкладку и там же получить ссылку на оплату
// Используем подход из старого скрипта: открываем новую вкладку, в ней делаем запрос к API и редиректим на оплату
(function(){
  'use strict';
  
async function openPayInNewTab(payload){
  const endpoint = String(window.PAYMENT_ENDPOINT || '').trim();
  if (!endpoint) {
    alert('Платёжный сервис не настроен');
    return;
  }

  const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) ||
                   (window.innerWidth <= 768 && 'ontouchstart' in window);
  const payWindow = isMobile ? null : window.open('', '_blank');
  if (payWindow) {
    payWindow.document.title = 'Переход к оплате';
    payWindow.document.body.textContent = 'Создаём платёж…';
  }

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const result = await response.json().catch(function(){ return {}; });
    if (!response.ok || !result.url) {
      throw new Error(result.message || result.errorMessage || result.error || 'Не удалось создать платёж');
    }
    if (payWindow && !payWindow.closed) payWindow.location.replace(result.url);
    else window.location.assign(result.url);
  } catch (error) {
    if (payWindow && !payWindow.closed) payWindow.close();
    console.error('Payment creation failed:', error);
    alert(error && error.message ? error.message : 'Не удалось создать платёж. Попробуйте ещё раз.');
  }
}

// Явно объявляем функцию глобально для доступа из других скриптов
window.openPayInNewTab = openPayInNewTab;

})(); // конец IIFE

// ————————————————— Ускоряем первое соединение
// Создание платежа и проверка статуса идут через Supabase Edge Function.
window.PAYMENT_ENDPOINT='https://mgnotvaahftrbifqtahf.supabase.co/functions/v1/pay';

// Проверяем, что функция openPayInNewTab доступна (fallback для случая, если скрипты загружаются в неправильном порядке)
// Примечание: функция уже объявлена в window в скрипте 2, но оставляем проверку на всякий случай
if (typeof window.openPayInNewTab !== 'function') {
  console.warn('openPayInNewTab не найдена в window, проверьте порядок загрузки скриптов');
}

(function preconnect(){
  const l = document.createElement('link');
  l.rel = 'preconnect';
  l.href = new URL(window.PAYMENT_ENDPOINT).origin; // только origin
  l.crossOrigin = '';
  document.head.appendChild(l);
})();

// Блокируем любые попытки увести текущую вкладку на /spasibo|/thanks
// НО: разрешаем редирект, если он приходит от PayKeeper (после оплаты)
// PayKeeper редиректит на successUrl, который мы передали при создании счета
(function lockThanksForever(){
  let allowRedirect = false;
  let redirectTimer = null;
  
  // Разрешаем редирект на 5 минут после открытия страницы оплаты
  // Это нужно для того, чтобы PayKeeper мог редиректить на successUrl после оплаты
  const checkAllowRedirect = ()=>{
    // Проверяем, есть ли в URL параметры от PayKeeper (например, orderid, invoice_id)
    const params = new URLSearchParams(window.location.search);
    const hasPayKeeperParams = params.has('orderid') || params.has('invoice_id') || params.has('id');
    
    // Если есть параметры от PayKeeper, разрешаем редирект
    if (hasPayKeeperParams) {
      allowRedirect = true;
      return true;
    }
    
    // Также разрешаем редирект, если прошло более 2 минут с момента загрузки страницы
    // Это нужно для того, чтобы PayKeeper мог редиректить после оплаты
    if (redirectTimer) return allowRedirect;
    redirectTimer = setTimeout(()=>{
      allowRedirect = true;
    }, 2 * 60 * 1000); // 2 минуты
    
    return allowRedirect;
  };
  
  const bad = (href)=>{
    if (checkAllowRedirect()) return false; // Разрешаем редирект, если он разрешен
    try{
      const u = new URL(href, location.href);
      const p = (u.pathname||'').toLowerCase();
      return /(^|\/)(spasibo|thanks)(\/|$)/i.test(p);
    }catch{ return false; }
  };
  const loc = window.location;
  const oA  = { assign: loc.assign.bind(loc), replace: loc.replace.bind(loc) };
  loc.assign  = (url,...r)=> bad(url) ? void 0 : oA.assign(url,...r);
  loc.replace = (url,...r)=> bad(url) ? void 0 : oA.replace(url,...r);
  const oH = { push: history.pushState.bind(history), rpl: history.replaceState.bind(history) };
  history.pushState    = (s,t,u)=> bad(u) ? void 0 : oH.push(s,t,u);
  history.replaceState = (s,t,u)=> bad(u) ? void 0 : oH.rpl(s,t,u);
  document.addEventListener('click',(e)=>{
    const a = e.target.closest?.('a[href]');
    if (!a) return;
    const href = a.getAttribute('href')||'';
    if (bad(href)){ e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation?.(); }
  }, true);
})();

function lockThanksRedirect(){
  const bad = (href)=>{ try{ return isThankUrl(href); }catch{ return false; } };
  const loc = window.location;
  const orig = {
    assign:  loc.assign.bind(loc),
    replace: loc.replace.bind(loc),
    push:    history.pushState.bind(history),
    rpl:     history.replaceState.bind(history),
  };
  const guard = (fn)=>(url,...rest)=>{ if (bad(url)) return; return fn(url,...rest); };
  loc.assign  = guard(orig.assign);
  loc.replace = guard(orig.replace);
  history.pushState    = (s,t,u)=> bad(u) ? void 0 : orig.push(s,t,u);
  history.replaceState = (s,t,u)=> bad(u) ? void 0 : orig.rpl(s,t,u);

  let done=false;
  const unlock = ()=>{ if(done) return; done=true;
    loc.assign=orig.assign; loc.replace=orig.replace; history.pushState=orig.push; history.replaceState=orig.rpl;
  };

  // авто-снятие: как только вкладка потеряла фокус/ушла в бэк — значит открыли платежку
  const onHide = ()=>{ if(document.hidden) unlock(); };
  document.addEventListener('visibilitychange', onHide, {once:true});
  window.addEventListener('blur', onHide, {once:true});
  // фолбек по таймеру
  setTimeout(unlock, 20000);

  return unlock;
}

// разогрев воркера при открытии попапа (один раз)
const warmPayLink = (()=> {
  let fired = false;
  return ()=> {
    if (fired) return; fired = true;
    fetch(window.PAYMENT_ENDPOINT, {method:'GET', mode:'no-cors', cache:'no-store', keepalive:true}).catch(()=>{});
  };
})();

if (popup){
  new MutationObserver(()=>{
    try{
      const vis = getComputedStyle(popup).display !== 'none';
      if (vis) {
        warmPayLink();
        updatePayUI();
        neuterPayAnchors();
        const cart = getCart();
        const form = popup.querySelector('form');
        if (cart.length && form){
          purgeLegacyHiddenFields(form);
          ensureTapTopCartFields(form, cart);
          ensureOrderHiddenFields(form, cart);
        }
      }
    }catch{}
  }).observe(popup, {attributes:true, attributeFilter:['style','class']});
}

// ————————————————— Валидация полей попапа
function validatePopupForm(form){
  const nameEl  = form?.querySelector('input[type="text"], [name="name"], [name="fio"]');
  const mailEl  = form?.querySelector('input[type="email"], [name="email"]');
  const phoneEl = form?.querySelector('input[type="tel"],   [name="phone"]');

  // ищем именно чекбокс согласия (по name/id с подсрокой "agree")
  // стало:
  // ---- Согласие (чекбокс)
  const agreeEl =
    form?.querySelector('[data-type-field="checkbox_group"][data-agree] input[type="checkbox"]') ||
    form?.querySelector('label[data-agree] input[type="checkbox"]') ||
    form?.querySelector(
      'input[type="checkbox"][data-agree], ' +
      'input[type="checkbox"][name*="agree" i], input[type="checkbox"][id*="agree" i], ' +
      'input[type="checkbox"][name*="соглас" i], input[type="checkbox"][id*="соглас" i], ' +
      'input[type="checkbox"][name*="privacy" i], input[type="checkbox"][name*="policy" i]'
    );

  if (agreeEl){
    agreeEl.required = true;
    agreeEl.removeAttribute('readonly');

    // ВАЖНО: подсвечиваем именно контейнер поля, а не label
    const agreeWrap =
      agreeEl.closest('[data-type-field="checkbox_group"][data-agree]') ||
      agreeEl.closest('.form__field') ||
      agreeEl.closest('[data-agree]');

    const syncError = () => agreeWrap?.classList.toggle('is-error', !agreeEl.checked);
    syncError();

    // нативная ошибка
    agreeEl.setCustomValidity(agreeEl.checked ? '' : 'Поставьте галочку согласия на обработку данных');
    agreeEl.addEventListener('change', () => { agreeEl.setCustomValidity(''); syncError(); });
  }
  
  // имя не обязательно
  if (nameEl) { nameEl.removeAttribute('required'); nameEl.removeAttribute('pattern'); }

  if (mailEl)  mailEl.required  = true;
  if (phoneEl){
    phoneEl.required = true;
    // Убираем HTML pattern (вызывает ошибку), используем только JavaScript валидацию
    phoneEl.removeAttribute('pattern');
    phoneEl.title = 'Введите телефон: минимум 10 цифр (можно со скобками и дефисами)';
    
    // Валидация через JavaScript
    const validatePhone = () => {
      const value = phoneEl.value.replace(/[^\d]/g, '');
      const isValid = value.length >= 10;
      phoneEl.setCustomValidity(isValid ? '' : 'Введите телефон: минимум 10 цифр');
      return isValid;
    };
    
    phoneEl.addEventListener('input', validatePhone);
    phoneEl.addEventListener('blur', validatePhone);
  }

  // нативные подсказки
  try{
    if (form?.reportValidity && !form.reportValidity()) return false;
  }catch(e){
    // если браузер споткнулся об чужие атрибуты — идем дальше, у нас своя проверка
  }

  // тихая проверка на всякий случай
  const emailOk = !!(mailEl?.value||'').trim().match(/^[^\s@]+@[^\s@]+\.[^\s@]+$/);
  const phoneOk = ((phoneEl?.value||'').replace(/[^\d]/g,'')).length >= 10;
  const agreeOk = !!(agreeEl && agreeEl.checked);

  return (emailOk && phoneOk && agreeOk);
}

// Создаёт невидимое ТЕКСТОВОЕ поле, которое TapTop отправит в Телеграм
function upsertTTTextField(form, label, value, key){
  let wrap = form.querySelector(`[data-le-key="${key}"]`);
  if(!wrap){
    wrap = document.createElement('div');
    wrap.className = 'form__field input-wrapper__form';      // без is-removed
    wrap.setAttribute('data-type-field','text');
    wrap.setAttribute('data-le-key', key);
    // прячем — но НЕ display:none
    Object.assign(wrap.style, {position:'absolute', left:'-10000px', width:'1px', height:'1px', overflow:'hidden'});

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'form__input input__form site__h4 color__h2';
    input.placeholder = label;   // так поле будет подписано в Телеге
    input.name = label;          // ОБЯЗАТЕЛЬНО
    input.setAttribute('aria-hidden','true');
    input.tabIndex = -1;

    wrap.appendChild(input);
    form.appendChild(wrap);
  }
  wrap.querySelector('input').value = String(value ?? '');
}
  
function purgeLegacyHiddenFields(form){
  // &#x26A0;️ НЕ трогаем реальные поля конструктора с именами на русском
  // и системные TapTop: cart_total / cart_items

  // старые/наши служебные имена, если вдруг остались
  const legacyNames = [
    'order_title','order_amount','title','sum','amount',
    'product_name','product_category','product_height_cm','product_price','promo_code'
  ];
  legacyNames.forEach(n=>{
    form.querySelectorAll(`input[name="${n}"]`).forEach(el=>el.remove());
  });

  // выпиливаем только «наши» фантомные поля
  form.querySelectorAll('[data-le-key]').forEach(el=>el.remove());
}
  
function ensureTapTopCartFields(form, items){
  // items может быть массивом или одним товаром (для обратной совместимости)
  const cart = Array.isArray(items) ? items : (items ? [items] : getCart());
  if(!cart.length) return;
  
  const ensureHidden = (name, val) => {
    let el = form.querySelector(`[name="${name}"]`);
    if (!el){ el = document.createElement('input'); el.type='hidden'; el.name=name; form.appendChild(el); }
    el.value = String(val ?? '');
  };

  // Итоговая сумма (числом) - сумма всех товаров с учетом количества и промокода
  const baseTotal = cart.reduce((sum, item) => {
    const price = Number(String(item.price||0).replace(/[^\d.-]/g,'')) || 0;
    const qty = Number(item.qty||1);
    return sum + (price * qty);
  }, 0);
  
  // Применяем промокод к итоговой сумме
  let finalTotal = baseTotal;
  try {
    const promoState = JSON.parse(localStorage.getItem('lady_promo_state')||'null');
    if(promoState && promoState.rub>0){
      finalTotal = Math.max(0, baseTotal - promoState.rub);
    } else if(promoState && promoState.pct>0){
      finalTotal = Math.max(0, Math.round(baseTotal * (1 - promoState.pct/100)));
    }
  } catch(e){}
  
  ensureHidden('cart_total', finalTotal);

  // Массив товаров в JSON — то, что TapTop ждёт в e-commerce форме
  let ci = form.querySelector('[name="cart_items"]');
  if (!ci){ ci = document.createElement('input'); ci.type='hidden'; ci.name='cart_items'; form.appendChild(ci); }
  ci.value = JSON.stringify(cart.map(item => ({
    title:     item.name || 'Товар',
    price:     Number(String(item.price||0).replace(/[^\d.-]/g,'')) || 0,
    qty:       Number(item.qty||1),
    category:  item.category || '',
    height_cm: item.height || ''
  })));
}
    
function ensureOrderHiddenFields(form, items){
  // items может быть массивом или одним товаром (для обратной совместимости)
  const cart = Array.isArray(items) ? items : (items ? [items] : getCart());
  if(!cart.length) return;
  
  // 0) промокод (по желанию)
  let promoCode = '';
  try { const st = JSON.parse(localStorage.getItem('lady_promo_state'))||{}; promoCode = (st.code||'').trim(); } catch{}

  const haveReal = haveBuilderFields(form);

  // 1) скрытые поля для CRM – используем ДРУГИЕ имена, чтобы не конфликтовать
  const ensureHidden = (name, val) => {
    let el = form.querySelector(`[name="${name}"]`);
    if (!el){ el = document.createElement('input'); el.type='hidden'; el.name=name; form.appendChild(el); }
    el.value = String(val ?? '');
  };
  
  // Для нескольких товаров сохраняем список через разделитель
  // Первый товар для обратной совместимости
  const firstItem = cart[0];
  const itemsList = cart.map(item => {
    const price = Number(String(item.price||0).replace(/[^\d.-]/g,'')) || 0;
    const qty = Number(item.qty||1);
    const itemTotal = price * qty;
    return `${formatCartItem(item)}${qty > 1 ? ` x${qty}` : ''} ${itemTotal} ₽`;
  }).join('; ');
  
  const baseTotal = cart.reduce((sum, item) => sum + ((item.price || 0) * (item.qty || 1)), 0);
  
  // Применяем промокод к итоговой сумме
  let totalPrice = baseTotal;
  try {
    const promoState = JSON.parse(localStorage.getItem('lady_promo_state')||'null');
    if(promoState && promoState.rub>0){
      totalPrice = Math.max(0, baseTotal - promoState.rub);
    } else if(promoState && promoState.pct>0){
      totalPrice = Math.max(0, Math.round(baseTotal * (1 - promoState.pct/100)));
    }
  } catch(e){}
  
  // если нужны тех. поля — используем нейтральные имена
  // В order_title уже есть вся информация (название, высота, категория, количество)
  ensureHidden('order_title',             itemsList || firstItem.name || '');
  // Категория и высота уже включены в order_title, не дублируем
  ensureHidden('order_price_discounted',  String(totalPrice || 0));
  // ensureHidden('order_promocode', promoCode); // опционально

  // 2) Что уйдёт в Телеграм:
  if (haveReal){
    // Заполняем РЕАЛЬНЫЕ поля TapTop и прячем их визуально (без display:none)
    // Для нескольких товаров заполняем все товары с их параметрами
    if(cart.length > 1){
      fillBuilderFieldsMultiple(form, cart);
    } else {
      fillBuilderFields(form, firstItem);
    }
  } else {
    // Фолбэк: создаём «текстовые» фантомные поля (TapTop их тоже отправит)
    // Формируем читаемый список товаров с параметрами и ценами
    const itemsListDetailed = cart.map(item => {
      const price = Number(String(item.price||0).replace(/[^\d.-]/g,'')) || 0;
      const qty = Number(item.qty||1);
      const itemTotal = price * qty;
      
      const parts = [formatCartItem(item)];
      if(qty > 1) parts.push(`x${qty}`);
      parts.push(`${itemTotal} ₽`);
      return parts.join(' ');
    }).join('; ');
    
    upsertTTTextField(form, 'Товар',             itemsListDetailed || firstItem.name || '',                 'le-item-name');
    // Категория и высота уже включены в поле "Товар", не дублируем
    upsertTTTextField(form, 'Общая сумма', String(totalPrice || 0),         'le-item-price-discounted'); // итоговая сумма с промокодом
  }
}

// Тихая отправка формы в фоновый iframe (без перезагрузки страницы)
// ВАЖНО: для TapTop нужно отправлять форму напрямую, чтобы данные дошли до бота
function platformSubmit(form){
  if (!(form instanceof HTMLFormElement)) return;

  // Проверяем, есть ли у формы action (TapTop форма)
  const hasAction = form.getAttribute('action') && form.getAttribute('action') !== '#';
  
  if (hasAction) {
    // Для TapTop отправляем форму напрямую, но в скрытый iframe
    // Это нужно, чтобы TapTop получил данные, но страница не перезагрузилась
    let fr = document.getElementById('le-silent-frame');
    if (!fr){
      fr = document.createElement('iframe');
      fr.id = 'le-silent-frame';
      fr.name = 'le-silent-frame';
      Object.assign(fr.style, {
        position:'fixed', left:'-9999px', top:'-9999px',
        width:'1px', height:'1px', opacity:'0', border:'0'
      });
      document.body.appendChild(fr);
    }
    const prevTarget = form.getAttribute('target');
    form.setAttribute('target', 'le-silent-frame');

    // Отправляем форму
    if (typeof form.requestSubmit === 'function') {
      form.requestSubmit();
    } else {
      const tmp = document.createElement('button');
      tmp.type = 'submit';
      tmp.style.display = 'none';
      form.appendChild(tmp);
      tmp.click();
      tmp.remove();
    }

    // Вернуть target после тика
    setTimeout(()=> {
      if (prevTarget != null) form.setAttribute('target', prevTarget);
      else form.removeAttribute('target');
    }, 0);
  }
}
    
// === РЕЖИМ ОПЛАТЫ: определяем по селекту и меняем кнопку
function findPaySelects(){
  // Берем любые <select>, где в опциях есть слово "Оплата"
  return Array.from(popup?.querySelectorAll('select') || []).filter(s=>{
    return Array.from(s.options||[]).some(o=>/оплата/i.test(o.textContent||''));
  });
}

function getPayMode(){
  const s = findPaySelects()[0]; // если селектов два — бери первый; нужно другой — поменяй индекс
  const val = (s?.selectedOptions?.[0]?.textContent || '').toLowerCase();
  // Если выбран текст типа "Оплата при получении" → режим наложки (cod)
  return /при\s*получении/.test(val) ? 'cod' : 'card';
}

function updatePayUI(){
  const btn = popup?.querySelector('[data-pay-now]');
  if(!btn) return;

  const mode = getPayMode();
  btn.dataset.payMode = mode;

  const span = btn.querySelector('.text-block-wrap-div');
  if (span){
    // Запоминаем оригинальную надпись, чтобы вернуть в режиме "картой"
    if (!btn.__origTxt) btn.__origTxt = (span.textContent || '').trim() || 'купить';
    span.textContent = (mode === 'cod') ? 'Оформить заказ' : btn.__origTxt;
  }
}

// Реагируем на смену селектов оплаты (и любых select в попапе)
document.addEventListener('change', e=>{
  if (e.target.closest && e.target.closest('select')) updatePayUI();
}, true);

// При открытии попапа дернем начальную установку
try{ updatePayUI(); }catch{}

// CAPTURE-хендлер, чтобы обогнать TapTop
document.addEventListener('click', async (ev)=>{
  const payBtn = ev.target.closest('[data-pay-now]');
  if (!payBtn || !payBtn.closest('[data-cart-popup]')) return;

  // Проверяем, что кнопка не заблокирована
  if (payBtn.hasAttribute('disabled') || payBtn.hasAttribute('data-busy')) return;

  const form = payBtn.closest('form');

  // Сначала проверяем режим оплаты ДО блокировки событий
  // Для наложки не блокируем стандартное поведение
  const mode = getPayMode(); // 'card' | 'cod'
  
  // валидация
  if (!validatePopupForm(form)){
    form?.reportValidity?.();
    return;
  }

  // товары из корзины обязательны
  const cart = getCart();
  if (!cart.length) { alert('Корзина пуста'); return; }
  // Подтягиваем актуальные цены из таблицы перед оплатой.
  // Если цена выросла — не списываем молча больше, чем показали: обновляем корзину и просим подтвердить.
  {
    const priceCheck = revalidateCartPrices(cart);
    if (priceCheck.changed){
      itemElementsCache = new WeakMap();
      fillPopup();
      if (typeof window.LE_Promo !== 'undefined' && window.LE_Promo.render) window.LE_Promo.render();
      if (priceCheck.raised){
        alert('Цена на товар в корзине изменилась. Проверьте, пожалуйста, сумму и нажмите оплату ещё раз.');
        return;
      }
    }
  }

  // НАЛОЖКА: отправляем форму стандартным способом, TapTop сам обработает и сделает редирект
  if (mode === 'cod'){
    try {
      // Синхронизируем форму (Телега/CRM) - заполняем поля товара и общей суммы
      if (form){
        fillPopup();
        purgeLegacyHiddenFields(form);
        ensureTapTopCartFields(form, cart);
        ensureOrderHiddenFields(form, cart);
      }
      
      // Разблокируем редирект, чтобы TapTop мог сам редиректить на страницу благодарности
      const unlock = lockThanksRedirect();
      unlock();
      
      // Добавляем обработчик submit формы, чтобы гарантировать, что поля заполнены
      // в момент отправки (TapTop может обрабатывать форму через submit, а не через click)
      const submitHandler = (submitEv) => {
        // Убеждаемся, что поля заполнены перед отправкой
        ensureTapTopCartFields(form, cart);
        ensureOrderHiddenFields(form, cart);
      };
      form.addEventListener('submit', submitHandler, { once: true });
      
      // ВАЖНО: НЕ блокируем стандартное поведение - позволяем TapTop самому обработать клик
      // TapTop должен сам обработать клик на кнопке и отправить форму
      // Поля уже заполнены синхронно выше, поэтому TapTop их увидит
      // Просто возвращаемся, не вызывая preventDefault - это позволит событию всплыть дальше
      return;
      
    } catch (e) {
      console.error('Error submitting form:', e);
      alert('Ошибка при отправке заказа. Попробуйте еще раз.');
      return;
    }
  }

  // Для оплаты картой блокируем стандартное поведение
  // ЖЕСТКО глушим любые действия платформы и другие обработчики
  ev.preventDefault();
  ev.stopPropagation();
  if (ev.stopImmediatePropagation) ev.stopImmediatePropagation();

  // синхронизируем форму (Телега/CRM)
  if (form){
    fillPopup();
    purgeLegacyHiddenFields(form);
    ensureTapTopCartFields(form, cart);
    ensureOrderHiddenFields(form, cart);
  }

  // КАРТОЙ: идем за ссылкой на оплату во ВКЛАДКЕ
  let promoCode = '';
  try {
    const st = JSON.parse(localStorage.getItem('lady_promo_state'))||{};
    promoCode = (st.code||'').trim();
  } catch{}

  // UI-лоадер
  payBtn.setAttribute('disabled','');
  payBtn.setAttribute('data-busy','1');
  const txtEl = payBtn.querySelector('.text-block-wrap-div');
  const oldTxt = txtEl?.textContent; if (txtEl) txtEl.textContent = 'Создаю ссылку…';

  // контакты
  const name  = form?.querySelector('input[type="text"], [name="name"], [name="fio"]')?.value || '';
  const email = form?.querySelector('input[type="email"], [name="email"]')?.value || '';
  const phone = form?.querySelector('input[type="tel"],   [name="phone"]')?.value || '';
  
  // Адрес доставки
  const address = form?.querySelector('input[placeholder*="Адрес"], input[placeholder*="адрес"]')?.value || '';
  
  // Способ связи (Telegram/WhatsApp/Позвонить)
  // Ищем select, который содержит опции с Telegram/WhatsApp (не тот, что для оплаты)
  const allSelects = form?.querySelectorAll('select') || [];
  let contactPref = '';
  for (const select of allSelects) {
    const options = Array.from(select.options || []);
    const hasContactOptions = options.some(opt => 
      /telegram|whatsapp|позвонить/i.test(opt.textContent || opt.value || '')
    );
    if (hasContactOptions) {
      const selectedOption = options.find(opt => opt.selected);
      if (selectedOption) {
        contactPref = selectedOption.textContent || selectedOption.value || '';
        break;
      }
    }
  }

  // ВАЖНО: блокируем редиректы ПЕРЕД вызовом API
  const unlock = lockThanksRedirect();
  
  try{
    // чтобы Телега/CRM получили сумму/товар
    fillPopup();
    purgeLegacyHiddenFields(form);
    ensureTapTopCartFields(form, cart);
    ensureOrderHiddenFields(form, cart);

    // один общий oid на клик
    const firstItem = cart[0];
    const oid = `LE-${Date.now()}-${firstItem?.height||''}`;

    // Описание с адресом, способом связи и промокодом
    // ВАЖНО: добавляем цену каждого товара и используем разделитель " | " для парсинга на стороне сервера
    const itemsList = cart.map(item => {
      const price = Number(String(item.price||0).replace(/[^\d.-]/g,'')) || 0;
      const qty = Number(item.qty||1);
      const itemTotal = price * qty;
      return `${formatCartItem(item)}${qty > 1 ? ` x${qty}` : ''} — ${itemTotal} ₽`;
    }).join(' | ');
    let descr = itemsList;
    if (name) descr += ` | Покупатель: ${name}`;
    if (email) descr += ` | Почта: ${email}`;
    if (phone) descr += ` | Телефон: ${phone}`;
    if (address) descr += ` | Адрес: ${address}`;
    if (contactPref) descr += ` | Связь: ${contactPref}`;
    if (promoCode) descr += ` | Промо: ${promoCode}`;
    descr = descr.trim();

    if (!cart.length) { 
      unlock();
      alert('Корзина пуста'); 
      return; 
    }
    
    // Сумма всех товаров с учетом количества и промокода
    const baseAmount = cart.reduce((sum, item) => {
      const price = Number(String(item.price||0).replace(/[^\d.-]/g,'')) || 0;
      const qty = Number(item.qty||1);
      return sum + (price * qty);
    }, 0);
    
    // Применяем промокод
    let totalAmount = baseAmount;
    let promoDiscountLabel = '';
    let promoGiftLabel = '';
    try {
      const promoState = JSON.parse(localStorage.getItem('lady_promo_state')||'null');
      if(promoState && promoState.rub>0){
        totalAmount = Math.max(0, baseAmount - promoState.rub);
        promoDiscountLabel = `${promoState.rub} ₽`;
      } else if(promoState && promoState.pct>0){
        totalAmount = Math.max(0, Math.round(baseAmount * (1 - promoState.pct/100)));
        promoDiscountLabel = `${promoState.pct}% (${Math.max(0, baseAmount - totalAmount)} ₽)`;
      }
      if (promoState && promoState.gift) promoGiftLabel = promoState.giftText || 'да';
    } catch(e){}
    if (promoDiscountLabel) descr += ` | Скидка по промокоду: ${promoDiscountLabel}`;
    if (promoGiftLabel) descr += ` | Подарок по промокоду: ${promoGiftLabel}`;
        
    const payload = {
      amount: totalAmount,
      description: descr,
      email, phone,
      orderId: oid,
      clientId: (name || '').trim() || 'Леди Елка',
      successUrl: location.origin + `/spasibo?oid=${encodeURIComponent(oid)}`,
      failUrl:    location.origin + `/pay-return?fail=1&oid=${encodeURIComponent(oid)}`,
      promoCode: promoCode || '',
      address: address || '',
      contactPref: contactPref || ''
    };

    if (payload.amount <= 0 || !Number.isFinite(payload.amount)) { 
      unlock();
      alert('Сумма оплаты нулевая'); 
      return; 
    }

    // Вызываем функцию получения ссылки (она сама откроет новую вкладку и сделает запрос к API)
    // Используем window.openPayInNewTab для явного доступа к глобальной функции
    const payFn = window.openPayInNewTab || openPayInNewTab;
    if (typeof payFn !== 'function') {
      unlock();
      alert('Функция оплаты не загружена. Перезагрузите страницу.');
      return;
    }
    payFn(payload);
    
    // КРИТИЧНО: после успешного открытия ссылки на оплату - НЕ даём TapTop делать редирект
    // Отправляем форму тихо в фоне (для CRM/Telegram), но БЕЗ редиректа
    platformSubmit(form);
    
    // Блокировка остаётся активной дольше, чтобы предотвратить любые редиректы
    setTimeout(unlock, 3000); // уменьшаем время блокировки, так как запрос делается в новой вкладке
    
  } catch(e) {
    // Если ошибка - сразу разблокируем
    unlock();
    console.error('Pay link error:', e);
    alert('Не удалось создать ссылку на оплату: ' + (e?.message || 'неизвестная ошибка'));
  } finally {
    payBtn.removeAttribute('disabled');
    payBtn.removeAttribute('data-busy');
    if (txtEl && oldTxt) txtEl.textContent = oldTxt;
  }
}, true);
    
// Глушим ранние события платформы на кнопке оплаты (только для мыши, не для touch)
// На мобильных устройствах touch события должны работать нормально
// ВАЖНО: не блокируем для режима "Оплата при получении" (cod)
['pointerdown','mousedown','mouseup','pointerup'].forEach(type=>{
  document.addEventListener(type, (ev)=>{
    const btn = ev.target.closest?.('[data-pay-now]');
    if (!btn || !btn.closest('[data-cart-popup]')) return;
    // Блокируем только если это не touch событие
    if (ev.pointerType === 'touch' || ev.type.startsWith('touch')) return;
    // Не блокируем для режима "Оплата при получении" (cod)
    const mode = btn.dataset.payMode || getPayMode();
    if (mode === 'cod') {
      return; // Разрешаем стандартное поведение для наложки
    }
    ev.preventDefault();
    ev.stopPropagation();
    ev.stopImmediatePropagation?.();
  }, true); // capture
});

// Добавляем обработчик для touch событий на мобильных устройствах
// Обрабатываем touchstart, чтобы перехватить событие до того, как форма сабмитится
let touchStartTime = 0;
let touchStartTarget = null;
let touchStartPos = null;

document.addEventListener('touchstart', (ev)=>{
  const payBtn = ev.target.closest?.('[data-pay-now]');
  if (!payBtn || !payBtn.closest('[data-cart-popup]')) return;
  
  touchStartTime = Date.now();
  touchStartTarget = payBtn;
  touchStartPos = {
    x: ev.touches[0]?.clientX || 0,
    y: ev.touches[0]?.clientY || 0
  };
  
  // Не блокируем touchstart, чтобы не мешать прокрутке
}, true);

document.addEventListener('touchend', async (ev)=>{
  const payBtn = ev.target.closest?.('[data-pay-now]');
  if (!payBtn || !payBtn.closest('[data-cart-popup]')) return;
  
  // Проверяем, что это тот же элемент, что и в touchstart
  if (touchStartTarget !== payBtn) return;
  
  // Проверяем, что touch был коротким (не прокрутка)
  const touchDuration = Date.now() - touchStartTime;
  if (touchDuration > 300) {
    touchStartTarget = null;
    return; // слишком долго - это прокрутка
  }
  
  // Проверяем, что палец не сдвинулся далеко (не прокрутка)
  if (touchStartPos && ev.changedTouches[0]) {
    const deltaX = Math.abs(ev.changedTouches[0].clientX - touchStartPos.x);
    const deltaY = Math.abs(ev.changedTouches[0].clientY - touchStartPos.y);
    if (deltaX > 10 || deltaY > 10) {
      touchStartTarget = null;
      return; // палец сдвинулся - это прокрутка
    }
  }
  
  // Вызываем обработчик клика напрямую (как будто это был клик)
  const form = payBtn.closest('form');
  if (!form) return;
  
  // Проверяем валидацию
  if (!validatePopupForm(form)) {
    form?.reportValidity?.();
    touchStartTarget = null;
    return;
  }
  
  // Сначала проверяем режим оплаты ДО блокировки событий
  // Для наложки не блокируем стандартное поведение
  const mode = getPayMode();
  const cart = getCart();
  if (!cart.length) {
    alert('Корзина пуста');
    touchStartTarget = null;
    return;
  }
  // Подтягиваем актуальные цены из таблицы перед оплатой (см. revalidateCartPrices)
  {
    const priceCheck = revalidateCartPrices(cart);
    if (priceCheck.changed){
      itemElementsCache = new WeakMap();
      fillPopup();
      if (typeof window.LE_Promo !== 'undefined' && window.LE_Promo.render) window.LE_Promo.render();
      if (priceCheck.raised){
        alert('Цена на товар в корзине изменилась. Проверьте, пожалуйста, сумму и нажмите оплату ещё раз.');
        touchStartTarget = null;
        return;
      }
    }
  }
  
  // НАЛОЖКА: отправляем форму стандартным способом, TapTop сам обработает и сделает редирект
  if (mode === 'cod') {
    try {
      // Синхронизируем форму (Телега/CRM) - заполняем поля товара и общей суммы
      if (form) {
        fillPopup();
        purgeLegacyHiddenFields(form);
        ensureTapTopCartFields(form, cart);
        ensureOrderHiddenFields(form, cart);
      }
      
      // Разблокируем редирект, чтобы TapTop мог сам редиректить на страницу благодарности
      const unlock = lockThanksRedirect();
      unlock();
      
      // Добавляем обработчик submit формы, чтобы гарантировать, что поля заполнены
      // в момент отправки (TapTop может обрабатывать форму через submit, а не через click)
      const submitHandler = (submitEv) => {
        // Убеждаемся, что поля заполнены перед отправкой
        ensureTapTopCartFields(form, cart);
        ensureOrderHiddenFields(form, cart);
      };
      form.addEventListener('submit', submitHandler, { once: true });
      
      // ВАЖНО: НЕ блокируем стандартное поведение - позволяем TapTop самому обработать клик
      // TapTop должен сам обработать клик на кнопке и отправить форму
      // Просто возвращаемся, не вызывая preventDefault
      // Это позволит TapTop обработать событие клика и отправить форму со всеми данными
      touchStartTarget = null;
      return;
      
    } catch (e) {
      console.error('Error submitting form:', e);
      alert('Ошибка при отправке заказа. Попробуйте еще раз.');
      touchStartTarget = null;
      return;
    }
  }
  
  // Для оплаты картой блокируем стандартное поведение
  // Блокируем стандартное поведение
  ev.preventDefault();
  ev.stopPropagation();
  if (ev.stopImmediatePropagation) ev.stopImmediatePropagation();
  
  // Синхронизируем форму
  if (form) {
    fillPopup();
    purgeLegacyHiddenFields(form);
    ensureTapTopCartFields(form, cart);
    ensureOrderHiddenFields(form, cart);
  }
  
  // КАРТОЙ: открываем оплату
  let promoCode = '';
  try {
    const st = JSON.parse(localStorage.getItem('lady_promo_state'))||{};
    promoCode = (st.code||'').trim();
  } catch{}
  
  // UI-лоадер
  payBtn.setAttribute('disabled','');
  payBtn.setAttribute('data-busy','1');
  const txtEl = payBtn.querySelector('.text-block-wrap-div');
  const oldTxt = txtEl?.textContent; if (txtEl) txtEl.textContent = 'Создаю ссылку…';
  
  // Контакты
  const name  = form?.querySelector('input[type="text"], [name="name"], [name="fio"]')?.value || '';
  const email = form?.querySelector('input[type="email"], [name="email"]')?.value || '';
  const phone = form?.querySelector('input[type="tel"],   [name="phone"]')?.value || '';
  
  // Адрес доставки
  const address = form?.querySelector('input[placeholder*="Адрес"], input[placeholder*="адрес"]')?.value || '';
  
  // Способ связи (Telegram/WhatsApp/Позвонить)
  // Ищем select, который содержит опции с Telegram/WhatsApp (не тот, что для оплаты)
  const allSelects = form?.querySelectorAll('select') || [];
  let contactPref = '';
  for (const select of allSelects) {
    const options = Array.from(select.options || []);
    const hasContactOptions = options.some(opt => 
      /telegram|whatsapp|позвонить/i.test(opt.textContent || opt.value || '')
    );
    if (hasContactOptions) {
      const selectedOption = options.find(opt => opt.selected);
      if (selectedOption) {
        contactPref = selectedOption.textContent || selectedOption.value || '';
        break;
      }
    }
  }
  
  // Блокируем редиректы
  const unlock = lockThanksRedirect();
  
  try {
    const firstItem = cart[0];
    const oid = `LE-${Date.now()}-${firstItem?.height||''}`;
    
    // Описание с адресом, способом связи и промокодом
    // ВАЖНО: добавляем цену каждого товара и используем разделитель " | " для парсинга на стороне сервера
    const itemsList = cart.map(item => {
      const price = Number(String(item.price||0).replace(/[^\d.-]/g,'')) || 0;
      const qty = Number(item.qty||1);
      const itemTotal = price * qty;
      return `${formatCartItem(item)}${qty > 1 ? ` x${qty}` : ''} — ${itemTotal} ₽`;
    }).join(' | ');
    let descr = itemsList;
    if (name) descr += ` | Покупатель: ${name}`;
    if (email) descr += ` | Почта: ${email}`;
    if (phone) descr += ` | Телефон: ${phone}`;
    if (address) descr += ` | Адрес: ${address}`;
    if (contactPref) descr += ` | Связь: ${contactPref}`;
    if (promoCode) descr += ` | Промо: ${promoCode}`;
    descr = descr.trim();
    
    // Сумма всех товаров с учетом количества и промокода
    const baseAmount = cart.reduce((sum, item) => {
      const price = Number(String(item.price||0).replace(/[^\d.-]/g,'')) || 0;
      const qty = Number(item.qty||1);
      return sum + (price * qty);
    }, 0);
    
    // Применяем промокод
    let totalAmount = baseAmount;
    let promoDiscountLabel = '';
    let promoGiftLabel = '';
    try {
      const promoState = JSON.parse(localStorage.getItem('lady_promo_state')||'null');
      if(promoState && promoState.rub>0){
        totalAmount = Math.max(0, baseAmount - promoState.rub);
        promoDiscountLabel = `${promoState.rub} ₽`;
      } else if(promoState && promoState.pct>0){
        totalAmount = Math.max(0, Math.round(baseAmount * (1 - promoState.pct/100)));
        promoDiscountLabel = `${promoState.pct}% (${Math.max(0, baseAmount - totalAmount)} ₽)`;
      }
      if (promoState && promoState.gift) promoGiftLabel = promoState.giftText || 'да';
    } catch(e){}
    if (promoDiscountLabel) descr += ` | Скидка по промокоду: ${promoDiscountLabel}`;
    if (promoGiftLabel) descr += ` | Подарок по промокоду: ${promoGiftLabel}`;
    
    const payload = {
      amount: totalAmount,
      description: descr,
      email, phone,
      orderId: oid,
      clientId: (name || '').trim() || 'Леди Елка',
      successUrl: location.origin + `/spasibo?oid=${encodeURIComponent(oid)}`,
      failUrl:    location.origin + `/pay-return?fail=1&oid=${encodeURIComponent(oid)}`,
      promoCode: promoCode || '',
      address: address || '',
      contactPref: contactPref || ''
    };
    
    if (payload.amount <= 0 || !Number.isFinite(payload.amount)) {
      unlock();
      alert('Сумма оплаты нулевая');
      touchStartTarget = null;
      return;
    }
    
    const payFn = window.openPayInNewTab || openPayInNewTab;
    if (typeof payFn !== 'function') {
      unlock();
      alert('Функция оплаты не загружена. Перезагрузите страницу.');
      touchStartTarget = null;
      return;
    }
    
    payFn(payload);
    platformSubmit(form);
    setTimeout(unlock, 3000);
    
  } catch(e) {
    unlock();
    console.error('Pay link error:', e);
    alert('Не удалось создать ссылку на оплату: ' + (e?.message || 'неизвестная ошибка'));
  } finally {
    payBtn.removeAttribute('disabled');
    payBtn.removeAttribute('data-busy');
    if (txtEl && oldTxt) txtEl.textContent = oldTxt;
    touchStartTarget = null;
  }
}, true);

// убираем href у обертки-кнопки, если это <a>
function neuterPayAnchors(){
  document.querySelectorAll('[data-cart-popup] a[href]').forEach(a=>{
    const href = a.getAttribute('href')||'';
    if (isThankUrl(href)) {
      a.dataset._href = href;
      a.removeAttribute('href');
    }
  });
  // и вокруг кнопки оставляем как было:
  document.querySelectorAll('[data-cart-popup] [data-pay-now]').forEach(btn=>{
    const a = btn.closest('a[href]'); if (!a) return;
    a.dataset._href = a.getAttribute('href');
    a.removeAttribute('href');
  });
}
neuterPayAnchors();

// Enter по форме: удерживаем сабмит для "картой", пропускаем для "при получении"
document.addEventListener('submit',(e)=>{
  const form = e.target;
  if (!(form instanceof HTMLFormElement)) return;
  if (!form.closest('[data-cart-popup]')) return;

  if (!validatePopupForm(form)){ 
    e.preventDefault(); 
    e.stopPropagation(); 
    if (e.stopImmediatePropagation) e.stopImmediatePropagation();
    form.reportValidity?.(); 
    return; 
  }

  const mode = getPayMode();
  
  if (mode === 'card'){        // карта — не сабмитим, открываем оплату
    e.preventDefault(); 
    e.stopPropagation(); 
    if (e.stopImmediatePropagation) e.stopImmediatePropagation();
    
    // Имитируем клик на кнопку оплаты
    const payBtn = form.querySelector('[data-pay-now]');
    if (payBtn) {
      payBtn.dispatchEvent(new PointerEvent('click',{bubbles:true, cancelable:true}));
    }
    return;
  }
  
  // COD — НЕ блокируем отправку формы, чтобы TapTop получил данные
  // Но предотвращаем перезагрузку страницы, если форма отправляется в iframe
  const formTarget = form.getAttribute('target');
  if (formTarget === 'le-silent-frame') {
    // Форма уже настроена на отправку в iframe - не блокируем
    return; // Разрешаем стандартную отправку
  }
}, true);


// === СКРИПТ 4 ===
/* PROMO v4-lite — TapTop совместимо, без "", с тост-уведомлениями снизу по центру */
(function(){
  // Адрес базы промокодов задаётся один раз в src/catalog/config.js.
  var CART_KEY  = 'cart';
  var PROMO_KEY = 'lady_promo_state'; // {code,rub,pct,basePrice}

  // ===== utils
  function toNum(s){ return Number(String(s||'').replace(/[^\d.-]/g,'')); }
  function rub(n){ return (Number(n)||0).toLocaleString('ru-RU')+' ₽'; }
  // Используем глобальную norm из основного скрипта (она определена выше как const)
  // Если недоступна, создаем локальную версию
  var norm = function(s){ 
    // Пытаемся использовать глобальную norm из основного скрипта
    if (typeof window !== 'undefined' && window.norm && typeof window.norm === 'function') {
      return window.norm(s);
    }
    // Локальная версия
    return String(s||'').trim().toLowerCase().replace(/[ёЁ]/g,'е').replace(/\s+/g,' ');
  };
  function setTxt(node, txt){
    if(!node) return;
    var span = node.querySelector ? node.querySelector('.text-block-wrap-div') : null;
    if (span){ span.textContent = txt; } else { node.textContent = txt; }
  }

  // ===== Тост-уведомления (всегда используются; не зависим от верстки формы)
  function ensureToastHost(){
    var host = document.getElementById('le-toast-host');
    if (!host){
      host = document.createElement('div');
      host.id = 'le-toast-host';
      host.style.position = 'fixed';
      host.style.left = '50%';
      host.style.bottom = '20px';
      host.style.transform = 'translateX(-50%)';
      host.style.zIndex = '2147483647';
      host.style.display = 'flex';
      host.style.flexDirection = 'column';
      host.style.gap = '10px';
      host.style.pointerEvents = 'none';
      document.body.appendChild(host);
    }
    return host;
  }
  function toast(text, type, ms){
    var host = ensureToastHost();
    var box = document.createElement('div');

    // эмодзи без прямого символа в коде (CMS не перекодирует)
    var ico =
      type === 'ok'   ? String.fromCodePoint(0x2705)            : // &#x2705;
      type === 'warn' ? String.fromCodePoint(0x26A0, 0xFE0F)    : // &#x26A0;️
                        String.fromCodePoint(0x274C);             // &#x274C;

    // если вдруг осталось что-то вроде "&#x2705;" — превратим в эмодзи
    ico = ico.replace(/&#x([0-9a-f]+);/gi, (_,h)=>String.fromCodePoint(parseInt(h,16)));

    box.textContent = ico + ' ' + String(text||'');

    // ваши стили
    box.style.pointerEvents = 'auto';
    box.style.padding = '10px 14px';
    box.style.borderRadius = '12px';
    box.style.boxShadow = '0 10px 24px rgba(0,0,0,.15)';
    box.style.font = '14px/1.35 system-ui, -apple-system, Segoe UI, Roboto, Arial';
    box.style.background = type==='ok' ? '#e8f9ee' : (type==='warn' ? '#fff6e5' : '#ffecec');
    box.style.border = '1px solid ' + (type==='ok' ? '#86d3a0' : (type==='warn' ? '#f0c36d' : '#f1a7a7'));
    box.style.transition = 'transform .18s ease, opacity .18s ease';
    box.style.opacity = '0'; box.style.transform = 'translateY(6px)';

    host.appendChild(box);
    setTimeout(()=>{ box.style.opacity='1'; box.style.transform='translateY(0)'; }, 10);
    var ttl = (typeof ms==='number' && ms>0) ? ms : 2400;
    setTimeout(()=>{ box.style.opacity='0'; box.style.transform='translateY(6px)'; }, ttl-220);
    setTimeout(()=>{ box.remove(); }, ttl);
  }

  // ===== cart (используем функции из основного скрипта, если доступны)
  function getCart(){ 
    // Используем глобальную функцию, если доступна
    if (typeof window.getCart === 'function') return window.getCart();
    try { return JSON.parse(localStorage.getItem(CART_KEY)||'[]')||[]; } catch(e){ return []; } 
  }
  function setCart(arr){ 
    // Используем глобальную функцию, если доступна
    if (typeof window.setCart === 'function') return window.setCart(arr);
    try { localStorage.setItem(CART_KEY, JSON.stringify(arr||[])); } catch(e){} 
  }

  // ===== promo state
  function getPromoState(){
    try{
      var raw = localStorage.getItem(PROMO_KEY);
      if (raw && raw !== 'null') return JSON.parse(raw);
    }catch(e){}
    return null;
  }
  function setPromoState(st){
    try{ localStorage.setItem(PROMO_KEY, JSON.stringify(st||null)); }catch(e){}
  }

  // ===== UI
  function ui(){
    var btn   = document.querySelector('[data-promo-apply]');
    var input = document.querySelector('[data-promo-input]');
    var sum   = document.querySelector('[data-cart-sum] .text-block-wrap-div') || document.querySelector('[data-cart-sum]');
    var oldT  = document.querySelector('[data-cart-sum-old] .text-block-wrap-div') || document.querySelector('[data-cart-sum-old]');
    // элемент с текстом о скидке (бывш. "") — переименован
    var saleTxt = document.querySelector('[data-cart-sum-offer] .text-block-wrap-div') || document.querySelector('[data-cart-sum-offer]');
    var oldWrap = null;
    var ow = document.querySelector('[data-cart-sum-old]');
    if (ow && ow.closest){ oldWrap = ow.closest('.offer-wrapper__product'); }
    if (!oldWrap){ oldWrap = document.querySelector('.offer-wrapper__product'); }
    var form = null;
    if (btn && btn.closest){ form = btn.closest('form'); }
    return {btn:btn, input:input, sumTxt:sum, oldWrap:oldWrap, oldTxt:oldT, saleTxt:saleTxt, form:form};
  }

  // ===== render
  function render(){
    var u = ui();
    var cart = getCart(); if(!cart.length) return;

    var st = getPromoState();
    var promoActive = !!(st && (st.rub>0 || st.pct>0 || st.gift));

    // Используем updateCartTotal для обновления итога и красной плашки
    if (typeof window.updateCartTotal === 'function'){
      window.updateCartTotal();
    } else {
      // Fallback если функция недоступна
      updateCartTotal();
    }
    
    // Обновляем кнопку промокода
    if (u.btn){
      u.btn.setAttribute('data-mode', promoActive ? 'reset' : 'apply');
      var t = u.btn.querySelector('.text-block-wrap-div');
      if (t) t.textContent = promoActive ? 'сбросить' : 'активировать';
    }
    // Обновляем поле ввода: если промокод применен - показываем код, если нет - очищаем
    if (u.input) {
      if (st && st.code) {
        u.input.value = st.code;
      } else {
        u.input.value = '';
      }
    }
      
    // показываем ВСЕ такие блоки и перебиваем чужие inline-стили
    document.querySelectorAll('[data-bag-wrapper]').forEach(bag=>{
      const show = !!(st && st.gift);
      bag.toggleAttribute('data-on', show);
      bag.style.setProperty('display', show ? 'flex' : 'none', 'important'); // страхуемся от inline
    });
      
    // обновим hidden в форме (если есть) - используем итоговую сумму с учетом промокода
    if (u.form){
      var ct = u.form.querySelector('[name="cart_total"]');
      var ci = u.form.querySelector('[name="cart_items"]');
      
      // Рассчитываем итоговую сумму с учетом промокода
      var baseTotal = cart.reduce(function(sum, item){
        return sum + (toNum(item.price || 0) * (item.qty || 1));
      }, 0);
      
      var finalTotal = baseTotal;
      if(st && st.rub>0){
        finalTotal = Math.max(0, baseTotal - st.rub);
      } else if(st && st.pct>0){
        finalTotal = Math.max(0, Math.round(baseTotal * (1 - st.pct/100)));
      }
      
      if (ct) ct.setAttribute('value', String(finalTotal));
      if (ci){
        try{
          var arr = JSON.parse(ci.value||'[]');
          // Обновляем цены всех товаров (без изменений - цены товаров не меняются)
          if (arr && Array.isArray(arr)){
            arr.forEach(function(item, idx){
              if (cart[idx]) item.price = toNum(cart[idx].price || 0);
            });
            ci.value = JSON.stringify(arr);
          }
        }catch(e){}
      }
    }
  }

  // ===== CSV промокодов
  function promoCsvParse(t){
    var out=[], row=[], i=0, c="", q=false;
    while(i<t.length){
      var h=t[i];
      if(q){
        if(h=='"' && t[i+1]=='"'){ c+='"'; i+=2; continue; }
        if(h=='"'){ q=false; i++; continue; }
        c+=h; i++; continue;
      }
      if(h=='"'){ q=true; i++; continue; }
      if(h==','){ row.push(c); c=""; i++; continue; }
      if(h=='\n'){ row.push(c); out.push(row.slice()); row.length=0; c=""; i++; continue; }
      if(h=='\r'){ i++; continue; }
      c+=h; i++;
    }
    if(c.length || row.length){ row.push(c); out.push(row); }
    return out;
  }
  var PROMO_CACHE = null;
  function loadPromos(cb){
    if (PROMO_CACHE){ cb(PROMO_CACHE); return; }
    fetch(PROMO_SHEET_CSV_URL, {cache:'no-store'})
      .then(function(r){ return r.text(); })
      .then(function(txt){
        var rows = promoCsvParse(txt);
        var obj = {};
        if (!rows.length){ PROMO_CACHE = obj; cb(obj); return; }
        var head = rows.shift().map(function(h){ return String(h||'').trim().toLowerCase(); });
        function col(names){
          for (var i=0;i<names.length;i++){ var idx=head.indexOf(names[i]); if(idx>=0) return idx; }
          return -1;
        }
        // нужно
        var iCode = col(['promocode','promo','code','код','промокод','прмокод']);
        var iRub  = col(['ruble-offer','ruble','rub-off','rub','скидка в рублях','руб','рубли']);
        var iPct  = col(['percent-offer','percent','pct','%','скидка в %','процент','проценты']);
        var iGift = col(['gift-offer','gift','gift_offer','подарок']);
        for (var r=0; r<rows.length; r++){
          var row = rows[r];
          var code = norm(row[iCode]||''); if(!code) continue;
          var rubV = toNum(String(row[iRub]||'').replace(',','.'));
          var pctV = toNum(String(row[iPct]||'').replace(',','.'));
          var giftRaw = iGift>=0 ? String(row[iGift]||'').trim() : '';
          var gift = /сумк/i.test(giftRaw); // работает ТОЛЬКО для сумки — как и хотели

          obj[code] = { rub: rubV, pct: pctV, gift: gift, giftRaw: giftRaw };
        }
        PROMO_CACHE = obj; cb(obj);
      })
      .catch(function(err){
        console.warn('Promo CSV load error:', err);
        toast('База промокодов не загрузилась', 'err', 3000);
        cb({});
      });
  }

  // ===== apply/reset
  function applyByInput(){
    var u = ui();
    var cart = getCart(); if(!cart.length){ toast('Добавьте товар в корзину', 'warn'); return; }
    
    // Проверяем, есть ли в корзине только декор
    var onlyDecor = cart.length > 0 && cart.every(function(item){
      var category = String(item.category || '').trim();
      return category === 'Декор';
    });
    if(onlyDecor){
      toast('Промокоды не применяются к декору', 'warn');
      return;
    }
    
    var codeRaw = (u.input && u.input.value) ? u.input.value : '';
    var code    = norm(codeRaw);
    if (!code){ toast('Введите промокод', 'warn'); return; }

    var cur = getPromoState();
    // Если промокод был сброшен (cur === null), можно вводить новый
    if (!cur) {
      // Промокод не применен, продолжаем обработку
    } else if (cur && (cur.rub>0 || cur.pct>0 || cur.gift) && norm(cur.code)!==code){
      toast('Уже применён промокод «' + cur.code + '». Сначала сбросьте.', 'warn', 3000);
      return;
    } else if (cur && norm(cur.code)===code){
      resetPromo(); 
      return;
    }

    loadPromos(function(list){
      var rec = list[code];
      if (!rec){ toast('Промокод не подходит', 'err'); return; }
      // раньше тут отбрасывали, если 0; теперь оставляем, если есть подарок
      if (!(rec.rub>0 || rec.pct>0 || rec.gift)){
        toast('Промокод не дает ни скидку, ни подарок', 'warn'); return;
      }

      // Сохраняем базовые цены для всех товаров (НЕ меняем цены товаров!)
      var baseTotal = 0;
      cart.forEach(function(item){
        if (typeof item.basePrice !== 'number'){
          item.basePrice = toNum(item.price || 0);
        }
        baseTotal += (item.basePrice * (item.qty || 1));
      });
      
      // НЕ меняем цены товаров - только сохраняем информацию о промокоде
      // Скидка будет применяться только к итоговой сумме

      // сохраняем подарок в state
      setPromoState({
        code:(codeRaw||'').trim(),
        rub:rec.rub||0,
        pct:rec.pct||0,
        baseTotal:baseTotal,
        gift: !!rec.gift,
        giftText: rec.giftRaw||''
      });

      render();
      toast(rec.gift && (rec.rub>0||rec.pct>0) ? 'Скидка и подарок активированы' :
            rec.gift ? 'Подарок активирован' : 'Промокод активирован', 'ok');
    });
  }

  function resetPromo(){
    var cart = getCart(); if(!cart.length){ toast('Корзина пуста', 'warn'); return; }
    var st = getPromoState(); if(!st){ toast('Промокод еще не применен', 'warn'); return; }
    
    // Удаляем basePrice (цены товаров не менялись, так что восстанавливать нечего)
    cart.forEach(function(item){
      delete item.basePrice;
    });
    setCart(cart);
    setPromoState(null);

    var u = ui(); if (u.input) u.input.value = '';
    render();

    document.querySelectorAll('[data-bag-wrapper]').forEach(bag=>{
      bag.removeAttribute('data-on');
      bag.style.setProperty('display','none','important');
    });

    toast('Промокод сброшен', 'ok');
  }

  // Делегируем на документ, но в CAPTURE, и душим чужие хендлеры
  document.addEventListener('click', function(e){
    var btn = e.target.closest && e.target.closest('[data-promo-apply]');
    if (!btn) return;

    // стопаем все родные действия TapTop по data-action-element и псевдо href="/"
    e.preventDefault();
    e.stopPropagation();
    if (e.stopImmediatePropagation) e.stopImmediatePropagation();

    var mode = btn.getAttribute('data-mode') || 'apply';
    if (mode === 'reset') resetPromo();
    else applyByInput();
  }, true); // ← ВАЖНО: true = capture
    
  // Нажал Enter в поле промокода — применяем, а не сабмитим форму
  document.addEventListener('keydown', function(e){
    if (e.key !== 'Enter') return;
    var input = e.target.closest && e.target.closest('[data-promo-input]');
    if (!input) return;

    e.preventDefault();
    e.stopPropagation();
    if (e.stopImmediatePropagation) e.stopImmediatePropagation();

    applyByInput();
  }, true);

  // Стартовая отрисовка и синхронизация
  render();
  window.addEventListener('storage', function(ev){
    if (ev && (ev.key===PROMO_KEY || ev.key===CART_KEY)){ render(); }
  });
    
  // Экспорт пары функций наружу (на всякий, может пригодиться)
  window.LE_Promo = Object.assign({}, window.LE_Promo, {
    reset: resetPromo,
    apply: applyByInput,
    state: getPromoState,
    render: render
  });

  // Обновляем UI при показе попапа И пересчитываем промокод при открытии
  var popupEl = document.querySelector('[data-cart-popup]');
  function isOpen(el){
    if (!el) return false;
    const cs = getComputedStyle(el);
    return cs.display !== 'none' && cs.visibility !== 'hidden' && !el.hasAttribute('hidden');
  }
  if (popupEl){
    var wasOpen = isOpen(popupEl);
    new MutationObserver(function(){
      try{
        const nowOpen = isOpen(popupEl);
        
        // только что ОТКРЫЛИ попап — пересчитываем промокод, если он был применен
        if (!wasOpen && nowOpen){
          const st = getPromoState();
          if (st && (st.rub>0 || st.pct>0 || st.gift)){
            // Промокод был применен, пересчитываем с новыми данными корзины
            var cart = getCart();
            if (cart.length){
              // Сохраняем базовые цены для всех товаров (НЕ меняем цены товаров!)
              var baseTotal = 0;
              cart.forEach(function(item){
                if (typeof item.basePrice !== 'number'){
                  item.basePrice = toNum(item.price || 0);
                }
                baseTotal += (item.basePrice * (item.qty || 1));
              });
              
              // НЕ меняем цены товаров - только обновляем baseTotal в state
              st.baseTotal = baseTotal;
              setPromoState(st);
              
              // Обновляем итоговую сумму и красную плашку
              if (typeof window.updateCartTotal === 'function'){
                window.updateCartTotal();
              }
            }
          }
        }
        
        // всегда держим суммы/текст в актуале
        render();
        
        wasOpen = nowOpen;
      }catch(e){}
    }).observe(popupEl, { attributes:true, attributeFilter:['style','class','hidden'] });
  }
})();
