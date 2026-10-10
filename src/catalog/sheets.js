import { fetchPriceCSV } from './price-recovery.js';
// Загрузка CSV каталога и построение словарей byId / byTitle.
import { SHEET_CSV_URL, DECOR_SHEET_CSV_URL } from './config.js';
import { num, normCat, parseCSV } from './utils.js';

// === ТАБЛИЦА -> dict[title] = Map(category -> [{height,price,diam,branches,offer,discount,categoryRaw}])
const normId = s => String(s||'').trim().toLowerCase();

export async function loadDict(cache = 'default'){
  const csv = await fetchPriceCSV(SHEET_CSV_URL, cache);
  const rows = parseCSV(csv); if(!rows.length) throw new Error('csv empty');
  const head = rows.shift().map(h => String(h||'').trim().toLowerCase().replace(/[ё]/g,'е'));

  const alias = {
    id: ['id','код','sku','артикул'],
    discount_pct:['discount_pct','discount','сумма скидки','скидка'],
    title:['title','наименование','товар'],
    category:['category','категория'],
    height_cm:['height_cm','высота'],
    price:['price','новая цена','цена','цена на таблице'],
    diameter_cm:['diameter_cm','диаметр'],
    branches:['branches','кол-во веток','количество веток'],
    offer:['offer','цена без скидки','старая цена'],
    photos:['photos','фото','картинки','галерея'],
    active:['active','актив','активно','показывать','show','visible'],
    description:['description','описание','desc']
  };
  const col = k => (alias[k]||[]).map(a=>head.indexOf(a)).find(i=>i>=0);
  ['title','category','height_cm','price'].forEach(k=>{
    if (col(k)==null) throw new Error('нет колонки: '+k);
  });

  const byId = new Map();     // idKey -> { title, cats: Map(catKey -> list) }
  const byTitle = new Map();  // tKey  -> { title, cats: ... }

  const ensure = (map, key, title) => {
    if (!key) return null;
    if (!map.has(key)) map.set(key,{title:title||'', cats:new Map()});
    const e = map.get(key);
    if (title && !e.title) e.title = title;
    return e;
  };

  for (const r of rows){
    const idRaw = col('id')!=null ? (r[col('id')]||'') : '';
    const idKey = normId(idRaw);
    const tRaw  = (r[col('title')]||'').trim();
    const tKey  = normCat(tRaw);
    const cRaw  = (r[col('category')]||'').trim(); const cKey = normCat(cRaw);
    const h = num(r[col('height_cm')]||''); const p = num(r[col('price')]||'');
    const d = num(r[col('diameter_cm')]||''); const b = num(r[col('branches')]||'');
    const off = num(r[col('offer')]||'');
    const dpctRaw = (col('discount_pct')!=null?(r[col('discount_pct')]||''):'')+'';
    const dpct = num(dpctRaw.replace('%',''));
    const desc = col('description')!=null ? (r[col('description')]||'').trim() : '';
    const phRaw  = col('photos')!=null ? (r[col('photos')]||'') : '';
    const photos = phRaw.split('|').map(photo => photo.trim()).filter(Boolean);
    // вместо aRaw/isActive
    const iActive = col('active');
    const hasActiveCol = iActive != null;
    const aRaw = hasActiveCol ? (r[iActive] ?? '') : '';

    const isActive = (() => {
      if (!hasActiveCol) return true; // нет колонки — работаем как раньше
      const s = String(aRaw).trim().toLowerCase();
      if (s === '') return false;     // колонка есть, но пусто — считаем как НЕТ галочки
      const YES = new Set(['1','true','t','да','yes','y','on','ok','✓','&#x2714;','истина']);
      const NO  = new Set(['0','false','f','нет','no','n','off','x','✗','×','-','ложь']);
      if (YES.has(s)) return true;
      if (NO.has(s))  return false;
      const n = Number(s.replace(',','.'));
      return !Number.isNaN(n) ? n > 0 : false; // все непонятное — выключаем
    })();


    if(!cRaw || !h || !p) continue;
    if(!isActive) continue; // теперь реально игнорит FALSE и ко

    [ ensure(byId,idKey,tRaw), ensure(byTitle,tKey,tRaw) ].filter(Boolean).forEach(entry=>{
      if(!entry.cats.has(cKey)) entry.cats.set(cKey,[]);
      entry.cats.get(cKey).push({
        variantId: `${idRaw}:${cRaw}:${h}`,
        height:h,
        price:p,
        diam:d||'',
        branches:b||'',
        offer:off||'',
        discount:dpct||0,
        category:cRaw,
        description: desc || '',       // ← сохраняем описание на уровне категории
        photos
      });
      // (опционально, можно оставить общий fallback)
      if (desc && !entry.description) entry.description = desc;
    });

  }
  const sort = e => e && e.cats.forEach(list=>list.sort((a,b)=>a.height-b.height));
  byId.forEach(sort); byTitle.forEach(sort);
  return { byId, byTitle };
}

