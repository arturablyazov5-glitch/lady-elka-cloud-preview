// supabase/functions/_shared/product-rules.mjs
var ACTIVE_VALUES = /* @__PURE__ */ new Set(["1", "true", "t", "да", "yes", "y", "on", "ok", "✓"]);
var TREE_CATEGORY_ORDER = ["Зелёная", "С освещением", "Заснеженная", "Заснеженная с освещением"];
var PROMO_COLUMNS = Object.freeze({
  code: ["promocode", "promo", "code", "код", "промокод"],
  rub: ["ruble-offer", "ruble", "rub-off", "rub", "руб"],
  pct: ["percent-offer", "percent", "pct", "%"],
  gift: ["gift-offer", "gift", "подарок"]
});
function parseCSV(text) {
  const source = String(text != null ? text : "").replace(/^\uFEFF/, "");
  if (!source) return [];
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;
  let fieldStarted = false;
  for (let index = 0; index < source.length; index++) {
    const character = source[index];
    if (quoted) {
      if (character === '"' && source[index + 1] === '"') {
        cell += '"';
        index++;
      } else if (character === '"') {
        quoted = false;
      } else {
        cell += character;
      }
      continue;
    }
    if (character === '"' && !fieldStarted) {
      quoted = true;
      fieldStarted = true;
    } else if (character === ",") {
      row.push(cell);
      cell = "";
      fieldStarted = false;
    } else if (character === "\r" || character === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
      fieldStarted = false;
      if (character === "\r" && source[index + 1] === "\n") index++;
    } else {
      cell += character;
      fieldStarted = true;
    }
  }
  if (quoted) throw new Error("Unterminated quoted CSV field");
  if (fieldStarted || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}
function csvRecords(text) {
  const [headers = [], ...records] = parseCSV(text);
  return records.map((values) => Object.fromEntries(headers.map((header, index) => {
    var _a;
    return [header, (_a = values[index]) != null ? _a : ""];
  })));
}
function isCatalogActive(value) {
  return ACTIVE_VALUES.has(String(value != null ? value : "").trim().toLowerCase());
}
function catalogNumber(value) {
  return Number(String(value != null ? value : "").replace(/[^\d.,-]/g, "").replace(",", ".")) || 0;
}
function treeProducts(rows) {
  const products = /* @__PURE__ */ new Map();
  for (const row of rows) {
    const id = String(row.id || "").trim();
    if (!id) continue;
    if (!products.has(id)) products.set(id, { id, title: row.title, variants: [] });
    if (!isCatalogActive(row.active)) continue;
    const variant = {
      id: `${id}:${row.category}:${row.height_cm}`,
      category: row.category,
      height: catalogNumber(row.height_cm),
      diameter: catalogNumber(row.diameter_cm),
      branches: catalogNumber(row.branches),
      price: catalogNumber(row.price),
      oldPrice: catalogNumber(row.offer),
      discount: catalogNumber(row.discount_pct),
      description: row.description === "-" ? "" : row.description || "",
      photos: String(row.photos || "").split("|").map((photo) => photo.trim()).filter(Boolean)
    };
    if (variant.price > 0 && variant.height > 0) {
      const product = products.get(id);
      if (product.variants.some((item) => item.id === variant.id)) throw new Error(`Duplicate tree variant: ${variant.id}`);
      product.variants.push(variant);
    }
  }
  for (const product of products.values()) {
    product.variants.sort((left, right) => (TREE_CATEGORY_ORDER.indexOf(left.category) + 1 || 99) - (TREE_CATEGORY_ORDER.indexOf(right.category) + 1 || 99) || left.height - right.height);
  }
  return products;
}
function decorProducts(rows) {
  const products = /* @__PURE__ */ new Map();
  for (const row of rows) {
    const id = String(row.id || "").trim();
    if (!id) continue;
    if (!products.has(id)) products.set(id, { id, title: row.title, variants: [] });
    if (!isCatalogActive(row.active)) continue;
    const label = row.variants === "-" ? "" : row.variants || "";
    const dimensions = label.match(/\d+[хxХX]\d+[хxХX]\d+/);
    const variant = {
      id: `${id}:${row.category || ""}:${label}`,
      category: row.category || "",
      size: dimensions ? dimensions[0].replace(/[xХX]/g, "х") : label,
      label,
      price: catalogNumber(row.price),
      description: row.description === "-" ? "" : row.description || "",
      photos: String(row.photos || "").split("|").map((photo) => photo.trim()).filter(Boolean)
    };
    if (variant.price > 0) {
      const product = products.get(id);
      if (product.variants.some((item) => item.id === variant.id)) throw new Error(`Duplicate decor variant: ${variant.id}`);
      product.variants.push(variant);
    }
  }
  return products;
}
function lineTotal(item) {
  return item.price * item.quantity;
}
function cartSubtotal(items2) {
  return items2.reduce((sum, item) => sum + lineTotal(item), 0);
}
function checkoutTotal(items2, promo) {
  const subtotal = cartSubtotal(items2);
  if (!promo || items2.every((item) => item.kind === "decor")) return subtotal;
  const rub = catalogNumber(promo.rub);
  const pct = catalogNumber(promo.pct);
  const discount = rub > 0 ? Math.min(subtotal, rub) : pct > 0 ? subtotal - Math.max(0, Math.round(subtotal * (1 - pct / 100))) : 0;
  return subtotal - discount;
}

// storefront/client/cart-store.js
var KEY = "lady_elka_cart_v2";
var valid = (item) => item && typeof item.productId === "string" && typeof item.variantId === "string" && Number.isFinite(item.price) && item.price > 0 && Number.isInteger(item.quantity) && item.quantity > 0;
var read = () => {
  try {
    const saved = localStorage.getItem(KEY);
    if (saved) return JSON.parse(saved).filter(valid);
    const legacy = JSON.parse(localStorage.getItem("cart") || "[]");
    const migrated = legacy.filter((item) => item.productId && item.variantId && Number(item.price) > 0).map((item) => ({
      productId: String(item.productId),
      variantId: String(item.variantId),
      kind: item.category === "Декор" ? "decor" : "tree",
      title: item.name,
      options: item.category === "Декор" ? { category: item.variantType || "", size: String(item.height || "") } : { category: item.category || "", height: String(item.height || "") },
      price: Number(item.price),
      quantity: Math.max(1, Number(item.qty) || 1),
      image: item.photo || "",
      path: ""
    }));
    if (migrated.length) localStorage.setItem(KEY, JSON.stringify(migrated));
    return migrated;
  } catch {
    return [];
  }
};
var items = read();
var listeners = /* @__PURE__ */ new Set();
function commit() {
  localStorage.setItem(KEY, JSON.stringify(items));
  listeners.forEach((listener) => listener(getItems()));
}
var getItems = () => items.map((item) => ({ ...item, options: { ...item.options } }));
function clear() {
  items = [];
  commit();
}
function reprice(lookup) {
  let changed = 0, removed = 0;
  const next = [];
  for (const item of items) {
    const current = lookup(item);
    if (!current || !(current.price > 0)) {
      removed++;
      continue;
    }
    if (current.price !== item.price) {
      changed++;
      next.push({ ...item, price: current.price });
    } else next.push(item);
  }
  if (changed || removed) {
    items = next;
    commit();
  }
  return { changed, removed };
}

// storefront/client/request-errors.js
var FALLBACK_CONTACTS = {
  phone: { text: "+7 (925) 936-63-00", href: "tel:+79259366300" },
  telegram: { text: "Telegram", href: "https://t.me/lady_elka" },
  whatsapp: { text: "WhatsApp", href: "https://wa.me/79259366300" }
};
var MAX_HOLD_SECONDS = 15 * 60;
var RequestFailure = class extends Error {
  constructor(kind, { status = 0, retryAfter = null, code = "", serverMessage = "", accepted = false, orderId = "" } = {}) {
    super(kind);
    this.name = "RequestFailure";
    Object.assign(this, { kind, status, retryAfter, code, serverMessage, accepted, orderId });
  }
};
function retryAfterSeconds(value, now = Date.now()) {
  if (value == null || value === "") return null;
  const text = String(value).trim();
  let seconds = /^\d+$/.test(text) ? Number(text) : Math.ceil((Date.parse(text) - now) / 1e3);
  if (!Number.isFinite(seconds)) return null;
  seconds = Math.max(1, Math.min(MAX_HOLD_SECONDS, seconds));
  return seconds;
}
function formatWait(seconds) {
  if (seconds < 60) return `${seconds} сек`;
  return `${Math.ceil(seconds / 60)} мин`;
}
function classifyStatus(status) {
  if (status === 429) return "rate";
  if (status === 409) return "conflict";
  if (status === 413) return "too-large";
  if (status === 401 || status === 403) return "auth";
  if (status >= 400 && status < 500) return "invalid";
  return "unavailable";
}
var cyrillic = (text) => typeof text === "string" && /[а-яё]/i.test(text) ? text.slice(0, 300) : "";
async function postJson(url, payload, { timeoutMs = 2e4, isSuccess = (response) => response.ok, fetchImpl = globalThis.fetch } = {}) {
  var _a, _b;
  const controller = typeof AbortController === "function" ? new AbortController() : null;
  let timedOut = false;
  const timer = controller ? setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs) : null;
  let response;
  try {
    response = await fetchImpl(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller == null ? void 0 : controller.signal
    });
  } catch {
    throw new RequestFailure(timedOut ? "timeout" : "network");
  } finally {
    if (timer) clearTimeout(timer);
  }
  let body = null;
  try {
    body = await response.json();
  } catch {
  }
  if (body && typeof body === "object" && isSuccess(response, body)) return body;
  const result = body && typeof body === "object" ? body : {};
  const status = Number(response.status) || 0;
  const kind = response.ok ? body ? "invalid" : "unavailable" : classifyStatus(status);
  throw new RequestFailure(kind, {
    status,
    code: typeof result.error === "string" ? result.error : "",
    retryAfter: retryAfterSeconds((_b = (_a = response.headers) == null ? void 0 : _a.get) == null ? void 0 : _b.call(_a, "Retry-After")),
    serverMessage: cyrillic(result.message),
    accepted: result.accepted === true,
    orderId: result.orderId || ""
  });
}
var subjects = {
  order: {
    rejected: "Заказ не принят. Проверьте данные формы и корзину и повторите попытку.",
    duplicate: "Повторите отправку — номер заказа сохранён, дубля не будет.",
    large: "Заказ слишком большой: сократите комментарий и повторите попытку."
  },
  lead: {
    rejected: "Заявка не принята. Проверьте поля и повторите отправку.",
    duplicate: "Повторите отправку — номер заявки сохранён, дубля не будет.",
    large: "Заявка слишком длинная: сократите текст и повторите отправку."
  }
};
function describeFailure(error, subject = "lead") {
  const words = subjects[subject] || subjects.lead;
  const kind = error instanceof RequestFailure ? error.kind : "local";
  switch (kind) {
    case "rate":
      return {
        kind,
        retryAfter: error.retryAfter,
        text: error.retryAfter ? `Слишком много попыток, попробуйте через ${formatWait(error.retryAfter)}.` : "Слишком много попыток, попробуйте чуть позже."
      };
    case "timeout":
    case "network":
    case "unavailable":
      return {
        kind,
        contacts: true,
        text: "Сервис временно недоступен, попробуйте позже или свяжитесь с нами:",
        note: kind === "timeout" ? words.duplicate : ""
      };
    case "conflict":
      if (subject === "order" && (error.code === "Catalog changed" || !error.code))
        return { kind, priceChanged: true, text: "Цены или наличие товаров изменились." };
      return { kind, text: error.serverMessage || "Данные изменились. Обновите страницу и проверьте корзину." };
    case "too-large":
      return { kind, text: words.large };
    case "auth":
      return { kind, contacts: true, text: "Не удалось подтвердить запрос. Обновите страницу и повторите попытку или свяжитесь с нами:" };
    case "invalid":
      return { kind, text: error.serverMessage || words.rejected };
    default:
      return { kind, text: (error == null ? void 0 : error.message) || words.rejected };
  }
}
function failureText(description, doc = globalThis.document) {
  const c = description.contacts ? siteContacts(doc) : null;
  return [description.text, c && `${c.phone.text}, Telegram, WhatsApp.`, description.note].filter(Boolean).join(" ");
}
function siteContacts(doc = globalThis.document) {
  const pick = (selector, fallback, text) => {
    var _a, _b;
    const link = (_a = doc == null ? void 0 : doc.querySelector) == null ? void 0 : _a.call(doc, selector);
    const href = (_b = link == null ? void 0 : link.getAttribute) == null ? void 0 : _b.call(link, "href");
    return href ? { text: text != null ? text : (link.textContent || "").trim() || fallback.text, href: href.replace(/\s+/g, "") } : fallback;
  };
  return {
    phone: pick('a[href^="tel:"]', FALLBACK_CONTACTS.phone),
    telegram: pick('a.social__footer[href*="t.me/"]', FALLBACK_CONTACTS.telegram, "Telegram"),
    whatsapp: pick('a.social__footer[href*="wa.me/"]', FALLBACK_CONTACTS.whatsapp, "WhatsApp")
  };
}
var ERROR_COLOR = "#a4262c";
var OK_COLOR = "#187742";
function showMessage(notice, message, error = false) {
  var _a;
  (_a = notice.setAttribute) == null ? void 0 : _a.call(notice, "role", error ? "alert" : "status");
  notice.textContent = message;
  if (notice.style) notice.style.color = error ? ERROR_COLOR : OK_COLOR;
  if (notice.dataset) notice.dataset.state = message ? error ? "error" : "ok" : "";
}
function showFailure(notice, description, { action = null, prefix = "" } = {}) {
  showMessage(notice, "", true);
  const doc = notice.ownerDocument;
  if (notice.dataset) notice.dataset.failure = description.kind;
  const text = `${prefix}${description.text}`;
  if (!(doc == null ? void 0 : doc.createElement) || !doc.createTextNode) {
    notice.textContent = failureText({ ...description, text }, doc);
    return;
  }
  const parts = [doc.createTextNode(text)];
  if (description.contacts) {
    const contacts = siteContacts(doc);
    [contacts.phone, contacts.telegram, contacts.whatsapp].forEach((contact, index) => {
      const link = doc.createElement("a");
      link.href = contact.href;
      link.textContent = contact.text;
      link.style.color = "inherit";
      link.style.textDecoration = "underline";
      if (contact.href.startsWith("tel:")) link.style.whiteSpace = "nowrap";
      else {
        link.target = "_blank";
        link.rel = "noopener";
      }
      parts.push(doc.createTextNode(index ? ", " : " "), link);
    });
    parts.push(doc.createTextNode("."));
  }
  if (description.note) parts.push(doc.createTextNode(` ${description.note}`));
  if (action) {
    const button = doc.createElement("button");
    button.type = "button";
    button.textContent = action.label;
    button.dataset.noticeAction = "";
    button.style.cssText = "display:block;margin-top:8px;padding:8px 14px;border:1px solid currentColor;border-radius:8px;background:transparent;color:inherit;font:inherit;cursor:pointer;";
    button.addEventListener("click", action.run);
    parts.push(button);
  }
  notice.append(...parts);
}
function keepFocus(container, button, notice) {
  var _a, _b, _c, _d, _e;
  const doc = container == null ? void 0 : container.ownerDocument;
  const active = doc == null ? void 0 : doc.activeElement;
  if (!doc || active && active !== doc.body && ((_a = container.contains) == null ? void 0 : _a.call(container, active))) return;
  if (active && active !== doc.body) return;
  if (button && !button.disabled) {
    (_b = button.focus) == null ? void 0 : _b.call(button);
    return;
  }
  if (notice) {
    if (!((_c = notice.hasAttribute) == null ? void 0 : _c.call(notice, "tabindex"))) (_d = notice.setAttribute) == null ? void 0 : _d.call(notice, "tabindex", "-1");
    (_e = notice.focus) == null ? void 0 : _e.call(notice);
  }
}
function holdSubmit(controls, labels, originals, seconds, { setTimer = (fn, ms) => setInterval(fn, ms), clearTimer = (id) => clearInterval(id) } = {}) {
  var _a;
  const restore = () => {
    controls.forEach((control) => {
      control.disabled = false;
    });
    labels.forEach((label, index) => {
      label.textContent = originals[index];
    });
  };
  if (!(seconds > 0)) {
    restore();
    return () => {
    };
  }
  let left = Math.ceil(seconds);
  const paint = () => labels.forEach((label) => {
    label.textContent = `Повторить через ${formatWait(left)}`;
  });
  controls.forEach((control) => {
    control.disabled = true;
  });
  paint();
  const timer = setTimer(() => {
    left -= 1;
    if (left <= 0) {
      clearTimer(timer);
      restore();
    } else paint();
  }, 1e3);
  (_a = timer == null ? void 0 : timer.unref) == null ? void 0 : _a.call(timer);
  return () => {
    clearTimer(timer);
    restore();
  };
}

