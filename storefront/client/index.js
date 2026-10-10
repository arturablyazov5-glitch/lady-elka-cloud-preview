import * as cartStore from './cart-store.js';
import { initFormPresentation } from './form-presentation.js';
import { initProducts } from './product-ui.js';
import { initCart } from './cart-ui.js';
import { getPromo, initPromo } from './promo.js';
import { initGallery } from './gallery.js';
import { initFilter } from './filter.js';
import { initCatalogSync } from './catalog-sync.js';
document.addEventListener('storefront:products-added', initProducts);
let demand, formsReady = false;
function loadForms() {
  return demand ||= import('/f/checkout-demand.js').then(module => { module.start(getPromo, cartStore); formsReady = true; }).catch(error => {
    demand = null;
    throw error;
  });
}
function start() {
  initFormPresentation();
  const relevant = target => target?.closest?.('form,[data-cart-open],.buy-btn,[data-modal-open]');
  for (const type of ['pointerdown', 'focusin', 'click', 'keydown']) document.addEventListener(type, event => {
    if (relevant(event.target)) void loadForms().catch(error => console.error('Form runtime unavailable', error));
  }, true);
  // A keyboard/programmatic submit may precede the chunk. Replay it after binding.
  let replaying = false;
  document.addEventListener('submit', event => {
    if (formsReady || replaying || !event.target.matches('form[data-lead-type], [data-cart-popup] form')) return;
    event.preventDefault(); event.stopImmediatePropagation();
    const form = event.target, submitter = event.submitter;
    void loadForms().then(() => {
      replaying = true;
      try { form.requestSubmit(submitter || undefined); } finally { replaying = false; }
    }).catch(error => console.error('Form runtime unavailable', error));
  }, true);
  initProducts();
  initGallery();
  const cart = initCart(getPromo);
  initPromo(() => cart?.render());
  void initCatalogSync().finally(initFilter);
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
else start();
