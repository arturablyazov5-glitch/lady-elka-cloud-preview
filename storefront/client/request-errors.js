// One place that turns pay/lead HTTP outcomes into buyer-facing Russian messages.
// Checkout and lead forms both POST through postJson() and render failures through showFailure().

// Fallbacks match the site footer/header markup; live markup wins when present.
const FALLBACK_CONTACTS = {
  phone: { text: '+7 (925) 936-63-00', href: 'tel:+79259366300' },
  telegram: { text: 'Telegram', href: 'https://t.me/lady_elka' },
  whatsapp: { text: 'WhatsApp', href: 'https://wa.me/79259366300' },
};
const MAX_HOLD_SECONDS = 15 * 60;

export class RequestFailure extends Error {
  constructor(kind, { status = 0, retryAfter = null, code = '', serverMessage = '', accepted = false, orderId = '' } = {}) {
    super(kind);
    this.name = 'RequestFailure';
    Object.assign(this, { kind, status, retryAfter, code, serverMessage, accepted, orderId });
  }
}

// Retry-After is either delta-seconds or an HTTP date; anything else is ignored.
export function retryAfterSeconds(value, now = Date.now()) {
  if (value == null || value === '') return null;
  const text = String(value).trim();
  let seconds = /^\d+$/.test(text) ? Number(text) : Math.ceil((Date.parse(text) - now) / 1000);
  if (!Number.isFinite(seconds)) return null;
  seconds = Math.max(1, Math.min(MAX_HOLD_SECONDS, seconds));
  return seconds;
}

export function formatWait(seconds) {
  if (seconds < 60) return `${seconds} сек`;
  return `${Math.ceil(seconds / 60)} мин`;
}

export function classifyStatus(status) {
  if (status === 429) return 'rate';
  if (status === 409) return 'conflict';
  if (status === 413) return 'too-large';
  if (status === 401 || status === 403) return 'auth';
  if (status >= 400 && status < 500) return 'invalid';
  return 'unavailable';
}

const cyrillic = text => typeof text === 'string' && /[а-яё]/i.test(text) ? text.slice(0, 300) : '';

// POST JSON with a timeout. Resolves with the parsed body on success, otherwise throws RequestFailure.
export async function postJson(url, payload, { timeoutMs = 20000, isSuccess = (response) => response.ok, fetchImpl = globalThis.fetch } = {}) {
  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  let timedOut = false;
  const timer = controller ? setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs) : null;
  let response;
  try {
    response = await fetchImpl(url, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload), signal: controller?.signal });
  } catch {
    throw new RequestFailure(timedOut ? 'timeout' : 'network');
  } finally { if (timer) clearTimeout(timer); }
  let body = null;
  try { body = await response.json(); } catch {}
  if (body && typeof body === 'object' && isSuccess(response, body)) return body;
  const result = body && typeof body === 'object' ? body : {};
  const status = Number(response.status) || 0;
  const kind = response.ok ? (body ? 'invalid' : 'unavailable') : classifyStatus(status);
  throw new RequestFailure(kind, {
    status, code: typeof result.error === 'string' ? result.error : '',
    retryAfter: retryAfterSeconds(response.headers?.get?.('Retry-After')),
    serverMessage: cyrillic(result.message), accepted: result.accepted === true, orderId: result.orderId || '',
  });
}

const subjects = {
  order: { rejected: 'Заказ не принят. Проверьте данные формы и корзину и повторите попытку.',
    duplicate: 'Повторите отправку — номер заказа сохранён, дубля не будет.', large: 'Заказ слишком большой: сократите комментарий и повторите попытку.' },
  lead: { rejected: 'Заявка не принята. Проверьте поля и повторите отправку.',
    duplicate: 'Повторите отправку — номер заявки сохранён, дубля не будет.', large: 'Заявка слишком длинная: сократите текст и повторите отправку.' },
};

// Pure description of a failure: text plus what the UI should attach (contacts, refresh action, cooldown).
export function describeFailure(error, subject = 'lead') {
  const words = subjects[subject] || subjects.lead;
  const kind = error instanceof RequestFailure ? error.kind : 'local';
  switch (kind) {
    case 'rate': return { kind, retryAfter: error.retryAfter,
      text: error.retryAfter ? `Слишком много попыток, попробуйте через ${formatWait(error.retryAfter)}.` : 'Слишком много попыток, попробуйте чуть позже.' };
    case 'timeout': case 'network': case 'unavailable': return { kind, contacts: true,
      text: 'Сервис временно недоступен, попробуйте позже или свяжитесь с нами:',
      note: kind === 'timeout' ? words.duplicate : '' };
    case 'conflict':
      if (subject === 'order' && (error.code === 'Catalog changed' || !error.code))
        return { kind, priceChanged: true, text: 'Цены или наличие товаров изменились.' };
      return { kind, text: error.serverMessage || 'Данные изменились. Обновите страницу и проверьте корзину.' };
    case 'too-large': return { kind, text: words.large };
    case 'auth': return { kind, contacts: true, text: 'Не удалось подтвердить запрос. Обновите страницу и повторите попытку или свяжитесь с нами:' };
    case 'invalid': return { kind, text: error.serverMessage || words.rejected };
    default: return { kind, text: error?.message || words.rejected };
  }
}