// storefront/client/order-payload.js
function paymentItemLabel(item) {
  if (item.kind === "decor") return [item.title, item.options.size, item.options.category, "(Декор)"].filter(Boolean).join(" ");
  return [
    item.title,
    item.options.height ? `${item.options.height} см` : "",
    item.options.category ? `(${item.options.category})` : ""
  ].filter(Boolean).join(" ");
}
function buildOrderPayload(items2, customer, promo = null, origin = location.origin, timestamp = Date.now(), paymentMethod = "card") {
  if (!items2.length) throw new Error("Корзина пуста");
  const amount = checkoutTotal(items2, promo);
  const orderId = `LE-${timestamp}-${String(items2[0].options.height || "").slice(0, 6)}-${crypto.randomUUID().slice(0, 8)}`;
  const lines = items2.map((item) => `${paymentItemLabel(item)}${item.quantity > 1 ? ` x${item.quantity}` : ""} — ${lineTotal(item)} ₽`);
  const discountLabel = promo && amount < cartSubtotal(items2) ? promo.rub > 0 ? `${promo.rub} ₽` : `${promo.pct}% (${cartSubtotal(items2) - amount} ₽)` : "";
  const description = [
    lines.join(" | "),
    `Покупатель: ${customer.name}`,
    `Почта: ${customer.email}`,
    `Телефон: ${customer.phone}`,
    `Адрес: ${customer.address}`,
    `Связь: ${customer.contactPref}`,
    (promo == null ? void 0 : promo.code) ? `Промо: ${promo.code}` : "",
    discountLabel ? `Скидка по промокоду: ${discountLabel}` : "",
    (promo == null ? void 0 : promo.gift) && items2.some((item) => item.kind !== "decor") ? `Подарок по промокоду: ${promo.giftText || "да"}` : ""
  ].filter(Boolean).join(" | ");
  return {
    amount,
    description,
    email: customer.email,
    phone: customer.phone,
    paymentMethod,
    customer: { ...customer },
    delivery: { address: customer.address },
    items: items2.map((item) => ({
      productId: item.productId,
      variantId: item.variantId,
      kind: item.kind,
      quantity: item.quantity,
      price: item.price
    })),
    promo: promo ? {
      code: promo.code || "",
      rub: promo.rub || 0,
      pct: promo.pct || 0,
      gift: !!promo.gift,
      giftText: promo.giftText || ""
    } : null,
    orderId,
    clientId: customer.name || "Леди Елка",
    successUrl: `${origin}/spasibo?oid=${encodeURIComponent(orderId)}`,
    failUrl: `${origin}/pay-return?fail=1&oid=${encodeURIComponent(orderId)}`,
    promoCode: (promo == null ? void 0 : promo.code) || "",
    address: customer.address,
    contactPref: customer.contactPref
  };
}

