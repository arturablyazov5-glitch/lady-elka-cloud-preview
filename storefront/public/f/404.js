// Native interactions for the source 404 markup. No Taptop/analytics runtime.
(() => {
  if (window.innerWidth <= 768) {
    const label = document.querySelector('[href="/catalog/landscape-gardening/"] .menu__link-text .text-block-wrap-div');
    if (label) label.textContent = 'Ландшафтное озеленение';
  }
  const up = document.querySelector('.up-button');
  window.addEventListener('scroll', () => { up.style.display = window.scrollY > 100 ? '' : 'none'; }, { passive: true });
  const menu = document.querySelector('.menu');
  const fixed = menu.querySelector('.menu__fixed-wrapper');
  const setMenu = open => {
    menu.classList.toggle('is-opened', open);
    fixed.style.display = open ? 'flex' : '';
    document.documentElement.style.overflow = open ? 'hidden' : '';
  };
  const modal = document.getElementById('inachtynm_0');
  const setModal = open => {
    modal.style.display = open ? 'flex' : '';
    document.documentElement.style.overflow = open ? 'hidden' : '';
  };
  document.addEventListener('click', event => {
    const target = event.target;
    if (target.closest('.menu__burger-button')) setMenu(true);
    if (target.closest('.menu__close-button, .menu__overlay')) setMenu(false);
    if (target.closest('[data-action-element="inachtynm_0"]')) setModal(true);
    if (target.closest('.pop-up__overlay, .pop-up__inside-close-button, .pop-up__outside-close-button')) setModal(false);
    if (target.closest('.up-button')) window.scrollTo({ top: 0, behavior: 'smooth' });
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') { setMenu(false); setModal(false); }
    if ((event.key === 'Enter' || event.key === ' ') && event.target.matches('[role="button"]:not(button)')) { event.preventDefault(); event.target.click(); }
  });
  document.querySelectorAll('[role="button"]:not(button)').forEach(element => element.tabIndex = 0);
})();
// Original GSAP power1.inOut scale (0.8 -> 1.3, 1s, infinite yoyo), implemented natively.
const onlineDots = new IntersectionObserver(entries => {
  for (const entry of entries) if (entry.isIntersecting) {
    const start = performance.now();
    const pulse = now => {
      if (!entry.target.isConnected) return;
      const elapsed = (now - start) / 1000;
      const progress = Math.floor(elapsed) % 2 ? 1 - elapsed % 1 : elapsed % 1;
      const eased = progress < 0.5 ? 2 * progress * progress : 1 - 2 * (1 - progress) * (1 - progress);
      const scale = 0.8 + 0.5 * eased;
      entry.target.style.transform = `translate3d(0px, 0px, 0px) scale(${scale}, ${scale})`;
      requestAnimationFrame(pulse);
    };
    requestAnimationFrame(pulse);
    onlineDots.unobserve(entry.target);
  }
});
document.querySelectorAll('.dot-online__work').forEach(dot => onlineDots.observe(dot));

// Source custom search behavior (local HEAD probes; no platform dependency).
(function(){
  // =========== УТИЛЫ ===========
  const norm = s => (s||'').toString()
    .toLowerCase().replace(/ё/g,'е')
    .replace(/[«»"']/g,'').replace(/\s+/g,' ').trim();

  // Транслитерация RU -> латиница + слаг
  const toSlug = (s)=>{
    s = norm(s);
    const map = {а:'a',б:'b',в:'v',г:'g',д:'d',е:'e',ж:'zh',з:'z',и:'i',й:'y',к:'k',л:'l',м:'m',н:'n',о:'o',п:'p',р:'r',с:'s',т:'t',у:'u',ф:'f',х:'h',ц:'ts',ч:'ch',ш:'sh',щ:'shch',ы:'y',э:'e',ю:'yu',я:'ya'};
    s = s.replace(/[а-яё]/g, ch => map[ch] ?? ch);
    return s.replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'');
  };

  // Проверка, что страница существует (быстрый HEAD; если не поддерживается, пробуем GET)
  async function urlExists(url, timeout=1200){
    const ac = new AbortController();
    const t = setTimeout(()=>ac.abort('timeout'), timeout);
    try {
      let r = await fetch(url, {method:'HEAD', redirect:'follow', credentials:'same-origin', signal:ac.signal});
      if (r.ok || (r.status>=300 && r.status<400)) return true;
      // На некоторых хостингах HEAD=405 -> пробуем GET
      if (r.status===405){
        r = await fetch(url, {method:'GET', redirect:'follow', credentials:'same-origin', signal:ac.signal, cache:'no-store'});
        if (r.ok) return true;
      }
    } catch(e){}
    finally { clearTimeout(t); }
    return false;
  }

  // Пытаемся найти точное совпадение в локальном индексе, если ты его положишь заранее
  // Пример индекса: window.LADY_TREES_INDEX = [{title:'Миранда', url:'/tree/miranda'}]
  function findInIndex(q){
    const idx = Array.isArray(window.LADY_TREES_INDEX) ? window.LADY_TREES_INDEX : null;
    if (!idx) return null;
    const qn = norm(q), qs = toSlug(q);
    const hit = idx.find(it=>{
      const t = norm(it.title), u = (it.url||'').toLowerCase().replace(/\/+$/, '');
      return t===qn || u.endsWith('/'+qs) || u.endsWith('/'+qs.replace(/-/g,''));
    });
    return hit?.url || null;
  }

  // =========== ПЕРЕХВАТ САБМИТА ===========
  function onSubmitFast(e){
    const form  = e.currentTarget;
    const input = form.querySelector('input[name="search"]');
    const raw   = input && input.value || '';
    const q     = norm(raw);
    if (!q) return; // пусть уходит на /search

    // 1) Если есть локальный индекс — мгновенно
    const fromIndex = findInIndex(q);
    if (fromIndex){
      e.preventDefault();
      location.assign(fromIndex.replace(/\/+$/, '') + '/');
      return;
    }

    // 2) Пытаемся угадать слаг и перейти без /search
    e.preventDefault(); // останавливаем навигацию, у нас быстрый план B
    const slug = toSlug(q);
    const candidates = [
      `/tree/${slug}/`,
      `/tree/${slug.replace(/-/g,'')}/`,  // на случай «анна-мария» vs «аннамария»
    ];

    // Проверяем кандидатов параллельно и берём первого успешного
    Promise.any(candidates.map(u=>urlExists(u).then(ok=>ok?u:Promise.reject())))
      .then(u => location.assign(u))
      .catch(()=> form.submit()); // ничего не нашли — обычный поиск
  }

  function bind(){
    document.querySelectorAll('form[action="/search/"], form[action="/search"]').forEach(f=>{
      if (f.__fastBind) return;
      f.addEventListener('submit', onSubmitFast);
      f.__fastBind = true;
    });
  }

  document.addEventListener('DOMContentLoaded', bind);
  // На всякий — если формы дорисуются динамически
  const mo = new MutationObserver(bind);
  mo.observe(document.documentElement, {subtree:true, childList:true});
})();
