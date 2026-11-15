const deferredBackgroundClasses = /\.(?:fill__img|doc__img|question__img|div--u-ie34ow484|div--u-iebdr6t41|div--u-io9v8ws09|div--u-ikrk2l5ca)\b/;
// URL assignment is gated by actual geometry, not a fixed number of cards.
export function deferredImageAttributes(attributes) {
  return Object.fromEntries(Object.entries(attributes).map(([key, value]) =>
    [['src', 'srcset', 'sizes'].includes(key) ? `data-le-${key}` : key, value]));
}
export function imageViewportLoader() {
  const pending = new Set();
  let scheduled = false;
  const visible = image => {
    if (!image.isConnected || !image.getClientRects().length) return false;
    for (let node = image; node && node.nodeType === 1; node = node.parentElement) {
      const style = getComputedStyle(node);
      if (node.hidden || style.visibility === 'hidden' || style.display === 'none') return false;
    }
    return true;
  };
  const load = image => {
    const background = image.hasAttribute('data-le-background');
    if ((!image.hasAttribute('data-le-src') && !background) || !visible(image)) return;
    const rect = image.getBoundingClientRect();
    // Product previews should wait until the card enters the viewport.
    const margin = background || image.closest('[data-storefront-image], [data-storefront-gallery], [data-cart-popup]') ? 0 : 400;
    if (rect.bottom <= -margin || rect.top >= innerHeight + margin || rect.right <= 0 || rect.left >= innerWidth) return;
    if (background) {
      image.style.setProperty('--le-active-background', 'var(--le-deferred-background)');
      image.removeAttribute('data-le-background');
      pending.delete(image); observer?.unobserve(image); return;
    }
    image.loading = rect.top < innerHeight && rect.bottom > 0 ? 'eager' : 'lazy';
    image.decoding = 'async';
    // sizes/srcset precede src so the browser selects the existing responsive photo.
    for (const name of ['sizes', 'srcset', 'src']) {
      const value = image.getAttribute('data-le-' + name);
      if (value !== null) image.setAttribute(name, value);
      image.removeAttribute('data-le-' + name);
    }
    pending.delete(image); observer?.unobserve(image);
  };
  const observer = 'IntersectionObserver' in window ? new IntersectionObserver(entries => {
    for (const entry of entries) if (entry.isIntersecting) load(entry.target);
  }, { rootMargin: '800px 0px' }) : null;
  const posterObserver = 'IntersectionObserver' in window ? new IntersectionObserver(entries => {
    for (const { target, intersectionRatio } of entries) {
      if (intersectionRatio <= 0) continue;
      target.poster = target.dataset.lePoster;
      delete target.dataset.lePoster;
      posterObserver.unobserve(target);
    }
  }, { threshold: 0.01 }) : null;
  document.addEventListener('click', event => {
    const button = event.target.closest('[data-le-video-play]');
    const video = button?.previousElementSibling;
    if (!video?.dataset.leVideoSrc) return;
    video.src = video.dataset.leVideoSrc;
    delete video.dataset.leVideoSrc;
    video.controls = true;
    video.focus();
    button.remove();
    video.play().catch(() => {});
  });
  function scan() {
    for (const video of document.querySelectorAll('video[data-le-poster]')) {
      if (posterObserver) posterObserver.observe(video);
      else {
        video.poster = video.dataset.lePoster;
        delete video.dataset.lePoster;
      }
    }
    scheduled = false;
    for (const image of document.querySelectorAll('img[data-le-src],[data-le-background]')) {
      if (!pending.has(image)) { pending.add(image); observer?.observe(image); }
    }
    for (const image of pending) {
      if (!image.isConnected) { pending.delete(image); observer?.unobserve(image); }
      else load(image);
    }
  }
  function schedule() { if (!scheduled) { scheduled = true; requestAnimationFrame(scan); } }
  new MutationObserver(schedule).observe(document.documentElement, { subtree: true, childList: true,
    attributes: true, attributeFilter: ['data-le-src', 'hidden', 'class', 'style'] });
  addEventListener('resize', schedule, { passive: true });
  addEventListener('scroll', schedule, { passive: true });
  document.addEventListener('DOMContentLoaded', scan, { once: true });
  window.__LE_LOAD_VISIBLE_IMAGES__ = scan;
  schedule();
}
export function deferBackgroundCSS(css) {
  return css.replace(/([^{}]+)\{([^{}]+)\}/g, (rule, selector, declarations) => {
    if (!deferredBackgroundClasses.test(selector)) return rule;
    return selector + '{' + declarations.replace(/background-image:(url\([^;]+\))/g, '--le-deferred-background:$1;background-image:var(--le-active-background,none)') + '}';
  });
}
export function deferPageImages(html) {
  html = html.replace(/<div\b[^>]*>/gi, tag => (/\bclass=(['"])(.*?)\1/i.exec(tag)?.[2] || '').split(/\s+/).some(name => deferredBackgroundClasses.test('.' + name)) && !tag.includes('data-le-background') ? tag.replace(/>$/, ' data-le-background>') : tag);
  html = html.replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>|<img\b[^>]*>/gi, (tag, offset) => {
    if (/^<noscript/i.test(tag)) return tag;
    const src = /\ssrc=(["'])(.*?)\1/i.exec(tag)?.[2];
    if (!src || src.startsWith('data:') || tag.includes('data-le-src')) return tag;
    const card = /data-storefront-image[^>]*>\s*$/.test(html.slice(Math.max(0, offset - 350), offset))
      && !/data-storefront-gallery-root[^]*$/.test(html.slice(Math.max(0, offset - 500), offset));
    if (!/\sloading=["']lazy["']/i.test(tag) && !card) return tag;
    let deferred = tag.replace(/\s(src|srcset|sizes)=/gi, ' data-le-$1=')
      .replace(/\sfetchpriority=(["']).*?\1/gi, '');
    // The auto-sized installment SVG otherwise reserves only a broken-image
    // icon until download, changing the flex row height during scroll. A local
    // transparent SVG with its existing intrinsic size reserves the final box.
    if (/\bid=['"]i4ph2ie0w_0['"]/.test(tag)) {
      const placeholder = 'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%22288%22 height=%22529%22/%3E';
      deferred = deferred.replace(/\sloading=(["']).*?\1/i, ' loading="eager"').replace(/>$/, ` src="${placeholder}">`);
    }
    return deferred + `<noscript>${tag}</noscript>`;
  });
  const needsLoader = /data-le-src|data-le-background|data-le-poster|data-cart-popup/.test(html);
  if (!needsLoader || html.includes('data-le-image-loader')) return html;
  return html.replace(/<\/head>/i, `<style>img[data-le-src]{color:transparent;font-size:0}</style><script data-le-image-loader>(${imageViewportLoader.toString()})();</script><noscript><style>img[data-le-src]{display:none}[data-le-background]{--le-active-background:var(--le-deferred-background)}</style></noscript></head>`);
}