// storefront/client/config.js
function config() {
  const value = globalThis.__LE_STOREFRONT_CONFIG__;
  if (!value || !["preview", "production"].includes(value.mode)) throw new Error("Конфигурация витрины отсутствует");
  return value;
}
function catalogEndpoint(name) {
  var _a;
  const endpoint = (_a = config().catalog) == null ? void 0 : _a[name];
  if (!endpoint) throw new Error("Источник каталога не настроен");
  return endpoint;
}
function paymentEndpoint() {
  const endpoint = config().payment;
  if (!endpoint) throw new Error("Оформление заказов отключено в локальном просмотре.");
  return endpoint;
}
function leadEndpoint() {
  const settings = globalThis.__LE_STOREFRONT_CONFIG__;
  if (!settings) return "https://mgnotvaahftrbifqtahf.supabase.co/functions/v1/lead";
  if (!settings.lead) throw new Error("Отправка заявок отключена в локальном просмотре.");
  return settings.lead;
}

// storefront/products/presentation.mjs
var catalogPhotos = (photos) => [...new Set((photos || []).filter((value) => /^(https:\/\/|\/media\/catalog-pinned\/[a-f0-9]{64}\.(webp|jpg|png)$)/i.test(String(value || "").trim())).map((value) => String(value).trim()))].filter((url) => !/placeholder/i.test(url));
function pinPhotos(raw, lookup, strict = true) {
  return catalogPhotos(String(raw != null ? raw : "").split("|")).map((url) => {
    const pinned = lookup(url);
    if (!pinned && strict) throw new Error(`Missing preview media mapping: ${url}`);
    return pinned || url;
  }).join("|");
}

