// Interactions for the static storefront. No platform runtime is loaded.
(() => {
  const select = (id) => document.getElementById(id);
  // Delivery is below the fold; activate its responsive CSS background only near view.
  const deferredBackgrounds = document.querySelectorAll('[data-background-deferred]');
  if ('IntersectionObserver' in window) {
    const backgrounds = new IntersectionObserver(entries => {
      for (const entry of entries) if (entry.isIntersecting) {
        entry.target.removeAttribute('data-background-deferred');
        backgrounds.unobserve(entry.target);
      }
    }, { rootMargin: '300px' });
    deferredBackgrounds.forEach(node => backgrounds.observe(node));
  } else deferredBackgrounds.forEach(node => node.removeAttribute('data-background-deferred'));
  const copyStatusTimers = new WeakMap();
  const copyText = async (text) => {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        return true;
      }
    } catch {}
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.setAttribute('readonly', '');
    Object.assign(textarea.style, { position: 'fixed', opacity: '0', pointerEvents: 'none' });
    document.body.append(textarea);
    textarea.select();
    let copied = false;
    try { copied = document.execCommand('copy'); } catch {}
    textarea.remove();
    return copied;
  };
  const showEmailCopyStatus = (link, copied) => {
    const email = link.dataset.copyOriginal || link.textContent.trim();
    link.dataset.copyOriginal = email;
    const message = copied ? 'Почта скопирована' : 'Не удалось скопировать почту';
    link.textContent = message;
    link.setAttribute('aria-label', message);
    link.setAttribute('title', message);
    clearTimeout(copyStatusTimers.get(link));
    copyStatusTimers.set(link, setTimeout(() => {
      link.textContent = email;
      link.setAttribute('aria-label', `Скопировать почту ${email}`);
      link.setAttribute('title', 'Нажмите, чтобы скопировать почту');
      copyStatusTimers.delete(link);
    }, 2200));
  };
  // Accessible modal dialogs: name, focus transfer, focus trap, inert background, focus return.
  const focusableSelector = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"]), [role="button"]';
  const isCookieNotice = modal => modal.matches('[data-cookie-banner]') || Boolean(modal.querySelector('[data-cookie-consent]'));
  const visible = node => Boolean(node.offsetWidth || node.offsetHeight || node.getClientRects().length)
    && getComputedStyle(node).visibility !== 'hidden';
  const focusables = root => [...root.querySelectorAll(focusableSelector)]
    .filter(node => !node.closest('[hidden], [inert], [aria-hidden="true"]') && visible(node));
  let dialogCount = 0;
  const describeModal = (modal) => {
    if (modal.hasAttribute('data-dialog-ready')) return;
    modal.dataset.dialogReady = 'true';
    const content = modal.querySelector('.pop-up__content') || modal;
    if (isCookieNotice(modal)) {
      // Non-blocking notice: a labelled region, never a modal focus trap.
      modal.setAttribute('role', 'region');
      modal.setAttribute('aria-label', 'Уведомление об использовании cookie');
    } else {
      modal.setAttribute('role', 'dialog');
      modal.setAttribute('aria-modal', 'true');
      const title = [...content.querySelectorAll('h1, h2, h3, .site__h1, .site__h2')]
        .find(node => node.textContent.trim() && !node.closest('[data-cart-items], form'));
      if (!title) modal.setAttribute('aria-label', modal.matches('[data-cart-popup]') ? 'Корзина и оформление заказа' : 'Диалоговое окно');
      else {
        if (!title.id) title.id = `storefront-dialog-title-${++dialogCount}`;
        modal.setAttribute('aria-labelledby', title.id);
        modal.removeAttribute('aria-label');
      }
      content.setAttribute('tabindex', '-1');
    }
    if (!modal.hasAttribute('aria-hidden')) modal.setAttribute('aria-hidden', String(getComputedStyle(modal).display === 'none'));
    modal.querySelectorAll('.pop-up__outside-close-button, .pop-up__inside-close-button').forEach(button => {
      button.setAttribute('role', 'button');
      button.setAttribute('tabindex', '0');
      button.setAttribute('aria-label', 'Закрыть');
    });
    modal.querySelectorAll('.pop-up__overlay').forEach(overlay => overlay.setAttribute('aria-hidden', 'true'));
  };
  const openDialogs = [];
  const setBackgroundInert = (modal, inert) => {
    const changed = [];
    if (inert) {
      for (let node = modal; node && node !== document.body; node = node.parentElement) {
        for (const sibling of node.parentElement?.children || []) {
          if (sibling === node || sibling.inert || /^(SCRIPT|STYLE|LINK|TEMPLATE)$/.test(sibling.tagName)) continue;
          sibling.inert = true;
          changed.push(sibling);
        }
      }
    }
    return changed;
  };
  const closeModal = (modal, { restoreFocus = true } = {}) => {
    if (!modal) return;
    modal.style.display = 'none';
    modal.setAttribute('aria-hidden', 'true');
    const index = openDialogs.findIndex(entry => entry.modal === modal);
    if (index < 0) return;
    const [entry] = openDialogs.splice(index, 1);
    entry.inerted.forEach(node => { node.inert = false; });
    const opener = entry.opener?.isConnected ? entry.opener : document.querySelector('[data-cart-open]');
    if (restoreFocus && opener?.isConnected && !opener.closest('[inert]') && visible(opener)) opener.focus({ preventScroll: true });
  };
  const openModal = (modal, opener = document.activeElement) => {
    if (!modal) return;
    describeModal(modal);
    modal.style.display = 'flex';
    modal.setAttribute('aria-hidden', 'false');
    if (isCookieNotice(modal) || openDialogs.some(entry => entry.modal === modal)) return;
    openDialogs.push({ modal, opener: opener && opener !== document.body ? opener : null, inerted: setBackgroundInert(modal, true) });
    const content = modal.querySelector('.pop-up__content') || modal;
    content.focus({ preventScroll: true });
  };
  document.querySelectorAll('.pop-up').forEach(describeModal);
  // Mobile menu: named burger with state; focus moves into the opened menu and back to the burger.
  const menuBackground = new WeakMap();
  const setMenu = (menu, open, { moveFocus = false } = {}) => {
    if (!menu) return;
    const wasOpen = menu.classList.contains('is-opened');
    menu.classList.toggle('is-opened', open);
    const burger = menu.querySelector('.menu__burger-button');
    burger?.setAttribute('aria-expanded', String(open));
    burger?.setAttribute('aria-label', open ? 'Закрыть меню' : 'Открыть меню');
    if (wasOpen !== open) {
      const panel = menu.querySelector('.menu__fixed-wrapper');
      if (open && panel) menuBackground.set(menu, setBackgroundInert(menu, true));
      else {
        menuBackground.get(menu)?.forEach(node => { node.inert = false; });
        menuBackground.delete(menu);
      }
    }
    if (!moveFocus || wasOpen === open) return;
    if (open) requestAnimationFrame(() => focusables(menu.querySelector('.menu__fixed-wrapper') || menu)
      .find(node => !node.matches('.menu__close-button'))?.focus({ preventScroll: true }));
    else if (burger && visible(burger)) burger.focus({ preventScroll: true });
  };
  document.querySelectorAll('.menu').forEach(menu => {
    const burger = menu.querySelector('.menu__burger-button');
    const panel = menu.querySelector('.menu__fixed-wrapper');
    if (!burger) return;
    if (panel) { panel.id ||= `storefront-menu-${Math.random().toString(36).slice(2, 8)}`; burger.setAttribute('aria-controls', panel.id); }
    burger.setAttribute('aria-expanded', String(menu.classList.contains('is-opened')));
    burger.setAttribute('aria-label', 'Открыть меню');
    menu.querySelector('.menu__close-button')?.setAttribute('aria-label', 'Закрыть меню');
  });
  const reviewCarousel = (() => {
    const blocklist = document.querySelector('#ig20yx3gk_0');
    const viewport = blocklist?.querySelector('.blocklist__list-wrapper');
    const list = blocklist?.querySelector('.blocklist__list');
    const items = list ? [...list.querySelectorAll(':scope > .blocklist__item-wrapper')] : [];
    const previous = blocklist?.querySelector('.blocklist__arrow-prev');
    const next = blocklist?.querySelector('.blocklist__arrow-next');
    if (!viewport || !list || !items.length) return null;

    let index = 0;
    const update = (animate = true) => {
      const step = items[0].getBoundingClientRect().width;
      if (!step) return;
      const visible = Math.max(1, Math.round(viewport.clientWidth / step));
      const lastIndex = Math.max(0, items.length - visible);
      index = Math.min(lastIndex, Math.max(0, index));
      list.style.transition = animate ? 'transform 320ms ease' : 'none';
      list.style.transform = `translate3d(${-index * step}px, 0, 0)`;
      for (const [button, disabled] of [[previous, index === 0], [next, index === lastIndex]]) {
        if (!button) continue;
        button.setAttribute('role', 'button');
        button.setAttribute('tabindex', '0');
        button.setAttribute('aria-controls', list.id);
        button.setAttribute('aria-disabled', String(disabled));
        button.setAttribute('aria-label', button === previous ? 'Предыдущие отзывы' : 'Следующие отзывы');
        button.style.opacity = disabled ? '.45' : '';
        button.style.pointerEvents = disabled ? 'none' : '';
      }
    };
    update(false);
    let resizeFrame = 0;
    window.addEventListener('resize', () => {
      cancelAnimationFrame(resizeFrame);
      resizeFrame = requestAnimationFrame(() => update(false));
    });
    return { move: direction => { index += direction; update(); } };
  })();

  document.addEventListener('submit', event => {
    const form = event.target;
    const input = form.matches('form') ? form.querySelector('input[name="search"]') : null;
    if (!input) return;
    event.preventDefault();
    location.assign('/search?search=' + encodeURIComponent(input.value.trim()));
  });

  document.addEventListener('click', (event) => {
    if (event.defaultPrevented) return;
    const target = event.target;
    const emailLink = target.closest('.email-wrapper__footer a[href^="mailto:"]');
    if (emailLink) {
      event.preventDefault();
      const email = emailLink.textContent.trim();
      void copyText(email).then(copied => showEmailCopyStatus(emailLink, copied));
      return;
    }
    const reviewArrow = target.closest('#ig20yx3gk_0 .blocklist__arrow-prev, #ig20yx3gk_0 .blocklist__arrow-next');
    if (reviewArrow && reviewCarousel) {
      event.preventDefault();
      if (reviewArrow.getAttribute('aria-disabled') === 'true') return;
      reviewCarousel.move(reviewArrow.classList.contains('blocklist__arrow-next') ? 1 : -1);
      return;
    }
    const cartOpen = target.closest('[data-cart-open]');
    if (cartOpen) {
      event.preventDefault();
      const menu = cartOpen.closest('.menu.is-opened');
      const opener = menu?.querySelector('.menu__burger-button') || cartOpen;
      if (menu) { setMenu(menu, false); document.body.classList.remove('site-menu-open'); }
      openModal(document.querySelector('[data-cart-popup]'), opener);
      return;
    }
    const upButton = target.closest('.up-button__footer');
    if (upButton) { event.preventDefault(); window.scrollTo({ top: 0, behavior: 'smooth' }); return; }
    const action = target.closest('[data-modal-open], [data-modal-close]');
    if (action) {
      const modal = select(action.dataset.modalOpen || action.dataset.modalClose);
      if (modal?.classList.contains('pop-up')) {
        event.preventDefault();
        if (action.hasAttribute('data-modal-close')) closeModal(modal);
        else {
          const menu = action.closest('.menu.is-opened');
          const opener = menu?.querySelector('.menu__burger-button') || action;
          if (menu) { setMenu(menu, false); document.body.classList.remove('site-menu-open'); }
          openModal(modal, opener);
        }
        if (action.dataset.cookieConsent === 'accept') { try { localStorage.setItem('lady-elka-cookie-consent', 'accepted'); } catch {} }
      }
      return;
    }
    const menuLink = target.closest('.menu a[href], .menu [role="button"][href]');
    if (menuLink && !menuLink.hasAttribute('data-modal-open')) {
      setMenu(menuLink.closest('.menu'), false);
      document.body.classList.remove('site-menu-open');
    }
    const pseudoLink = target.closest('[role="button"]');
    if (pseudoLink && pseudoLink.tagName !== 'A') {
      const href = pseudoLink.getAttribute('href');
      if (href && href !== '/') {
        event.preventDefault();
        location.assign(href);
        return;
      }
    }
    const menu = target.closest('.menu');
    if (target.closest('.menu__burger-button')) {
      const open = !menu.classList.contains('is-opened');
      setMenu(menu, open, { moveFocus: true });
      document.body.classList.toggle('site-menu-open', open);
      return;
    }
    if (target.closest('.menu__close-button, .menu__overlay')) {
      setMenu(menu, false, { moveFocus: true });
      document.body.classList.remove('site-menu-open');
      return;
    }
    const header = target.closest('.accordion__header');
    if (header) {
      const item = header.closest('.accordion__item');
      item?.classList.toggle('is-opened');
      header.setAttribute('aria-expanded', String(item?.classList.contains('is-opened')));
      return;
    }
    const modal = target.closest('.pop-up');
    if (modal && target.closest('.pop-up__overlay, .pop-up__outside-close-button, .pop-up__inside-close-button')) {
      closeModal(modal);
      return;
    }
    const slider = target.closest('.slider');
    if (slider && target.closest('.slider__arrow-prev, .slider__arrow-next')) {
      const next = Boolean(target.closest('.slider__arrow-next'));
      const slides = [...slider.querySelectorAll('.slider__slide')];
      const index = Math.max(0, slides.findIndex((slide) => slide.classList.contains('is-active')));
      const newIndex = (index + (next ? 1 : -1) + slides.length) % slides.length;
      slides.forEach((slide, i) => slide.classList.toggle('is-active', i === newIndex));
      const list = slider.querySelector('.slider__list');
      if (list) list.style.transform = `translateX(-${newIndex * 100}%)`;
    }
  });

  document.querySelectorAll('.email-wrapper__footer a[href^="mailto:"]').forEach(link => {
    link.setAttribute('role', 'button');
    link.setAttribute('aria-label', `Скопировать почту ${link.textContent.trim()}`);
    link.setAttribute('title', 'Нажмите, чтобы скопировать почту');
  });
  document.querySelectorAll('[role="button"]').forEach(button => { if (!button.hasAttribute('tabindex')) button.tabIndex = 0; });
  document.addEventListener('keydown', (event) => {
    if (event.defaultPrevented) return;
    const button = event.target.closest('[role="button"]');
    if (button && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); button.click(); return; }
    const dialog = openDialogs.at(-1)?.modal || document.querySelector('.menu.is-opened .menu__fixed-wrapper');
    if (event.key === 'Tab' && dialog) {
      // Keep keyboard focus inside the open dialog.
      const items = focusables(dialog);
      if (!items.length) { event.preventDefault(); return; }
      const first = items[0], last = items.at(-1);
      if (!dialog.contains(document.activeElement)) { event.preventDefault(); (event.shiftKey ? last : first).focus(); }
      else if (event.shiftKey && (document.activeElement === first || !items.includes(document.activeElement) && document.activeElement.matches('.pop-up__content'))) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      return;
    }
    if (event.key !== 'Escape') return;
    [...document.querySelectorAll('.pop-up[aria-hidden="false"]')].reverse().forEach(modal => closeModal(modal));
    document.querySelectorAll('.menu.is-opened').forEach(menu => setMenu(menu, false, { moveFocus: true }));
    document.body.classList.remove('site-menu-open');
  });

  document.querySelectorAll('.accordion__header').forEach((header) => {
    header.setAttribute('role', 'button');
    header.setAttribute('tabindex', '0');
    header.setAttribute('aria-expanded', String(header.closest('.accordion__item')?.classList.contains('is-opened')));
    header.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); header.click(); }
    });
  });
  document.querySelectorAll('.slider').forEach((slider) => {
    slider.querySelector('.slider__slide')?.classList.add('is-active');
  });
  // Recreate the old hero typewriter without loading the Taptop page scripts.
  const defaultTyperVariants = ['Зелёные', 'С освещением', 'Заснеженные', 'Белые'];
  const fixTyperNbsp = (text) => text
    .replace(/&nbsp;/g, '\u00A0')
    .replace(/(^|[\s\u00A0])([ВвКкСсУуОоИиАа])\s+/g, '$1$2\u00A0')
    .replace(/(^|[\s\u00A0])((?:со|Со|ко|Ко|по|По|на|На|из|Из|об|Об|от|От|до|До))\s+/g, '$1$2\u00A0');
  document.querySelectorAll('[data-typer]').forEach((element) => {
    const original = element.textContent || '';
    const delimiter = original.indexOf('|');
    if (delimiter < 0 && !element.hasAttribute('data-typer-suffix')) return;

    const beforeText = fixTyperNbsp(element.getAttribute('data-typer-prefix') ?? original.slice(0, delimiter));
    const afterText = fixTyperNbsp(element.getAttribute('data-typer-suffix') ?? original.slice(delimiter + 1));
    const configured = element.getAttribute('data-typer-variants') || element.getAttribute('data-variants');
    const variants = configured
      ? configured.split(/[|;,]\s*/).map(value => value.trim()).filter(Boolean)
      : defaultTyperVariants;
    const words = variants.length ? variants : defaultTyperVariants;

    const wrap = document.createElement('span');
    wrap.className = 'typer-wrap';
    const before = document.createElement('span');
    before.className = 'typer-before';
    before.textContent = beforeText;
    const chunk = document.createElement('span');
    chunk.className = 'typer-chunk';
    const reserve = document.createElement('span');
    reserve.className = 'typer-reserve';
    reserve.setAttribute('aria-hidden', 'true');
    reserve.textContent = words.reduce((longest, word) => word.length > longest.length ? word : longest, '');
    const letters = document.createElement('span');
    letters.className = 'typer-letters';
    chunk.append(reserve, letters);
    const after = document.createElement('span');
    after.className = 'typer-after';
    after.textContent = afterText;
    wrap.append(before, chunk, after);
    element.replaceChildren(wrap);
    // The decoration changes repeatedly; announce the stable heading, not every character.
    element.setAttribute('aria-label', `${beforeText}${words[0]}${afterText}`);
    wrap.setAttribute('aria-hidden', 'true');

    let wordIndex = 0;
    let position = 0;
    let phase = 'typing';
    let current = '';
    let timer = null;
    let active = false;
    let started = false;
    const render = () => { letters.textContent = current; };
    const plan = (delay) => { clearTimeout(timer); timer = setTimeout(tick, delay); };
    const tick = () => {
      if (!active) { timer = null; return; }
      if (phase === 'typing') {
        if (position < words[wordIndex].length) {
          current += words[wordIndex].charAt(position++);
          render();
          plan(110);
        } else {
          phase = 'waiting';
          plan(3000);
        }
      } else if (phase === 'waiting') {
        phase = 'deleting';
        plan(65);
      } else if (position > 0) {
        current = current.slice(0, -1);
        position--;
        render();
        plan(65);
      } else {
        wordIndex = (wordIndex + 1) % words.length;
        phase = 'typing';
        plan(110);
      }
    };
    const start = () => {
      if (!started) { started = true; plan(300); }
      else if (!timer) plan(110);
    };
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
      current = words[0];
    } else if ('IntersectionObserver' in window) {
      const observer = new IntersectionObserver(entries => {
        entries.forEach(entry => {
          if (entry.isIntersecting) { active = true; start(); }
          else { active = false; clearTimeout(timer); timer = null; }
        });
      }, { threshold: 0.25 });
      observer.observe(element);
    } else {
      active = true;
      start();
    }
    render();
  });
  // Keep the cookie notice visible while letting all clicks reach the storefront below it.
  const cookieBanner = document.querySelector('[data-cookie-banner]');
  if (cookieBanner) {
    cookieBanner.style.pointerEvents = 'none';
    const cookieContent = cookieBanner.querySelector('.pop-up__content');
    if (cookieContent) cookieContent.style.pointerEvents = 'auto';
  }
  let consentAccepted = false;
  try { consentAccepted = Boolean(localStorage.getItem('lady-elka-cookie-consent')); } catch {}
  if (!consentAccepted) {
    const consent = document.querySelector('.pop-up:has([data-cookie-consent="accept"])');
    if (consent) openModal(consent);
  }
})();
