// Interactions for the static storefront. No platform runtime is loaded.
(() => {
  const select = (id) => document.getElementById(id);
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
  const closeModal = (modal) => {
    if (!modal) return;
    modal.style.display = 'none';
    modal.setAttribute('aria-hidden', 'true');
  };
  const openModal = (modal) => {
    if (!modal) return;
    modal.style.display = 'flex';
    modal.setAttribute('aria-hidden', 'false');
  };
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
    if (cartOpen) { event.preventDefault(); openModal(document.querySelector('[data-cart-popup]')); return; }
    const action = target.closest('[data-modal-open], [data-modal-close]');
    if (action) {
      const modal = select(action.dataset.modalOpen || action.dataset.modalClose);
      if (modal?.classList.contains('pop-up')) {
        event.preventDefault();
        if (action.hasAttribute('data-modal-close')) closeModal(modal);
        else openModal(modal);
        if (action.dataset.cookieConsent === 'accept') { try { localStorage.setItem('lady-elka-cookie-consent', 'accepted'); } catch {} }
      }
      return;
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
      menu?.classList.add('is-opened');
      document.body.classList.add('site-menu-open');
      return;
    }
    if (target.closest('.menu__close-button, .menu__overlay')) {
      menu?.classList.remove('is-opened');
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
    if (event.key !== 'Escape') return;
    document.querySelectorAll('.pop-up[aria-hidden="false"]').forEach(closeModal);
    document.querySelectorAll('.menu.is-opened').forEach((menu) => menu.classList.remove('is-opened'));
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
    if (delimiter < 0) return;

    const beforeText = fixTyperNbsp(original.slice(0, delimiter));
    const afterText = fixTyperNbsp(original.slice(delimiter + 1));
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
    const after = document.createElement('span');
    after.className = 'typer-after';
    after.textContent = afterText;
    wrap.append(before, chunk, after);
    element.replaceChildren(wrap);
    element.setAttribute('aria-live', 'polite');

    let wordIndex = 0;
    let position = 0;
    let phase = 'typing';
    let current = '';
    let timer = null;
    let active = false;
    let started = false;
    const render = () => { chunk.textContent = current; };
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
    if ('IntersectionObserver' in window) {
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