// Загрузка таблицы декора (только название и цена)
export async function loadDecorDict(cache = 'default'){
  const csv = await fetchPriceCSV(DECOR_SHEET_CSV_URL, cache);
  const rows = parseCSV(csv); if(!rows.length) throw new Error('decor csv empty');
  const head = rows.shift().map(h => String(h||'').trim().toLowerCase().replace(/[ё]/g,'е'));

  const alias = {
    id: ['id','код','sku','артикул'],
    title:['title','наименование','товар'],
    category:['category','категория','тип'],
    price:['price','оригинальная цена','цена','цена на таблице'],
    description:['description','описание','desc'],
    photos:['photos','фото','картинки','галерея'],
    active:['active','актив','активно','показывать','show','visible'],
    variants:['variants','варианты','вариант','размеры']
  };
  const col = k => (alias[k]||[]).map(a=>head.indexOf(a)).find(i=>i>=0);
  ['title','price'].forEach(k=>{
    if (col(k)==null) throw new Error('нет колонки декора: '+k);
  });

  const byId = new Map();     // idKey -> { title, price, description, photos, variants }
  const byTitle = new Map();  // tKey  -> { title, price, description, photos, variants }

  // Промежуточное хранилище для группировки вариантов по ID
  const variantsByProductId = new Map(); // idKey -> [{ variant, price, description, photos }]

  // Извлечение размера из строки варианта типа "120x40x40" или "120x40x60 (+200 ₽)"
  function extractSize(variantsStr) {
    if (!variantsStr || !variantsStr.trim()) return null;
    // Ищем размер (формат: числахчислахчисло, где х может быть латинской x)
    const sizeMatch = variantsStr.match(/(\d+)[хxХX](\d+)[хxХX](\d+)/i);
    if (!sizeMatch) return null;
    // Формируем размер в едином формате (кириллическая х)
    return `${sizeMatch[1]}х${sizeMatch[2]}х${sizeMatch[3]}`;
  }

  const ensure = (map, key, title) => {
    if (!key) return null;
    if (!map.has(key)) map.set(key,{title:title||'', price:0, description:'', photos:[], variants:[]});
    const e = map.get(key);
    if (title && !e.title) e.title = title;
    return e;
  };

  // Первый проход: собираем все строки и группируем варианты по ID
  for (const r of rows){
    const idRaw = col('id')!=null ? (r[col('id')]||'') : '';
    const idKey = normId(idRaw);
    const tRaw  = (r[col('title')]||'').trim();
    const p = num(r[col('price')]||'');
    const category = col('category')!=null ? String(r[col('category')]||'').trim() : '';
    const desc = col('description')!=null ? (r[col('description')]||'').trim() : '';
    const phRaw  = col('photos')!=null ? (r[col('photos')]||'') : '';
    const photos = phRaw.split('|').map(photo => photo.trim()).filter(Boolean);
    const variantsRaw = col('variants')!=null ? (r[col('variants')]||'').trim() : '';

    const iActive = col('active');
    const hasActiveCol = iActive != null;
    const aRaw = hasActiveCol ? (r[iActive] ?? '') : '';

    const isActive = (() => {
      if (!hasActiveCol) return true;
      const s = String(aRaw).trim().toLowerCase();
      if (s === '') return false;
      const YES = new Set(['1','true','t','да','yes','y','on','ok','✓','&#x2714;','истина']);
      const NO  = new Set(['0','false','f','нет','no','n','off','x','✗','×','-','ложь']);
      if (YES.has(s)) return true;
      if (NO.has(s))  return false;
      const n = Number(s.replace(',','.'));
      return !Number.isNaN(n) ? n > 0 : false;
    })();

    if(!tRaw || !p) continue;
    if(!isActive) continue;

    // Проверяем, есть ли вариант (не пустое и не "-")
    const hasVariant = variantsRaw && variantsRaw.trim() !== '' && variantsRaw.trim() !== '-';
    const hasChoice = hasVariant || !!category;
    const size = hasVariant ? extractSize(variantsRaw) : null;

    if (!idKey) continue; // Пропускаем строки без ID

    // Все строки с вариантами добавляем в промежуточное хранилище
    if (hasChoice) {
      // Это вариант товара - сохраняем в промежуточное хранилище
      if (!variantsByProductId.has(idKey)) {
        variantsByProductId.set(idKey, []);
      }
      variantsByProductId.get(idKey).push({
        variantId: `${idRaw}:${category}:${variantsRaw === '-' ? '' : variantsRaw}`,
        variantText: hasVariant ? variantsRaw.trim() : category,
        size: size || '',
        category,
        price: p, // Цена из колонки price этой строки
        description: desc,
        photos: photos,
        title: tRaw
      });
    } else {
      // Это основной товар (без вариантов) - сохраняем сразу
      const entry = ensure(byId, idKey, tRaw);
      if (entry) {
        entry.price = p;
        entry.description = desc;
        entry.photos = photos;
        entry.variants = []; // Товар без вариантов
      }

      // Также добавляем по названию
      const tKey = normCat(tRaw);
      const entryByTitle = ensure(byTitle, tKey, tRaw);
      if (entryByTitle) {
        entryByTitle.price = p;
        entryByTitle.description = desc;
        entryByTitle.photos = photos;
        entryByTitle.variants = [];
      }
    }
  }

  // Второй проход: обрабатываем товары с вариантами
  variantsByProductId.forEach((variantsList, idKey) => {
    // Если уже есть основной товар (без вариантов), добавляем к нему варианты
    // Если нет, создаем основной товар из первого варианта
    let entry = byId.get(idKey);

    if (!entry) {
      // Создаем основной товар из первого варианта
      const firstVariant = variantsList[0];
      entry = ensure(byId, idKey, firstVariant.title || '');
      entry.price = firstVariant.price;
      entry.description = firstVariant.description;
      entry.photos = firstVariant.photos;

      // Также добавляем по названию
      const tKey = normCat(firstVariant.title || '');
      const entryByTitle = ensure(byTitle, tKey, firstVariant.title || '');
      entryByTitle.price = firstVariant.price;
      entryByTitle.description = firstVariant.description;
      entryByTitle.photos = firstVariant.photos;
    }

    // Добавляем все варианты к товару
    if (variantsList.length > 0) {
      entry.variants = variantsList.map(v => ({
        variantId: v.variantId,
        variantText: v.variantText, // Полный текст для отображения (например, "120x40x60 (+200 ₽)")
        size: v.size, // Размер для отображения (например, "120х40х60")
        category: v.category || '',
        price: v.price, // Цена из колонки price таблицы для этого варианта
        description: v.description || entry.description,
        photos: v.photos.length > 0 ? v.photos : entry.photos
      }));

      // Если основной товар был создан из варианта, устанавливаем цену из первого варианта
      // Это важно, так как цена основного товара должна соответствовать первому варианту
      if (!entry.price || entry.price === 0) {
        entry.price = variantsList[0].price;
      }

      // Если у основного товара нет описания или фото, берем из первого варианта
      if (!entry.description && variantsList[0].description) {
        entry.description = variantsList[0].description;
      }
      if (entry.photos.length === 0 && variantsList[0].photos.length > 0) {
        entry.photos = variantsList[0].photos;
      }
    }

    // Обновляем также по названию
    const tKey = normCat(entry.title);
    const entryByTitle = byTitle.get(tKey);
    if (entryByTitle && entry.variants.length > 0) {
      entryByTitle.variants = entry.variants;
    }
  });


  return { byId, byTitle };
}
