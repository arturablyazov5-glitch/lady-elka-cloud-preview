import { describeLeadControl } from './form-presentation.js';
import { leadEndpoint } from './config.js';
import { leadForms } from './lead-schema.js';
import { postJson, describeFailure, failureText, showMessage, showFailure, holdSubmit, keepFocus } from './request-errors.js';
const mounted = new WeakSet();

export function leadId() {
  if(typeof crypto.randomUUID === 'function')return crypto.randomUUID();
  const bytes=crypto.getRandomValues(new Uint8Array(16));bytes[6]=(bytes[6]&15)|64;bytes[8]=(bytes[8]&63)|128;
  const hex=[...bytes].map(b=>b.toString(16).padStart(2,'0')).join('');
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
}
// Throws RequestFailure (see request-errors.js); describeFailure(error, 'lead') gives the buyer-facing text.
export function requestLead(payload, {timeoutMs=20000}={}) {
  return postJson(leadEndpoint(), payload, { timeoutMs, isSuccess: (response, result) => response.ok && result.ok === true })
    .catch(error => { error.message = failureText(describeFailure(error, 'lead')); throw error; });
}
export function validLeadPhone(value) {
  const raw = String(value).trim();
  const digits = raw.replace(/\D/g, '');
  return /^[+\d\s()\-]+$/.test(raw) && (/^\d{10}$/.test(digits) || /^[78]\d{10}$/.test(digits));
}
function validationFor(control) {
  if (control.type === 'checkbox') return control.checked ? '' : 'Подтвердите согласие на обработку персональных данных';
  const value = String(control.value || '').trim();
  if (!value) return control.required ? 'Это поле обязательно для заполнения' : '';
  if (control.type === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return 'Введите корректный адрес электронной почты';
  if (control.type === 'tel' && !validLeadPhone(value)) return 'Введите корректный номер телефона';
  if (control.maxLength > 0 && value.length > control.maxLength) return 'Превышена допустимая длина поля';
  return '';
}
function setFieldError(control, message) {
  const field = control.closest('.form__field');
  const error = field?.querySelector('.form__field-error');
  field?.classList.toggle('is-error', Boolean(message));
  if (message) {
    if (error) (error.querySelector('.text-block-wrap-div') || error).textContent = message;
    control.setAttribute('aria-invalid', 'true');
    if (error?.id) control.setAttribute('aria-describedby', error.id);
  } else { control.removeAttribute('aria-invalid'); control.removeAttribute('aria-describedby'); }
}
export function initForms(root = document) {
  for (const form of root.querySelectorAll('form')) {
    if (mounted.has(form) || form.matches('[data-pay-now]') || form.querySelector('[data-pay-now]')) continue;
    if (form.method.toLowerCase() === 'get' && new URL(form.action, location.href).pathname.replace(/\/+$/, '') === '/search') continue;
    if (form.querySelector('.js-flt')) {
      form.addEventListener('submit', event => event.preventDefault(), true); mounted.add(form); continue;
    }
    const schema = leadForms[form.id];
    if (!schema && !form.dataset.leadType) continue;
    if (schema) {
      form.dataset.leadType = schema.type;
      const fields = [...form.querySelectorAll('input:not([type="hidden"]):not([type="submit"]),textarea,select')];
      schema.fields.forEach((key, index) => {
        if (!fields[index]) throw new Error(`Missing lead field ${key}`);
        fields[index].dataset.leadField = key; fields[index].name = key; fields[index].required = true;
      });
    }
    const controls = [...form.querySelectorAll('[data-lead-field]')];
    for (const control of controls) {
      describeLeadControl(control);
      control.addEventListener(control.type === 'checkbox' ? 'change' : 'input', () => {
        if (control.hasAttribute('aria-invalid')) setFieldError(control, validationFor(control));
      });
    }
    const honeypot = document.createElement('input');
    honeypot.name = 'website'; honeypot.type = 'text'; honeypot.tabIndex = -1; honeypot.autocomplete = 'off';
    honeypot.setAttribute('aria-hidden', 'true'); honeypot.style.cssText = 'position:absolute;left:-10000px;width:1px;height:1px;opacity:0;';
    form.append(honeypot);
    let notice = null;
    const buttons = [...form.querySelectorAll('button[type="submit"],input[type="submit"]')];
    const labels = buttons.map(button => button.querySelector('.text-block-wrap-div') || button);
    const originals = labels.map(label => label.textContent);
    let submitting = false, pending = null;
    const ensureNotice = () => {
      if (!notice) {
        notice = document.createElement('p'); notice.dataset.formSubmitNotice = ''; notice.setAttribute('role', 'status');
        notice.id = `${form.id || 'lead-form'}-submit-notice-${Math.random().toString(36).slice(2, 8)}`;
        notice.style.cssText = 'width:100%;margin:12px 0;'; form.append(notice);
        // Submit buttons are described by the outcome, so returning focus to them re-reads it.
        buttons.forEach(button => button.setAttribute('aria-describedby', notice.id));
      }
      return notice;
    };
    const show = (message, error = false) => showMessage(ensureNotice(), message, error);
    // Custom field errors also cover inherited templates without required attributes.
    form.noValidate = true;
    form.addEventListener('submit', async event => {
      event.preventDefault(); event.stopImmediatePropagation();
      if (submitting || buttons.some(button => button.disabled)) return;
      const invalid = controls.filter(control => { const message = validationFor(control); setFieldError(control, message); return Boolean(message); });
      if (invalid.length) { show('Проверьте заполнение формы.', true); invalid[0].focus(); return; }
      const payload = { type: form.dataset.leadType, page: location.origin + location.pathname, website: honeypot.value };
      for (const control of controls) payload[control.dataset.leadField] = control.type === 'checkbox' ? control.checked : control.value.trim();
      const signature = JSON.stringify(payload);
      
      submitting = true; buttons.forEach(button => button.disabled = true); labels.forEach(label => label.textContent = 'Отправляем…');
      show('Отправляем заявку…');
      let description = null;
      try {
        if (pending?.signature !== signature) pending = { signature, id: leadId() };
        await requestLead({ ...payload, id: pending.id });
        show('Заявка принята. Мы скоро свяжемся с вами.');
        form.reset(); pending = null;
      } catch (error) {
        // Field values and the pending lead id survive, so a retry is idempotent on the server.
        description = describeFailure(error, 'lead');
        showFailure(ensureNotice(), description);
      }
      finally {
        submitting = false;
        holdSubmit(buttons, labels, originals, description?.retryAfter || 0);
        if (description) keepFocus(form, event.submitter || buttons.find(button => button.offsetParent !== null) || buttons[0], notice);
      }
    }, true);
    form.querySelectorAll('[data-lead-enable]').forEach(button=>button.disabled=false);
    mounted.add(form);
  }
}
