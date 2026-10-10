import { initCheckout } from './checkout.js';
import { initForms } from './forms.js';
import { initPhoneMasks } from './phone-mask.js';
export function start(getPromo, cartStore) {
  initForms();
  initPhoneMasks();
  initCheckout(document.querySelector('[data-cart-popup] form'), getPromo, cartStore);
}