// Plain-text form of a description (for logs, non-DOM callers and Error.message).
export function failureText(description, doc = globalThis.document) {
  const c = description.contacts ? siteContacts(doc) : null;
  return [description.text, c && `${c.phone.text}, Telegram, WhatsApp.`, description.note].filter(Boolean).join(' ');
}

export function siteContacts(doc = globalThis.document) {
  const pick = (selector, fallback, text) => {
    const link = doc?.querySelector?.(selector);
    const href = link?.getAttribute?.('href');
    return href ? { text: text ?? ((link.textContent || '').trim() || fallback.text), href: href.replace(/\s+/g, '') } : fallback;
  };
  return {
    phone: pick('a[href^="tel:"]', FALLBACK_CONTACTS.phone),
    telegram: pick('a.social__footer[href*="t.me/"]', FALLBACK_CONTACTS.telegram, 'Telegram'),
    whatsapp: pick('a.social__footer[href*="wa.me/"]', FALLBACK_CONTACTS.whatsapp, 'WhatsApp'),
  };
}

const ERROR_COLOR = '#a4262c', OK_COLOR = '#187742';

// Render a plain message into a live region. Errors use role=alert, progress/success role=status.
export function showMessage(notice, message, error = false) {
  notice.setAttribute?.('role', error ? 'alert' : 'status');
  notice.textContent = message;
  if (notice.style) notice.style.color = error ? ERROR_COLOR : OK_COLOR;
  if (notice.dataset) notice.dataset.state = message ? (error ? 'error' : 'ok') : '';
}

// Render a described failure: text, optional contact links and an optional action button.
export function showFailure(notice, description, { action = null, prefix = '' } = {}) {
  showMessage(notice, '', true);
  const doc = notice.ownerDocument;
  if (notice.dataset) notice.dataset.failure = description.kind;
  const text = `${prefix}${description.text}`;
  if (!doc?.createElement || !doc.createTextNode) {
    notice.textContent = failureText({ ...description, text }, doc);
    return;
  }
  const parts = [doc.createTextNode(text)];
  if (description.contacts) {
    const contacts = siteContacts(doc);
    [contacts.phone, contacts.telegram, contacts.whatsapp].forEach((contact, index) => {
      const link = doc.createElement('a');
      link.href = contact.href; link.textContent = contact.text; link.style.color = 'inherit'; link.style.textDecoration = 'underline';
      if (contact.href.startsWith('tel:')) link.style.whiteSpace = 'nowrap';
      else { link.target = '_blank'; link.rel = 'noopener'; }
      parts.push(doc.createTextNode(index ? ', ' : ' '), link);
    });
    parts.push(doc.createTextNode('.'));
  }
  if (description.note) parts.push(doc.createTextNode(` ${description.note}`));
  if (action) {
    const button = doc.createElement('button');
    button.type = 'button'; button.textContent = action.label; button.dataset.noticeAction = '';
    button.style.cssText = 'display:block;margin-top:8px;padding:8px 14px;border:1px solid currentColor;border-radius:8px;background:transparent;color:inherit;font:inherit;cursor:pointer;';
    button.addEventListener('click', action.run);
    parts.push(button);
  }
  notice.append(...parts);
}

// Disabling the focused submit button drops focus to <body>, escaping the cart dialog's focus trap.
// After a failure return focus to the button (or to the message while the button is held for Retry-After).
export function keepFocus(container, button, notice) {
  const doc = container?.ownerDocument;
  const active = doc?.activeElement;
  if (!doc || (active && active !== doc.body && container.contains?.(active))) return;
  if (active && active !== doc.body) return;
  if (button && !button.disabled) { button.focus?.(); return; }
  if (notice) { if (!notice.hasAttribute?.('tabindex')) notice.setAttribute?.('tabindex', '-1'); notice.focus?.(); }
}

// Keep submit controls disabled for the Retry-After window, showing a countdown, then restore them.
// Returns a cancel function. Without a positive delay it restores immediately.
export function holdSubmit(controls, labels, originals, seconds, { setTimer = (fn, ms) => setInterval(fn, ms), clearTimer = id => clearInterval(id) } = {}) {
  const restore = () => { controls.forEach(control => { control.disabled = false; }); labels.forEach((label, index) => { label.textContent = originals[index]; }); };
  if (!(seconds > 0)) { restore(); return () => {}; }
  let left = Math.ceil(seconds);
  const paint = () => labels.forEach(label => { label.textContent = `Повторить через ${formatWait(left)}`; });
  controls.forEach(control => { control.disabled = true; });
  paint();
  const timer = setTimer(() => { left -= 1; if (left <= 0) { clearTimer(timer); restore(); } else paint(); }, 1000);
  timer?.unref?.();
  return () => { clearTimer(timer); restore(); };
}
