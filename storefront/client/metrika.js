// The original counter/options. Local/preview/alternate hosts never load the tag or send hits.
(() => {
  if (window.__LE_STOREFRONT_CONFIG__?.mode !== 'production' || location.protocol !== 'https:' || !['lady-elka.ru', 'www.lady-elka.ru'].includes(location.hostname)) return;
  window.dataLayer = window.dataLayer || [];
  window.ym = window.ym || function () { (window.ym.a = window.ym.a || []).push(arguments); };
  window.ym.l = +new Date();
  const script = document.createElement('script');
  script.async = true; script.src = 'https://mc.yandex.ru/metrika/tag.js?id=104963244';
  document.head.append(script);
  window.ym(104963244, 'init', { ssr: true, webvisor: true, clickmap: true, ecommerce: 'dataLayer', params: { __ym: { isFromApi: 'yesIsFromApi' } }, accurateTrackBounce: true, trackLinks: true });
})();