// storefront/products/model.mjs
var treeProducts2 = (rows) => treeProducts(rows);
var decorProducts2 = (rows) => decorProducts(rows);
var mediaMap;
function pinnedMedia() {
  var _a;
  const url = (_a = globalThis.__LE_STOREFRONT_CONFIG__) == null ? void 0 : _a.mediaMap;
  if (!url) return Promise.resolve(null);
  mediaMap || (mediaMap = fetch(url).then((response) => response.ok ? response.json() : null).catch(() => null));
  return mediaMap;
}
async function loadProducts(url, filename, buildProducts) {
  const [response, map] = await Promise.all([fetch(url, { cache: "no-store" }), pinnedMedia()]);
  if (!response.ok) throw new Error(`Supabase ${filename}: ${response.status}`);
  const rows = csvRecords(await response.text());
  return buildProducts(map ? rows.map((row) => row.photos === void 0 ? row : { ...row, photos: pinPhotos(row.photos, (raw) => map[raw], false) }) : rows);
}
function loadTreeProducts() {
  return loadProducts(catalogEndpoint("trees"), "trees.csv", treeProducts2);
}
function loadDecorProducts() {
  return loadProducts(catalogEndpoint("decor"), "decor.csv", decorProducts2);
}

// storefront/client/phone-mask.js
var attachedMasks = /* @__PURE__ */ new WeakMap();
function formatRussianPhone(rawValue, caretPosition = String(rawValue || "").length) {
  const raw = String(rawValue || "");
  const digits = raw.replace(/\D/g, "");
  if (!digits) return { value: "", caret: 0, localDigits: "" };
  const explicitCountryPrefix = /^\s*\+7(?:\D|$)/.test(raw);
  const pastedCountryPrefix = digits.length > 10 && /^[78]/.test(digits);
  const hasCountryPrefix = explicitCountryPrefix || pastedCountryPrefix;
  const localDigits = (hasCountryPrefix ? digits.slice(1) : digits).slice(0, 10);
  const prefixDigitIndex = hasCountryPrefix ? raw.search(/[78]/) : -1;
  let value = "+7";
  if (localDigits.length) {
    value += ` (${localDigits.slice(0, 3)}`;
    if (localDigits.length > 3) value += `) ${localDigits.slice(3, 6)}`;
    if (localDigits.length > 6) value += `-${localDigits.slice(6, 8)}`;
    if (localDigits.length > 8) value += `-${localDigits.slice(8, 10)}`;
  }
  let localDigitsBeforeCaret = raw.slice(0, caretPosition).replace(/\D/g, "").length;
  if (prefixDigitIndex >= 0 && caretPosition > prefixDigitIndex) localDigitsBeforeCaret -= 1;
  localDigitsBeforeCaret = Math.max(0, Math.min(localDigits.length, localDigitsBeforeCaret));
  let caret = value.length;
  if (localDigitsBeforeCaret === 0) {
    caret = localDigits.length ? value.indexOf("(") : value.length;
  } else {
    let seen = 0;
    for (let index = value.indexOf("(") + 1; index < value.length; index += 1) {
      if (/\d/.test(value[index]) && ++seen === localDigitsBeforeCaret) {
        caret = index + 1;
        break;
      }
    }
  }
  return { value, caret, localDigits };
}
function attachRussianPhoneMask(input) {
  if (!input) return () => {
  };
  const existing = attachedMasks.get(input);
  if (existing) return existing;
  const maskPhone = () => {
    var _a;
    const formatted = formatRussianPhone(input.value, (_a = input.selectionStart) != null ? _a : input.value.length);
    input.value = formatted.value;
    try {
      input.setSelectionRange(formatted.caret, formatted.caret);
    } catch {
    }
  };
  input.addEventListener("input", maskPhone);
  maskPhone();
  const cleanup = () => {
    input.removeEventListener("input", maskPhone);
    attachedMasks.delete(input);
  };
  attachedMasks.set(input, cleanup);
  return cleanup;
}
function initPhoneMasks(root = document) {
  const inputs = new Set(root.querySelectorAll(
    'input[type="tel"]:not([data-checkout-field="phone"]), input[name="phone"]:not([data-checkout-field="phone"])'
  ));
  inputs.forEach(attachRussianPhoneMask);
}

// storefront/client/checkout.js
var mounted = /* @__PURE__ */ new WeakMap();
var checkoutLabels = {
  name: ["Имя и фамилия", "name"],
  email: ["Электронная почта", "email"],
  phone: ["Телефон", "tel"],
  address: ["Адрес доставки", "shipping street-address"],
  comment: ["Комментарий к заказу", "off"],
  contactPref: ["Предпочтительный способ связи", null],
  method: ["Способ оплаты", null]
};
var labelCount = 0;
function describeCheckoutControls(form, controls) {
  var _a, _b, _c, _d;
  const document2 = form.ownerDocument;
  if (!(document2 == null ? void 0 : document2.createElement)) return;
  const label = (control, text) => {
    var _a2, _b2;
    if (!control || ((_a2 = control.labels) == null ? void 0 : _a2.length) || ((_b2 = control.hasAttribute) == null ? void 0 : _b2.call(control, "aria-labelledby"))) return;
    if (!control.id) control.id = `storefront-checkout-field-${++labelCount}`;
    const node = document2.createElement("label");
    node.className = control.hidden ? "storefront-visually-hidden" : "storefront-checkout-label";
    node.htmlFor = control.id;
    node.textContent = text;
    control.before(node);
  };
  for (const [key, [text, autocomplete]] of Object.entries(checkoutLabels)) {
    const control = controls[key];
    if (!control) continue;
    label(control, text);
    if (autocomplete && control.setAttribute) control.setAttribute("autocomplete", autocomplete);
    if (["name", "email", "phone", "address"].includes(key)) (_a = control.setAttribute) == null ? void 0 : _a.call(control, "aria-required", "true");
  }
  const promo = (_b = form.querySelector) == null ? void 0 : _b.call(form, "[data-promo-input]");
  if (promo) {
    label(promo, "Промокод");
    promo.setAttribute("autocomplete", "off");
  }
  const consent = controls.consent;
  const agreement = (_d = (_c = consent == null ? void 0 : consent.closest) == null ? void 0 : _c.call(consent, ".checkbox-wrapper__form")) == null ? void 0 : _d.querySelector(":scope > .text");
  if (consent && agreement) {
    if (!agreement.id) agreement.id = `storefront-checkout-consent-${++labelCount}`;
    consent.setAttribute("aria-labelledby", agreement.id);
    consent.setAttribute("aria-required", "true");
  }
}
function initCheckout(form, getPromo, cartStore = { getItems, clear, reprice }) {
  var _a, _b, _c, _d;
  const { getItems: getItems2, clear: clear2, reprice: reprice2 } = cartStore;
  if (!form) return;
  if (((_a = mounted.get(form)) == null ? void 0 : _a()) === false) return;
  let submitting = false;
  const pendingKey = "lady_elka_pending_order_v1";
  let pending = null;
  try {
    pending = JSON.parse(((_b = globalThis.sessionStorage) == null ? void 0 : _b.getItem(pendingKey)) || "null");
  } catch {
  }
  const draftKey = "lady_elka_checkout_draft_v1";
  const fields = Object.fromEntries(["name", "email", "phone", "address", "contactPref", "comment", "paymentMethod"].map((key) => [key === "paymentMethod" ? "method" : key, `[data-checkout-field="${key}"]`]));
  const controls = {};
  for (const [key, selector] of [...Object.entries(fields), ["consent", '[data-checkout-field="consent"]']]) {
    const matches = [...form.querySelectorAll(selector)];
    if (matches.length !== 1) throw new Error(`Checkout field ${key}: expected exactly one control, found ${matches.length}`);
    controls[key] = matches[0];
  }
  describeCheckoutControls(form, controls);
  const phoneInput = controls.phone;
  const unmaskPhone = attachRussianPhoneMask(phoneInput);
  let draft = null;
  try {
    draft = JSON.parse(((_c = globalThis.sessionStorage) == null ? void 0 : _c.getItem(draftKey)) || "null");
  } catch {
  }
  if (draft && typeof draft === "object") {
    for (const key of Object.keys(fields)) {
      const input = controls[key];
      if (typeof draft[key] === "string") {
        const oldMethods = { "Оплата картой": "card", "Оплата картой онлайн": "card", "Оплата при получении": "cash_on_delivery" };
        input.value = key === "method" ? oldMethods[draft[key]] || draft[key] : key === "phone" ? formatRussianPhone(draft[key]).value : draft[key];
      }
    }
    const consent = controls.consent;
    if (consent) consent.checked = draft.consent === true;
  }
  const saveDraft = () => {
    var _a2, _b2;
    const values = Object.fromEntries(Object.keys(fields).map((key) => [key, controls[key].value || ""]));
    values.consent = ((_a2 = controls.consent) == null ? void 0 : _a2.checked) === true;
    try {
      (_b2 = globalThis.sessionStorage) == null ? void 0 : _b2.setItem(draftKey, JSON.stringify(values));
    } catch {
    }
  };
  const clearDraft = () => {
    var _a2;
    try {
      (_a2 = globalThis.sessionStorage) == null ? void 0 : _a2.removeItem(draftKey);
    } catch {
    }
  };
  form.addEventListener("input", saveDraft);
  form.addEventListener("change", saveDraft);
  const savePending = () => {
    var _a2;
    if (!pending) {
      try {
        (_a2 = globalThis.sessionStorage) == null ? void 0 : _a2.removeItem(pendingKey);
      } catch {
      }
      return;
    }
    try {
      const storage = globalThis.sessionStorage;
      const serialized = JSON.stringify(pending);
      storage.setItem(pendingKey, serialized);
      if (storage.getItem(pendingKey) !== serialized) throw new Error("Pending order readback mismatch");
    } catch {
      throw new Error("Не удалось сохранить номер заказа в браузере. Отправка остановлена. Разрешите хранение данных в этой вкладке и повторите попытку; форма и корзина не очищены.");
    }
  };
  const button = form.querySelector("[data-pay-now]");
  const label = (button == null ? void 0 : button.querySelector(".text-block-wrap-div")) || button;
  const originalLabel = (label == null ? void 0 : label.textContent) || "купить";
  const notice = document.createElement("p");
  notice.setAttribute("role", "status");
  notice.dataset && (notice.dataset.checkoutNotice = "");
  notice.style.margin = "12px 0";
  notice.style.width = "100%";
  if ((button == null ? void 0 : button.parentElement) && button.parentElement !== form) button.parentElement.after(notice);
  else button == null ? void 0 : button.after(notice);
  const show = (message, error = false) => showMessage(notice, message, error);
  if (!notice.id) notice.id = `storefront-checkout-status-${++labelCount}`;
  (_d = button == null ? void 0 : button.setAttribute) == null ? void 0 : _d.call(button, "aria-describedby", notice.id);
  let cancelHold = () => {
  };
  const lookupFresh = async () => {
    const [trees, decor] = await Promise.all([loadTreeProducts(), loadDecorProducts()]);
    return (item) => {
      var _a2;
      return ((_a2 = (item.kind === "decor" ? decor : trees).get(item.productId)) == null ? void 0 : _a2.variants.find((v) => v.id === item.variantId)) || null;
    };
  };
  const refreshCart = async () => {
    let result;
    try {
      result = reprice2(await lookupFresh());
    } catch {
      return reportFailure(new RequestFailure("network"));
    }
    pending = null;
    savePendingQuietly();
    if (!getItems2().length) return show("Товары из корзины больше недоступны. Корзина пересчитана — выберите товары заново.", true);
    if (result.changed || result.removed) return show(`Цены обновились, корзина пересчитана${result.removed ? " (недоступные товары удалены)" : ""}. Проверьте сумму и оформите заказ снова.`, true);
    show("Корзина проверена: цены актуальны. Оформите заказ снова.");
  };
  const savePendingQuietly = () => {
    try {
      savePending();
    } catch {
    }
  };
  const reportFailure = async (error) => {
    if (error == null ? void 0 : error.accepted) {
      show(`Заказ № ${error.orderId} сохранён. ${error.serverMessage || "Мы свяжемся с вами для подтверждения."}`, true);
      return;
    }
    const description = describeFailure(error, "order");
    if (description.priceChanged) {
      let result = null;
      try {
        result = reprice2(await lookupFresh());
      } catch {
      }
      if (result) {
        pending = null;
        savePendingQuietly();
      }
      if (result && (result.changed || result.removed))
        return show(`Цены обновились, корзина пересчитана${result.removed ? " (недоступные товары удалены)" : ""}. Проверьте сумму и оформите заказ снова.`, true);
      return showFailure(
        notice,
        { ...description, text: "Цены или наличие товаров изменились. Обновите корзину и проверьте сумму." },
        { action: { label: "Обновить корзину", run: () => {
          void refreshCart();
        } } }
      );
    }
    showFailure(notice, description, { prefix: description.kind === "local" ? "Не удалось оформить заказ: " : "" });
    if (description.retryAfter) cancelHold = holdSubmit([button], [label], [originalLabel], description.retryAfter);
  };
  const markInvalid = (invalid) => {
    var _a2, _b2;
    for (const [key, bad] of Object.entries(invalid)) {
      const control = controls[key];
      if (!(control == null ? void 0 : control.setAttribute)) continue;
      if (bad) {
        control.setAttribute("aria-invalid", "true");
        control.setAttribute("aria-describedby", notice.id);
      } else {
        control.removeAttribute("aria-invalid");
        control.removeAttribute("aria-describedby");
      }
    }
    const first = Object.keys(invalid).find((key) => invalid[key]);
    if (first) (_b2 = (_a2 = controls[first]) == null ? void 0 : _a2.focus) == null ? void 0 : _b2.call(_a2);
  };
  const clearInvalid = (event) => {
    var _a2, _b2;
    if (((_b2 = (_a2 = event.target) == null ? void 0 : _a2.getAttribute) == null ? void 0 : _b2.call(_a2, "aria-invalid")) === "true") {
      event.target.removeAttribute("aria-invalid");
      event.target.removeAttribute("aria-describedby");
    }
  };
  form.addEventListener("input", clearInvalid);
  form.addEventListener("change", clearInvalid);
  const submit = async (event) => {
    var _a2;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (submitting || (button == null ? void 0 : button.disabled)) return;
    saveDraft();
    show("");
    const items2 = getItems2();
    if (!items2.length) {
      alert("Корзина пуста");
      return;
    }
    const value = (key) => controls[key].value.trim();
    const customer = Object.fromEntries(["name", "email", "phone", "address", "contactPref", "comment"].map((key) => [key, value(key)]));
    const invalid = {
      name: !customer.name,
      email: !/^\S+@\S+\.\S+$/.test(customer.email),
      phone: formatRussianPhone(customer.phone).localDigits.length < 10,
      address: !customer.address,
      contactPref: !customer.contactPref
    };
    markInvalid(invalid);
    if (Object.values(invalid).some(Boolean)) {
      show("Заполните имя, почту, телефон, адрес и способ связи.", true);
      return;
    }
    if (!((_a2 = controls.consent) == null ? void 0 : _a2.checked)) {
      show("Подтвердите согласие на обработку персональных данных.", true);
      markInvalid({ consent: true });
      return;
    }
    const paymentMethod = value("method");
    if (!["card", "cash_on_delivery"].includes(paymentMethod)) {
      show("Выберите способ оплаты.", true);
      markInvalid({ method: true });
      return;
    }
    const promo = getPromo();
    const signature = JSON.stringify({ items: items2, customer, promo, paymentMethod });
    const retry = (pending == null ? void 0 : pending.signature) === signature;
    const payload = retry ? pending.payload : buildOrderPayload(items2, customer, promo, location.origin, Date.now(), paymentMethod);
    if (!payload.amount) {
      show("Сумма заказа нулевая.", true);
      return;
    }
    submitting = true;
    button.disabled = true;
    label.textContent = "Оформляем заказ…";
    let failure = null;
    try {
      if (!retry) {
        let lookup;
        try {
          lookup = await lookupFresh();
        } catch {
          throw new RequestFailure("network");
        }
        if (items2.some((item) => {
          var _a3;
          return ((_a3 = lookup(item)) == null ? void 0 : _a3.price) !== item.price;
        })) throw new RequestFailure("conflict", { status: 409, code: "Catalog changed" });
      }
      pending = { signature, payload };
      savePending();
      const ENDPOINT = paymentEndpoint();
      const url = paymentMethod === "cash_on_delivery" ? `${ENDPOINT}?action=create-cod-order` : ENDPOINT;
      const result = await postJson(url, payload, { timeoutMs: 3e4 });
      if (result.paid === true) {
        clear2();
        pending = null;
        savePending();
        form.reset();
        clearDraft();
        show(`Заказ № ${result.orderId || payload.orderId} оплачен. Мы скоро свяжемся с вами.`);
        return;
      }
      if (paymentMethod === "cash_on_delivery") {
        if (!result.ok || !result.orderId) throw new Error("Подтверждение заказа не получено");
        clear2();
        pending = null;
        savePending();
        form.reset();
        clearDraft();
        show(`Заказ № ${result.orderId} оформлен. Мы скоро свяжемся с вами.`);
        return;
      }
      if (!result.url) throw new Error("Ссылка оплаты не получена");
      location.assign(result.url);
    } catch (error) {
      failure = error;
    } finally {
      button.disabled = false;
      label.textContent = originalLabel;
      if (!failure) submitting = false;
    }
    if (failure) try {
      await reportFailure(failure);
    } finally {
      submitting = false;
      keepFocus(form, button, notice);
    }
  };
  form.addEventListener("submit", submit, true);
  mounted.set(form, () => {
    var _a2, _b2, _c2, _d2, _e, _f;
    if (submitting) return false;
    (_a2 = form.removeEventListener) == null ? void 0 : _a2.call(form, "input", saveDraft);
    (_b2 = form.removeEventListener) == null ? void 0 : _b2.call(form, "change", saveDraft);
    (_c2 = form.removeEventListener) == null ? void 0 : _c2.call(form, "input", clearInvalid);
    (_d2 = form.removeEventListener) == null ? void 0 : _d2.call(form, "change", clearInvalid);
    (_e = form.removeEventListener) == null ? void 0 : _e.call(form, "submit", submit, true);
    cancelHold();
    unmaskPhone();
    (_f = notice.remove) == null ? void 0 : _f.call(notice);
  });
}

// storefront/client/form-presentation.js
function describeLeadControl(control) {
  var _a;
  const autocomplete = { name: "name", phone: "tel", email: "email", city: "address-level2" }[control.dataset.leadField];
  if (autocomplete && !control.hasAttribute("autocomplete")) control.setAttribute("autocomplete", autocomplete);
  if (control.type !== "checkbox" && !((_a = control.labels) == null ? void 0 : _a.length) && !control.hasAttribute("aria-label") && control.id && control.placeholder) {
    const label = document.createElement("label");
    label.className = "storefront-visually-hidden";
    label.htmlFor = control.id;
    label.textContent = control.placeholder.replace(/\*+\s*$/, "").trim();
    control.before(label);
  }
  if (control.type !== "checkbox") control.maxLength = { name: 120, phone: 40, email: 200, comment: 1500, city: 100, business: 200 }[control.dataset.leadField] || 200;
}

// storefront/client/lead-schema.js
var leadForms = {
  iawvkogkq_0: { type: "question", fields: ["comment", "phone", "consent"] },
  iu4a9894i_0: { type: "installment", fields: ["name", "phone", "comment", "consent"] },
  ibfs75na0_0: { type: "consultation", fields: ["name", "phone", "comment", "consent"] },
  i1hecfw24_0: { type: "consultation", fields: ["name", "phone", "comment", "consent"] },
  ir9vcpl2u_0: { type: "wholesale", fields: ["name", "email", "phone", "city", "business", "consent"] },
  iiv1gzzdr_0: { type: "wholesale", fields: ["name", "email", "phone", "city", "business", "consent"] }
};

// storefront/client/forms.js
var mounted2 = /* @__PURE__ */ new WeakSet();
function leadId() {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = bytes[6] & 15 | 64;
  bytes[8] = bytes[8] & 63 | 128;
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
function requestLead(payload, { timeoutMs = 2e4 } = {}) {
  return postJson(leadEndpoint(), payload, { timeoutMs, isSuccess: (response, result) => response.ok && result.ok === true }).catch((error) => {
    error.message = failureText(describeFailure(error, "lead"));
    throw error;
  });
}
function validLeadPhone(value) {
  const raw = String(value).trim();
  const digits = raw.replace(/\D/g, "");
  return /^[+\d\s()\-]+$/.test(raw) && (/^\d{10}$/.test(digits) || /^[78]\d{10}$/.test(digits));
}
function validationFor(control) {
  if (control.type === "checkbox") return control.checked ? "" : "Подтвердите согласие на обработку персональных данных";
  const value = String(control.value || "").trim();
  if (!value) return control.required ? "Это поле обязательно для заполнения" : "";
  if (control.type === "email" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return "Введите корректный адрес электронной почты";
  if (control.type === "tel" && !validLeadPhone(value)) return "Введите корректный номер телефона";
  if (control.maxLength > 0 && value.length > control.maxLength) return "Превышена допустимая длина поля";
  return "";
}
function setFieldError(control, message) {
  const field = control.closest(".form__field");
  const error = field == null ? void 0 : field.querySelector(".form__field-error");
  field == null ? void 0 : field.classList.toggle("is-error", Boolean(message));
  if (message) {
    if (error) (error.querySelector(".text-block-wrap-div") || error).textContent = message;
    control.setAttribute("aria-invalid", "true");
    if (error == null ? void 0 : error.id) control.setAttribute("aria-describedby", error.id);
  } else {
    control.removeAttribute("aria-invalid");
    control.removeAttribute("aria-describedby");
  }
}
function initForms(root = document) {
  for (const form of root.querySelectorAll("form")) {
    if (mounted2.has(form) || form.matches("[data-pay-now]") || form.querySelector("[data-pay-now]")) continue;
    if (form.method.toLowerCase() === "get" && new URL(form.action, location.href).pathname === "/search") continue;
    if (form.querySelector(".js-flt")) {
      form.addEventListener("submit", (event) => event.preventDefault(), true);
      mounted2.add(form);
      continue;
    }
    const schema = leadForms[form.id];
    if (!schema && !form.dataset.leadType) continue;
    if (schema) {
      form.dataset.leadType = schema.type;
      const fields = [...form.querySelectorAll('input:not([type="hidden"]):not([type="submit"]),textarea,select')];
      schema.fields.forEach((key, index) => {
        if (!fields[index]) throw new Error(`Missing lead field ${key}`);
        fields[index].dataset.leadField = key;
        fields[index].name = key;
        fields[index].required = true;
      });
    }
    const controls = [...form.querySelectorAll("[data-lead-field]")];
    for (const control of controls) {
      describeLeadControl(control);
      control.addEventListener(control.type === "checkbox" ? "change" : "input", () => {
        if (control.hasAttribute("aria-invalid")) setFieldError(control, validationFor(control));
      });
    }
    const honeypot = document.createElement("input");
    honeypot.name = "website";
    honeypot.type = "text";
    honeypot.tabIndex = -1;
    honeypot.autocomplete = "off";
    honeypot.setAttribute("aria-hidden", "true");
    honeypot.style.cssText = "position:absolute;left:-10000px;width:1px;height:1px;opacity:0;";
    form.append(honeypot);
    let notice = null;
    const buttons = [...form.querySelectorAll('button[type="submit"],input[type="submit"]')];
    const labels = buttons.map((button) => button.querySelector(".text-block-wrap-div") || button);
    const originals = labels.map((label) => label.textContent);
    let submitting = false, pending = null;
    const ensureNotice = () => {
      if (!notice) {
        notice = document.createElement("p");
        notice.dataset.formSubmitNotice = "";
        notice.setAttribute("role", "status");
        notice.id = `${form.id || "lead-form"}-submit-notice-${Math.random().toString(36).slice(2, 8)}`;
        notice.style.cssText = "width:100%;margin:12px 0;";
        form.append(notice);
        buttons.forEach((button) => button.setAttribute("aria-describedby", notice.id));
      }
      return notice;
    };
    const show = (message, error = false) => showMessage(ensureNotice(), message, error);
    form.noValidate = true;
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      event.stopImmediatePropagation();
      if (submitting || buttons.some((button) => button.disabled)) return;
      const invalid = controls.filter((control) => {
        const message = validationFor(control);
        setFieldError(control, message);
        return Boolean(message);
      });
      if (invalid.length) {
        show("Проверьте заполнение формы.", true);
        invalid[0].focus();
        return;
      }
      const payload = { type: form.dataset.leadType, page: location.origin + location.pathname, website: honeypot.value };
      for (const control of controls) payload[control.dataset.leadField] = control.type === "checkbox" ? control.checked : control.value.trim();
      const signature = JSON.stringify(payload);
      submitting = true;
      buttons.forEach((button) => button.disabled = true);
      labels.forEach((label) => label.textContent = "Отправляем…");
      show("Отправляем заявку…");
      let description = null;
      try {
        if ((pending == null ? void 0 : pending.signature) !== signature) pending = { signature, id: leadId() };
        await requestLead({ ...payload, id: pending.id });
        show("Заявка принята. Мы скоро свяжемся с вами.");
        form.reset();
        pending = null;
      } catch (error) {
        description = describeFailure(error, "lead");
        showFailure(ensureNotice(), description);
      } finally {
        submitting = false;
        holdSubmit(buttons, labels, originals, (description == null ? void 0 : description.retryAfter) || 0);
        if (description) keepFocus(form, event.submitter || buttons.find((button) => button.offsetParent !== null) || buttons[0], notice);
      }
    }, true);
    form.querySelectorAll("[data-lead-enable]").forEach((button) => button.disabled = false);
    mounted2.add(form);
  }
}

// storefront/client/checkout-demand.js
function start(getPromo, cartStore) {
  initForms();
  initPhoneMasks();
  initCheckout(document.querySelector("[data-cart-popup] form"), getPromo, cartStore);
}
export {
  start
};
