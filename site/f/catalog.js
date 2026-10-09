(() => {
  var __create = Object.create;
  var __defProp = Object.defineProperty;
  var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __getProtoOf = Object.getPrototypeOf;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __require = /* @__PURE__ */ ((x) => typeof require !== "undefined" ? require : typeof Proxy !== "undefined" ? new Proxy(x, {
    get: (a, b) => (typeof require !== "undefined" ? require : a)[b]
  }) : x)(function(x) {
    if (typeof require !== "undefined") return require.apply(this, arguments);
    throw Error('Dynamic require of "' + x + '" is not supported');
  });
  var __export = (target, all) => {
    for (var name in all)
      __defProp(target, name, { get: all[name], enumerable: true });
  };
  var __copyProps = (to, from, except, desc) => {
    if (from && typeof from === "object" || typeof from === "function") {
      for (let key of __getOwnPropNames(from))
        if (!__hasOwnProp.call(to, key) && key !== except)
          __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
    }
    return to;
  };
  var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
    // If the importer is in node compatibility mode or this is not an ESM
    // file that has been converted to a CommonJS file using a Babel-
    // compatible transform (i.e. "__esModule" has not been set), then set
    // "default" to the CommonJS "module.exports" for node compatibility.
    isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
    mod
  ));

  // storefront/client/cart-store.js
  var cart_store_exports = {};
  __export(cart_store_exports, {
    add: () => add,
    clear: () => clear,
    decrement: () => decrement,
    getItems: () => getItems,
    increment: () => increment,
    remove: () => remove,
    reprice: () => reprice,
    setQuantity: () => setQuantity,
    subscribe: () => subscribe,
    total: () => total
  });

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
      const label2 = row.variants === "-" ? "" : row.variants || "";
      const dimensions = label2.match(/\d+[хxХX]\d+[хxХX]\d+/);
      const variant = {
        id: `${id}:${row.category || ""}:${label2}`,
        category: row.category || "",
        size: dimensions ? dimensions[0].replace(/[xХX]/g, "х") : label2,
        label: label2,
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
  function normalizePromoCode(value) {
    return String(value != null ? value : "").trim().toLowerCase().replaceAll("ё", "е").replace(/\s+/g, " ");
  }
  function promoField(row, aliases) {
    var _a;
    for (const alias of aliases) {
      const key = Object.keys(row).find((name) => name.toLowerCase() === alias);
      if (key !== void 0 && String((_a = row[key]) != null ? _a : "").trim() !== "") return row[key];
    }
    return "";
  }
  function findPromo(rows, value) {
    var _a;
    const wanted = normalizePromoCode(value);
    if (!wanted) return null;
    return (_a = rows.find((row) => normalizePromoCode(promoField(row, PROMO_COLUMNS.code)) === wanted)) != null ? _a : null;
  }
  function promoDetails(row) {
    var _a;
    const giftText = String((_a = promoField(row, PROMO_COLUMNS.gift)) != null ? _a : "").trim();
    return {
      rub: catalogNumber(promoField(row, PROMO_COLUMNS.rub)),
      pct: catalogNumber(promoField(row, PROMO_COLUMNS.pct)),
      gift: /сумк/i.test(giftText),
      giftText
    };
  }
  function hasPromoBenefit(promo) {
    return catalogNumber(promo.rub) > 0 || catalogNumber(promo.pct) > 0 || Boolean(promo.gift);
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
  var total = () => cartSubtotal(items);
  var subscribe = (listener) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  };
  function add(product, variant) {
    if (!variant || !(variant.price > 0)) return;
    const existing = items.find((item) => item.productId === product.id && item.variantId === variant.id);
    if (existing) existing.quantity = Math.min(99, existing.quantity + 1);
    else items.push({
      productId: product.id,
      variantId: variant.id,
      kind: product.kind,
      title: product.title,
      options: { ...variant.options },
      price: variant.price,
      quantity: 1,
      image: variant.image || "",
      path: product.path || ""
    });
    commit();
  }
  function setQuantity(productId2, variantId, quantity) {
    const item = items.find((row) => row.productId === productId2 && row.variantId === variantId);
    if (!item || !Number.isFinite(quantity)) return;
    if (quantity <= 0) items = items.filter((row) => row !== item);
    else item.quantity = Math.min(99, Math.floor(quantity));
    commit();
  }
  function remove(productId2, variantId) {
    setQuantity(productId2, variantId, 0);
  }
  function increment(productId2, variantId) {
    const item = items.find((row) => row.productId === productId2 && row.variantId === variantId);
    if (item) setQuantity(productId2, variantId, item.quantity + 1);
  }
  function decrement(productId2, variantId) {
    const item = items.find((row) => row.productId === productId2 && row.variantId === variantId);
    if (item) setQuantity(productId2, variantId, item.quantity - 1);
  }
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

  // storefront/client/form-presentation.js
  function describeLeadControl(control) {
    var _a;
    const autocomplete = { name: "name", phone: "tel", email: "email", city: "address-level2" }[control.dataset.leadField];
    if (autocomplete && !control.hasAttribute("autocomplete")) control.setAttribute("autocomplete", autocomplete);
    if (control.type !== "checkbox" && !((_a = control.labels) == null ? void 0 : _a.length) && !control.hasAttribute("aria-label") && control.id && control.placeholder) {
      const label2 = document.createElement("label");
      label2.className = "storefront-visually-hidden";
      label2.htmlFor = control.id;
      label2.textContent = control.placeholder.replace(/\*+\s*$/, "").trim();
      control.before(label2);
    }
    if (control.type !== "checkbox") control.maxLength = { name: 120, phone: 40, email: 200, comment: 1500, city: 100, business: 200 }[control.dataset.leadField] || 200;
  }
  function initFormPresentation() {
    document.querySelectorAll("form[data-lead-type]").forEach((form) => {
      form.noValidate = true;
    });
    document.querySelectorAll("form[data-lead-type] [data-lead-field]").forEach(describeLeadControl);
    document.querySelectorAll("form[data-lead-type] [data-lead-enable]").forEach((button) => {
      button.disabled = false;
    });
  }

  // storefront/products/image-preview.mjs
  var buildMap;
  function previewImage(src) {
    var _a, _b;
    return (_b = buildMap || ((_a = globalThis.__LE_STOREFRONT_CONFIG__) == null ? void 0 : _a.thumbnails)) == null ? void 0 : _b[src];
  }
  function imagePreviewAttributes(src, gallery2 = false) {
    const variants = previewImage(src);
    if (!variants) return { src };
    const small = variants[240], large = variants[480];
    return {
      src: large.url,
      srcset: `${small.url} ${small.width}w, ${large.url} ${large.width}w`,
      sizes: gallery2 ? "(max-width: 768px) 140px, 120px" : "(max-width: 600px) 100vw, 360px",
      width: large.width,
      height: large.height,
      "data-full-src": src
    };
  }

  // storefront/client/product-image.js
  function setProductImage(root, src, title) {
    const container = root.querySelector("[data-storefront-image]");
    if (!container) return;
    let image = container.querySelector("img");
    let placeholder = container.querySelector("[data-storefront-photo-placeholder]");
    if (!placeholder) {
      placeholder = document.createElement("span");
      placeholder.setAttribute("data-storefront-photo-placeholder", "");
      placeholder.textContent = "Нет фото";
      container.append(placeholder);
    }
    placeholder.hidden = Boolean(src);
    if (!src) {
      image == null ? void 0 : image.remove();
      return;
    }
    if (!image) {
      image = document.createElement("img");
      image.className = "image__img";
      image.decoding = "async";
      container.prepend(image);
    }
    const attributes = root.querySelector("[data-storefront-gallery-root]") ? { src } : imagePreviewAttributes(src);
    for (const name of ["srcset", "sizes", "data-full-src"]) if (!(name in attributes)) image.removeAttribute(name);
    for (const [name, value] of Object.entries(attributes)) if (image.getAttribute(name) !== String(value)) image.setAttribute(name, value);
    image.alt = title || "";
  }

  // storefront/client/custom-select.js
  var activeDropdown = null;
  var dropdownId = 0;
  var dropdownListenersInstalled = false;
  function closeDropdown(control = activeDropdown, focusTrigger = false) {
    if (!control) return;
    control.menu.hidden = true;
    control.trigger.setAttribute("aria-expanded", "false");
    control.wrapper.classList.remove("dd-open");
    if (control.menu.parentElement === document.body) control.wrapper.append(control.menu);
    if (activeDropdown === control) activeDropdown = null;
    if (focusTrigger && control.trigger.isConnected) control.trigger.focus();
  }
  function positionDropdown(control) {
    const rect = control.trigger.getBoundingClientRect();
    const edge = 10, gap = 6;
    const width = Math.min(rect.width, Math.max(0, window.innerWidth - edge * 2));
    const left = Math.max(edge, Math.min(rect.left, window.innerWidth - edge - width));
    const below = Math.max(0, window.innerHeight - rect.bottom - edge - gap);
    const above = Math.max(0, rect.top - edge - gap);
    const openAbove = below < Math.min(control.menu.scrollHeight, 220) && above > below;
    const available = Math.max(96, Math.min(280, openAbove ? above : below));
    const height = Math.min(control.menu.scrollHeight, available);
    const top = openAbove ? Math.max(edge, rect.top - gap - height) : Math.min(window.innerHeight - edge - height, rect.bottom + gap);
    Object.assign(control.menu.style, {
      position: "fixed",
      left: `${left}px`,
      top: `${top}px`,
      width: `${width}px`,
      maxHeight: `${available}px`
    });
  }
  function openDropdown(control, focusSelected = false) {
    if (activeDropdown && activeDropdown !== control) closeDropdown(activeDropdown);
    control.menu.hidden = false;
    document.body.append(control.menu);
    activeDropdown = control;
    control.trigger.setAttribute("aria-expanded", "true");
    control.wrapper.classList.add("dd-open");
    positionDropdown(control);
    if (focusSelected) {
      const selected = control.menu.querySelector('[aria-selected="true"]') || control.menu.querySelector('[role="option"]');
      selected == null ? void 0 : selected.focus();
    }
  }
  function installDropdownDismissal() {
    if (dropdownListenersInstalled) return;
    dropdownListenersInstalled = true;
    document.addEventListener("pointerdown", (event) => {
      if (activeDropdown && !activeDropdown.wrapper.contains(event.target) && !activeDropdown.menu.contains(event.target)) closeDropdown();
    }, true);
    window.addEventListener("scroll", () => closeDropdown(), true);
    window.addEventListener("resize", () => closeDropdown());
  }
  function enhanceSelect(select, { wrapper = select.closest(".input__catalog"), valueNode = null } = {}) {
    if (!wrapper) return null;
    let trigger = wrapper.querySelector(".storefront-select-trigger");
    if (!trigger) {
      trigger = document.createElement("button");
      trigger.type = "button";
      trigger.className = "storefront-select-trigger";
      trigger.setAttribute("aria-haspopup", "listbox");
      trigger.setAttribute("aria-expanded", "false");
      wrapper.append(trigger);
    }
    let menu = wrapper.querySelector(".storefront-select-menu");
    if (!menu) {
      menu = document.createElement("div");
      menu.className = "storefront-select-menu";
      menu.hidden = true;
      menu.setAttribute("role", "listbox");
      wrapper.append(menu);
    }
    if (!menu.id) menu.id = `storefront-select-menu-${++dropdownId}`;
    trigger.setAttribute("aria-controls", menu.id);
    trigger.setAttribute("aria-label", select.getAttribute("aria-label") || "Выбрать вариант");
    wrapper.classList.add("storefront-select-ready");
    select.setAttribute("aria-hidden", "true");
    select.tabIndex = -1;
    const control = { select, wrapper, trigger, menu };
    const sync = () => {
      var _a;
      menu.replaceChildren(...[...select.options].map((option) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "storefront-select-option";
        button.setAttribute("role", "option");
        button.tabIndex = -1;
        button.dataset.value = option.value;
        const selected = option.value === select.value;
        button.setAttribute("aria-selected", String(selected));
        const text = document.createElement("span");
        text.className = "storefront-select-option-label site__h5 color__h3";
        text.textContent = option.textContent;
        const mark = document.createElement("span");
        mark.className = "storefront-select-option-check";
        mark.setAttribute("aria-hidden", "true");
        mark.textContent = "✓";
        button.append(text, mark);
        return button;
      }));
      const current = ((_a = select.selectedOptions[0]) == null ? void 0 : _a.textContent) || "";
      const name = select.getAttribute("aria-label") || "Выбрать вариант";
      trigger.setAttribute("aria-label", current ? `${name}: ${current}` : name);
      if (valueNode) valueNode.textContent = current;
      if (activeDropdown === control) positionDropdown(control);
    };
    trigger.addEventListener("click", () => activeDropdown === control ? closeDropdown(control) : openDropdown(control));
    trigger.addEventListener("keydown", (event) => {
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        openDropdown(control, true);
      } else if (event.key === "Escape" && activeDropdown === control) closeDropdown(control);
    });
    menu.addEventListener("click", (event) => {
      const option = event.target.closest('[role="option"]');
      if (!option || !menu.contains(option)) return;
      const changed = select.value !== option.dataset.value;
      select.value = option.dataset.value;
      closeDropdown(control);
      if (changed) select.dispatchEvent(new Event("change", { bubbles: true }));
      trigger.focus();
    });
    menu.addEventListener("keydown", (event) => {
      var _a;
      const options = [...menu.querySelectorAll('[role="option"]')];
      const current = options.indexOf(event.target.closest('[role="option"]'));
      let next = current;
      if (event.key === "ArrowDown") next = Math.min(options.length - 1, current + 1);
      else if (event.key === "ArrowUp") next = Math.max(0, current - 1);
      else if (event.key === "Home") next = 0;
      else if (event.key === "End") next = options.length - 1;
      else if (event.key === "Escape") {
        event.preventDefault();
        closeDropdown(control, true);
        return;
      } else if (event.key === "Tab") {
        closeDropdown(control);
        return;
      } else return;
      event.preventDefault();
      (_a = options[next]) == null ? void 0 : _a.focus();
    });
    select.addEventListener("change", sync);
    installDropdownDismissal();
    sync();
    return { sync, control };
  }
  function closeDropdownIfDetached() {
    if (activeDropdown && !activeDropdown.wrapper.isConnected) closeDropdown();
  }

  // storefront/products/variants.mjs
  function variantDimensions(product) {
    const keys = product.kind === "decor" ? ["category", "size"] : ["category", "height"];
    return keys.filter((key) => new Set(product.variants.map((variant) => variant.options[key])).size > 1);
  }
  function availableOptions(product, key, selected = {}) {
    const dimensions = variantDimensions(product);
    const preceding = dimensions.slice(0, dimensions.indexOf(key));
    return [...new Set(product.variants.filter((variant) => preceding.every((name) => !selected[name] || variant.options[name] === selected[name])).map((variant) => variant.options[key]))];
  }
  function resolveVariant(product, selected = {}) {
    return product.variants.find((variant) => Object.entries(selected).every(([key, value]) => !value || variant.options[key] === value)) || null;
  }
  function initialSelection(product) {
    const first = product.variants[0];
    return first ? Object.fromEntries(variantDimensions(product).map((key) => [key, first.options[key]])) : {};
  }

  // storefront/client/product-ui.js
  var money = (value) => `${Number(value || 0).toLocaleString("ru-RU")} ₽`;
  var setText = (root, selector, value) => {
    const node = root.querySelector(selector);
    if (node) (node.querySelector(".text-block-wrap-div") || node).textContent = value;
  };
  function label(key, value, variant) {
    return key === "height" ? `${value} см.` : key === "size" ? (variant == null ? void 0 : variant.label) || value : value;
  }
  function gallery(root, product, variant) {
    const list = root.querySelector("[data-storefront-gallery]");
    const section = root.querySelector("[data-storefront-gallery-section]");
    if (!list) return;
    list.replaceChildren(...(variant.photos || []).slice(1).map((src) => {
      const div = document.createElement("div");
      div.className = "image product__img-dop__cms";
      const img = document.createElement("img");
      img.className = "image__img";
      img.loading = "lazy";
      img.decoding = "async";
      for (const [name, value] of Object.entries(imagePreviewAttributes(src, true))) img.setAttribute(name, value);
      img.alt = product.title;
      div.append(img);
      return div;
    }));
    if (section) section.hidden = (variant.photos || []).length <= 1;
  }
  function bind(root, initialProduct) {
    let product = initialProduct;
    let dimensions = variantDimensions(product);
    let selection = initialSelection(product);
    const collectSelects = () => Object.fromEntries(dimensions.map((key) => [key, root.querySelector(`[data-storefront-option="${key}"]`) || (key === "category" ? root.querySelector("[data-storefront-category]") : root.querySelector("[data-storefront-variant]"))]));
    let selects = collectSelects();
    const customSelects = new Map(Object.entries(selects).filter(([, select]) => select).map(([key, select]) => [key, enhanceSelect(select)]));
    let selectedVariant = resolveVariant(product, selection);
    const buy = root.querySelector(".buy-btn");
    function render() {
      var _a, _b;
      for (const key of dimensions) {
        const select = selects[key];
        if (!select) continue;
        const options = availableOptions(product, key, selection);
        if (!options.includes(selection[key])) selection[key] = options[0];
        select.replaceChildren(...options.map((value) => {
          const option = document.createElement("option");
          option.value = value;
          option.textContent = label(key, value, product.variants.find((v2) => v2.options[key] === value));
          return option;
        }));
        select.value = selection[key];
        const visibleLabel = root.querySelector(key === "category" ? "[data-storefront-category-label]" : "[data-storefront-variant-label]");
        if (visibleLabel) (visibleLabel.querySelector(".text-block-wrap-div") || visibleLabel).textContent = ((_a = select.selectedOptions[0]) == null ? void 0 : _a.textContent) || "";
        (_b = customSelects.get(key)) == null ? void 0 : _b.sync();
      }
      selectedVariant = resolveVariant(product, selection);
      if (!selectedVariant) {
        buy == null ? void 0 : buy.setAttribute("aria-disabled", "true");
        return;
      }
      buy == null ? void 0 : buy.removeAttribute("aria-disabled");
      const v = selectedVariant;
      setProductImage(root, v.image, product.title);
      setText(root, product.kind === "decor" ? "[data-price-decor]" : ".price", money(v.price));
      setText(root, "[data-prop-offer]", v.oldPrice > v.price ? money(v.oldPrice) : "");
      const discount = v.discount || (v.oldPrice > v.price ? Math.round((1 - v.price / v.oldPrice) * 100) : 0);
      setText(root, "[data-prop-discount]", discount ? `-${Math.abs(discount)}%` : "");
      setText(root, "[data-prop-diam]", v.diameter ? `${v.diameter} см.` : "");
      const hasBranches = Number(v.branches) > 0;
      setText(root, "[data-prop-branches]", hasBranches ? `${v.branches} шт.` : "");
      setText(root, "[data-prop-description]", v.description || product.staticDescription || "");
      setText(root, "[data-storefront-description]", v.description || "");
      for (const [selector, visible] of [["[data-storefront-diameter-row]", v.diameter], ["[data-storefront-branches-row]", hasBranches]]) {
        const node = root.querySelector(selector);
        if (node) {
          node.hidden = !visible;
          node.style.display = visible ? "" : "none";
        }
      }
      const showPropertyDivider = Boolean(v.diameter && hasBranches);
      root.querySelectorAll("[data-storefront-properties-divider]").forEach((node) => {
        node.hidden = !showPropertyDivider;
        node.style.display = showPropertyDivider ? "" : "none";
      });
      gallery(root, product, v);
    }
    root.addEventListener("change", (event) => {
      const key = Object.keys(selects).find((candidate) => selects[candidate] === event.target);
      if (!key) return;
      selection[key] = event.target.value;
      for (const later of dimensions.slice(dimensions.indexOf(key) + 1)) selection[later] = availableOptions(product, later, selection)[0];
      render();
    });
    buy == null ? void 0 : buy.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        buy.click();
      }
    });
    buy == null ? void 0 : buy.addEventListener("click", (event) => {
      if (!selectedVariant) {
        event.preventDefault();
        event.stopImmediatePropagation();
        return;
      }
      add(product, selectedVariant);
    });
    return (nextProduct) => {
      const previousSelection = selection;
      product = { ...nextProduct, staticDescription: product.staticDescription };
      dimensions = variantDimensions(product);
      selection = initialSelection(product);
      for (const key of dimensions) {
        const options = availableOptions(product, key, selection);
        if (options.includes(previousSelection[key])) selection[key] = previousSelection[key];
      }
      selects = collectSelects();
      render();
    };
  }
  var boundProducts = /* @__PURE__ */ new WeakMap();
  function initProducts() {
    closeDropdownIfDetached();
    for (const root of document.querySelectorAll("[data-storefront-product]")) {
      const data = root.querySelector("[data-storefront-variants]") || document.querySelector("[data-storefront-page-product]");
      if (!data) continue;
      const product = JSON.parse(data.textContent);
      const update = boundProducts.get(root);
      if (update) update(product);
      else boundProducts.set(root, bind(root, product));
    }
  }

  // storefront/client/cart-ui.js
  var money2 = (n) => `${Number(n || 0).toLocaleString("ru-RU")} ₽`;
  var esc = (s) => String(s != null ? s : "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
  var mounted = /* @__PURE__ */ new WeakMap();
  function initCart(getPromo2) {
    var _a;
    const popup = document.querySelector("[data-cart-popup]");
    if (!popup) return;
    if (mounted.has(popup)) return mounted.get(popup);
    popup.querySelectorAll(".item-wrapper__shop").forEach((node) => node.remove());
    const totalRow = popup.querySelector(".itogo-wrapper");
    const dividerAfter = ((_a = totalRow == null ? void 0 : totalRow.nextElementSibling) == null ? void 0 : _a.classList.contains("divider")) ? totalRow.nextElementSibling : null;
    const list = document.createElement("div");
    list.dataset.cartItems = "";
    totalRow == null ? void 0 : totalRow.before(list);
    const totalNode = popup.querySelector(".itogo-wrapper [data-cart-title] .text-block-wrap-div");
    const offerBadge = popup.querySelector("[data-cart-sum-offer]");
    const offerNode = popup.querySelector("[data-cart-sum-offer] .text-block-wrap-div");
    const form = popup.querySelector("form");
    function render() {
      const items2 = getItems(), promo = getPromo2();
      list.innerHTML = items2.length ? items2.map((item, index) => {
        const height = item.options.height ? `${item.options.height} см.` : item.options.size || "";
        const category = item.options.category || "";
        return `<div class="div div--u-im3bc3u4g item-wrapper__shop" data-cart-index="${index}">
      <div class="div div--u-i09ij701w name-photo__shop"><div class="image shop__img"><img class="image__img" src="${esc(item.image)}" alt=""></div>
      <div class="div div--u-ir8em2vtp title-shop-wrapper"><div class="div div--u-iqlo6zgmt title-wrapper__catalog"><div class="text color__h2 site__h3"><span class="text-block-wrap-div">${esc(item.title)}</span></div>
      <div class="div div--u-ipj03oyjv tex-tovar-wrapper"><div class="text color__h3 size__shop site-catalog__h3"><span class="text-block-wrap-div">${esc(height)}</span></div><div class="text site__h4 color__h3"><span class="text-block-wrap-div">${esc(category)}</span></div></div></div>
      <div class="text text--u-i35a4h7lp site__h2 color__h1"><span class="text-block-wrap-div">${money2(lineTotal(item))}</span></div></div></div>
      <div class="div count-summ-wrapper"><button type="button" class="icons-shop" data-cart-down aria-label="Уменьшить количество">−</button>
      <span class="text site__h4 color__h3">${item.quantity} шт.</span><button type="button" class="icons-shop" data-cart-up aria-label="Увеличить количество">+</button>
      <div class="div div--u-igo9ynupl" aria-hidden="true"></div><button type="button" class="icons-shop" data-cart-remove aria-label="Удалить товар">×</button></div></div>`;
      }).join("") + ((promo == null ? void 0 : promo.gift) && items2.some((item) => item.kind !== "decor") ? `<div class="div item-wrapper__shop" data-cart-gift>Подарок: ${esc(promo.giftText || "Сумка для хранения")}</div>` : "") : '<p class="site__h3" data-cart-empty>Корзина пуста</p>';
      const amount = checkoutTotal(items2, promo);
      if (totalNode) totalNode.textContent = `Итого: ${money2(amount)}`;
      const single = items2.length === 1 && items2[0].quantity === 1 && amount === cartSubtotal(items2);
      if (totalRow) totalRow.hidden = single;
      if (dividerAfter) dividerAfter.hidden = single;
      const offerText = promo && amount < cartSubtotal(items2) ? "Промокод применён" : "";
      if (offerNode) offerNode.textContent = offerText;
      if (offerBadge) {
        offerBadge.hidden = !offerText;
        offerBadge.style.display = offerText ? "" : "none";
      }
    }
    list.addEventListener("click", (event) => {
      const action = event.target.closest("[data-cart-down],[data-cart-up],[data-cart-remove]");
      if (!action) return;
      const item = getItems()[Number(action.closest("[data-cart-index]").dataset.cartIndex)];
      if (!item) return;
      if (action.matches("[data-cart-remove]")) remove(item.productId, item.variantId);
      else setQuantity(item.productId, item.variantId, item.quantity + (action.matches("[data-cart-up]") ? 1 : -1));
    });
    subscribe(render);
    render();
    const controller = { render, form };
    mounted.set(popup, controller);
    return controller;
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

  // storefront/client/promo.js
  var KEY2 = "lady_promo_state";
  var state = null;
  try {
    const saved = JSON.parse(localStorage.getItem(KEY2) || "null");
    if (saved && typeof saved.code === "string" && normalizePromoCode(saved.code) && hasPromoBenefit(saved)) state = saved;
  } catch {
  }
  var getPromo = () => state ? { ...state } : null;
  var mounted2 = /* @__PURE__ */ new WeakSet();
  function initPromo(changed) {
    const button = document.querySelector("[data-promo-apply]");
    const input = document.querySelector("[data-promo-input]");
    if (!button || !input || mounted2.has(button)) return;
    mounted2.add(button);
    const label2 = button.querySelector(".text-block-wrap-div") || button;
    let loading = false;
    const render = () => {
      button.disabled = loading;
      input.disabled = loading;
      label2.textContent = loading ? "проверяем…" : state ? "сбросить" : "активировать";
      if (state) input.value = state.code;
    };
    const persist = () => {
      try {
        if (state) localStorage.setItem(KEY2, JSON.stringify(state));
        else localStorage.removeItem(KEY2);
      } catch {
      }
    };
    button.addEventListener("click", async (event) => {
      event.preventDefault();
      if (loading) return;
      if (state) {
        state = null;
        persist();
        input.value = "";
        render();
        changed();
        return;
      }
      const items2 = getItems();
      if (!items2.length) {
        alert("Корзина пуста");
        return;
      }
      if (items2.every((item) => item.kind === "decor")) {
        alert("Промокоды не применяются к декору");
        return;
      }
      const code = normalizePromoCode(input.value);
      if (!code) {
        alert("Введите промокод");
        return;
      }
      loading = true;
      render();
      try {
        const response = await fetch(catalogEndpoint("promos"), { cache: "no-store" });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const row = findPromo(csvRecords(await response.text()), code);
        if (!row) {
          alert("Промокод не подходит");
          return;
        }
        const candidate = { code, ...promoDetails(row) };
        if (!hasPromoBenefit(candidate)) {
          alert("Промокод не даёт скидку или подарок");
          return;
        }
        state = candidate;
        persist();
        changed();
      } catch {
        alert("Промокоды сейчас недоступны. Повторите попытку позже.");
      } finally {
        loading = false;
        render();
      }
    });
    render();
  }

  // storefront/client/gallery.js
  function initGallery() {
    const overlay = document.createElement("div");
    overlay.className = "storefront-lightbox";
    overlay.hidden = true;
    overlay.innerHTML = '<button type="button" data-gallery-close aria-label="Закрыть"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg></button><button type="button" data-gallery-prev aria-label="Предыдущее фото"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15 18-6-6 6-6"/></svg></button><img alt=""><button type="button" data-gallery-next aria-label="Следующее фото"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 18 6-6-6-6"/></svg></button>';
    document.body.append(overlay);
    let photos = [], index = 0;
    const image = overlay.querySelector("img");
    const show = () => {
      var _a, _b, _c;
      image.src = ((_a = photos[index]) == null ? void 0 : _a.dataset.fullSrc) || ((_b = photos[index]) == null ? void 0 : _b.src) || "";
      image.alt = ((_c = photos[index]) == null ? void 0 : _c.alt) || "";
    };
    const close = () => {
      overlay.hidden = true;
      document.body.style.overflow = "";
    };
    document.addEventListener("click", (event) => {
      const source = event.target.closest("[data-storefront-gallery-root] img, [data-storefront-gallery] img");
      if (!source) return;
      const root = source.closest("[data-storefront-product]");
      photos = [...root.querySelectorAll("[data-storefront-gallery-root] img, [data-storefront-gallery] img")];
      index = photos.indexOf(source);
      if (index < 0) return;
      show();
      overlay.hidden = false;
      document.body.style.overflow = "hidden";
    });
    overlay.addEventListener("click", (event) => {
      if (event.target === overlay || event.target.closest("[data-gallery-close]")) close();
      else if (event.target.closest("[data-gallery-prev],[data-gallery-next]")) {
        index = (index + (event.target.closest("[data-gallery-next]") ? 1 : -1) + photos.length) % photos.length;
        show();
      }
    });
    document.addEventListener("keydown", (event) => {
      if (overlay.hidden) return;
      if (event.key === "Escape") close();
      if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
        index = (index + (event.key === "ArrowRight" ? 1 : -1) + photos.length) % photos.length;
        show();
      }
    });
  }

  // storefront/client/filter.js
  var normalize = (value) => String(value || "").trim().toLowerCase().replaceAll("ё", "е");
  var money3 = (value) => `${Number(value).toLocaleString("ru-RU")} ₽`;
  var number = (value) => Number(String(value || "").replace(/[^\d]/g, "")) || 0;
  function enhanceFilterSelect(select, label2) {
    if (!select) return null;
    const wrapper = document.createElement("div");
    wrapper.className = "input__catalog filter-select";
    select.classList.remove("input__catalog");
    select.setAttribute("aria-label", label2);
    const valueNode = document.createElement("span");
    valueNode.className = "filter-select__value site-catalog__h3 color__h2";
    select.before(wrapper);
    wrapper.append(select, valueNode);
    return enhanceSelect(select, { wrapper, valueNode });
  }
  function formatAmountInput(input) {
    var _a;
    const raw = input.value;
    const caret = (_a = input.selectionStart) != null ? _a : raw.length;
    const digits = raw.replace(/\D/g, "");
    const digitsBeforeCaret = raw.slice(0, caret).replace(/\D/g, "").length;
    const formatted = digits ? `${digits.replace(/\B(?=(\d{3})+(?!\d))/g, " ")} ₽` : "";
    let nextCaret = 0;
    let seenDigits = 0;
    for (let index = 0; index < formatted.length && seenDigits < digitsBeforeCaret; index += 1) {
      if (/\d/.test(formatted[index])) {
        seenDigits += 1;
        nextCaret = index + 1;
      }
    }
    input.value = formatted;
    try {
      input.setSelectionRange(nextCaret, nextCaret);
    } catch {
    }
  }
  function matchingVariants(product, { category = "", height = 0, min = 0, max = 0 } = {}) {
    return product.variants.filter((variant) => {
      var _a, _b;
      return (!category || normalize(variant.category || ((_a = variant.options) == null ? void 0 : _a.category)) === normalize(category)) && (!height || Number(variant.height || ((_b = variant.options) == null ? void 0 : _b.height)) === Number(height)) && (!min || Number(variant.price) >= min) && (!max || Number(variant.price) <= max);
    });
  }
  function initFilter() {
    const category = document.querySelector(".js-flt-category");
    if (!category) return;
    const height = document.querySelector(".js-flt-height");
    const min = document.querySelector(".js-flt-price-min");
    const max = document.querySelector(".js-flt-price-max");
    const reset = document.querySelector(".js-flt-reset");
    const cards = [...document.querySelectorAll(".product-card[data-storefront-product]")].map((card) => {
      const product = JSON.parse(card.querySelector("[data-storefront-variants]").textContent);
      return { card, product };
    });
    if (!cards.length) return;
    for (const input of [min, max]) input == null ? void 0 : input.addEventListener("input", () => formatAmountInput(input));
    const heights = [...new Set(cards.flatMap(({ product }) => product.variants.map((variant) => Number(variant.height)).filter(Boolean)))].sort((a, b) => a - b);
    if (height) height.replaceChildren(new Option("ЛЮБАЯ ВЫСОТА", ""), ...heights.map((value) => new Option(`${value} см`, String(value))));
    const categoryDropdown = enhanceFilterSelect(category, "Категория");
    const heightDropdown = enhanceFilterSelect(height, "Высота");
    function apply() {
      const selectedCategory = normalize(category.value) === normalize("Любая категория") ? "" : normalize(category.value);
      const selectedHeight = Number((height == null ? void 0 : height.value) || 0);
      const lower = number(min == null ? void 0 : min.value), upper = number(max == null ? void 0 : max.value);
      const relevantPrices = [];
      for (const { card, product } of cards) {
        const matching = matchingVariants(product, { category: selectedCategory, height: selectedHeight });
        relevantPrices.push(...matching.map((variant) => Number(variant.price)));
        const selected = matchingVariants(product, { category: selectedCategory, height: selectedHeight, min: lower, max: upper })[0];
        card.style.display = selected ? "" : "none";
        if (!selected) continue;
        const categorySelect = card.querySelector('[data-storefront-category], [data-storefront-option="category"]');
        const variantSelect = card.querySelector('[data-storefront-variant], [data-storefront-option="height"], [data-storefront-option="size"]');
        if (categorySelect && categorySelect.value !== selected.category) {
          categorySelect.value = selected.category;
          categorySelect.dispatchEvent(new Event("change", { bubbles: true }));
        }
        if (variantSelect && variantSelect.value !== String(product.kind === "decor" ? selected.size : selected.height)) {
          variantSelect.value = String(product.kind === "decor" ? selected.size : selected.height);
          variantSelect.dispatchEvent(new Event("change", { bubbles: true }));
        }
      }
      if (min) min.placeholder = relevantPrices.length ? money3(Math.min(...relevantPrices)) : "";
      if (max) max.placeholder = relevantPrices.length ? money3(Math.max(...relevantPrices)) : "";
    }
    for (const input of [category, height, min, max]) input == null ? void 0 : input.addEventListener((input == null ? void 0 : input.tagName) === "SELECT" ? "change" : "input", apply);
    reset == null ? void 0 : reset.addEventListener("click", (event) => {
      event.preventDefault();
      category.selectedIndex = 0;
      if (height) height.value = "";
      if (min) min.value = "";
      if (max) max.value = "";
      categoryDropdown == null ? void 0 : categoryDropdown.sync();
      heightDropdown == null ? void 0 : heightDropdown.sync();
      apply();
    });
    apply();
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
  var productTitle = (product, route) => String((product == null ? void 0 : product.title) || "").trim() || (route == null ? void 0 : route.liveTitle) || "";
  function presentProduct(product, route) {
    const kind = route.kind;
    const variants = product.variants.map((variant) => {
      const photos = catalogPhotos(variant.photos);
      const image = photos[0] || "";
      return {
        ...variant,
        options: kind === "tree" ? { category: variant.category, height: String(variant.height) } : { category: variant.category, size: variant.size },
        image,
        photos
      };
    });
    const view = { id: product.id, kind, title: productTitle(product, route), path: route.path, variants };
    view.selectedVariant = resolveVariant(view, initialSelection(view));
    return view;
  }
  var escapeHtml = (value) => String(value != null ? value : "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
  var money4 = (value) => `${Number(value || 0).toLocaleString("ru-RU")} ₽`;
  var jsonForHtml = (value) => JSON.stringify(value).replaceAll("<", "\\u003c");

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

  // storefront/url-path.mjs
  function pagePath(value) {
    return String(value).replace(/^([^?#]*)([?#].*)?$/, (_, path, suffix = "") => (path === "/" || /\.(?:html?|xml|txt|json|csv|css|m?js|map|pdf|gz|zip|png|jpe?g|webp|avif|gif|svg|ico|mp4|webm|woff2?|ttf)$/i.test(path) ? path : path.replace(/\/+$/, "") + "/") + suffix);
  }

  // storefront/products/card-renderer.mjs
  var imageSizeResolver = null;
  var attributeOf = (tag, name) => {
    var _a;
    return (_a = new RegExp(`\\s${name}=(["'])(.*?)\\1`, "i").exec(tag)) == null ? void 0 : _a[2];
  };
  function inheritedImageAttributes(template, image) {
    const tag = (template.match(/<img\b[^>]*>/gi) || []).find((candidate) => [attributeOf(candidate, "src"), attributeOf(candidate, "data-full-src")].some((value) => (value == null ? void 0 : value.replaceAll("&amp;", "&")) === image));
    if (!tag) return null;
    return Object.fromEntries(["width", "height", "loading", "fetchpriority"].map((name) => [name, attributeOf(tag, name)]).filter(([, value]) => value));
  }
  function productImageHtml(image, title, template = "") {
    if (!image) return "<span data-storefront-photo-placeholder>Нет фото</span>";
    const inherited = inheritedImageAttributes(template, image);
    const preview = imagePreviewAttributes(image);
    const size = (inherited == null ? void 0 : inherited.width) ? inherited : (imageSizeResolver == null ? void 0 : imageSizeResolver(image)) || (preview.width ? preview : null);
    const loading = inherited ? inherited.loading : "lazy";
    const hints = `${size ? ` width="${Number(size.width)}" height="${Number(size.height)}"` : ""}${loading ? ` loading="${escapeHtml(loading)}"` : ""}${(inherited == null ? void 0 : inherited.fetchpriority) ? ` fetchpriority="${escapeHtml(inherited.fetchpriority)}"` : ""} decoding="async"`;
    const previewHints = Object.entries(preview).filter(([key]) => !["src", "width", "height"].includes(key)).map(([key, value]) => ` ${key}="${escapeHtml(value)}"`).join("");
    return `<img class="image__img" src="${escapeHtml(preview.src)}" alt="${escapeHtml(title)}"${hints}${previewHints}><span data-storefront-photo-placeholder hidden>Нет фото</span>`;
  }
  function imageRatioStyle(image, template) {
    const inherited = inheritedImageAttributes(template, image);
    const size = (inherited == null ? void 0 : inherited.width) ? inherited : (imageSizeResolver == null ? void 0 : imageSizeResolver(image)) || imagePreviewAttributes(image);
    const width = Number(size == null ? void 0 : size.width), height = Number(size == null ? void 0 : size.height);
    return `--storefront-image-ratio:${width > 0 && height > 0 ? `${width}/${height}` : "3/4"}`;
  }
  var classValue = (tag) => {
    var _a;
    return ((_a = /\bclass\s*=\s*(["'])(.*?)\1/i.exec(tag)) == null ? void 0 : _a[2]) || "";
  };
  function templateTag(template, predicate, occurrence = 0) {
    let found = 0;
    for (const tag of template.match(/<[a-z][^>]*>/gi) || []) {
      if (!predicate(tag, classValue(tag))) continue;
      if (found++ === occurrence) return tag;
    }
    return "";
  }
  function templateClass(template, predicate, fallback, occurrence = 0) {
    const value = classValue(templateTag(template, predicate, occurrence));
    return value || fallback;
  }
  var hasData = (tag, name) => new RegExp(`\\b${name}\\b`).test(tag);
  var byData = (name) => (tag) => hasData(tag, name);
  var byClass = (name) => (_tag, classes) => classes.split(/\s+/).includes(name);
  function classBeforeData(template, name, fallback) {
    const target = templateTag(template, byData(name));
    const targetIndex = target ? template.indexOf(target) : -1;
    if (targetIndex < 0) return fallback;
    const priorTags = [...template.slice(0, targetIndex).matchAll(/<[a-z][^>]*>/gi)].map((match) => match[0]);
    for (let index = priorTags.length - 1; index >= 0; index--) {
      const classes = classValue(priorTags[index]);
      if (classes.includes("site__h3") && classes.includes("color__h3")) return classes;
    }
    return fallback;
  }
  function fieldHtml({ classes, labelClass, data, ariaLabel, value, options, icon = "/thumb/2/HbmxrgA55_3nkzXJnicbLg/r/d/chevron_down_2.svg" }) {
    return `<div class="${escapeHtml(classes)}" data-storefront-select><div data-storefront-${data}-label class="${escapeHtml(labelClass)}"><span class="text-block-wrap-div">${escapeHtml(value)}</span></div><div class="image down__img" aria-hidden="true"><img src="${escapeHtml(icon)}" alt="" class="image__img"></div><button type="button" class="storefront-select-trigger" aria-label="${escapeHtml(ariaLabel)}" aria-haspopup="listbox" aria-expanded="false"></button><select data-storefront-${data} aria-label="${escapeHtml(ariaLabel)}" aria-hidden="true" tabindex="-1">${options.map((option) => `<option value="${escapeHtml(option.value)}">${escapeHtml(option.label)}</option>`).join("")}</select><div class="storefront-select-menu" role="listbox" hidden></div></div>`;
  }
  function cardHtml(opening, product, route, template = "") {
    const categories = [...new Set(product.variants.map((variant) => variant.category))];
    const initial = product.variants[0];
    const data = presentProduct(product, route);
    const categoryImage = (category) => {
      var _a;
      return ((_a = data.variants.find((variant) => variant.category === category)) == null ? void 0 : _a.image) || "";
    };
    const serialized = jsonForHtml(data);
    const title = data.title;
    const image = categoryImage(initial.category);
    const hasBranches = Number(initial.branches) > 0;
    const discount = initial.discount || (initial.oldPrice > initial.price ? Math.round((1 - initial.price / initial.oldPrice) * 100) : 0);
    const imageClass = templateClass(template, (_tag, classes) => classes.includes("product__img"), "image image--u-iv4xfnvjz product__img");
    const contentClass = templateClass(template, byClass("content__product"), "div content__product");
    const propertiesClass = templateClass(template, byClass("property-content__product"), "div property-content__product");
    const titleClass = templateClass(template, byData("data-prop-title"), "text site-catalog__h1 color__h2");
    const diameterValueClass = templateClass(template, byData("data-prop-diam"), "text site__h3 color__h2");
    const branchValueClass = templateClass(template, byData("data-prop-branches"), "text site__h3 color__h2");
    const diameterLabelClass = classBeforeData(template, "data-prop-diam", "text site__h3 color__h3");
    const branchLabelClass = classBeforeData(template, "data-prop-branches", "text site__h3 color__h3");
    const diameterWrapperClass = templateClass(template, byClass("property__wrapper"), "div property__wrapper", 0);
    const branchWrapperClass = templateClass(template, byClass("property__wrapper"), "div property__wrapper", 1);
    const diameterRowClass = templateClass(template, byClass("item-list__shop"), "list__item item-list__shop");
    const branchRowClass = templateClass(template, byClass("item_list"), "list__item item_list");
    const categoryValueClass = templateClass(template, byData("data-prop-category"), "text site-catalog__h3 color__h2");
    const heightValueClass = templateClass(template, byData("data-prop-height"), "text site-catalog__h3 color__h2");
    const hasCategoryField = categories.length > 1 || Boolean(templateTag(template, byData("data-prop-category")));
    const categoryField = hasCategoryField ? fieldHtml({
      classes: "div input__catalog",
      labelClass: categoryValueClass,
      data: "category",
      ariaLabel: "Вид ёлки",
      value: initial.category,
      options: categories.map((category) => ({ value: category, label: category }))
    }) : "";
    const heightField = fieldHtml({
      classes: "div input__catalog",
      labelClass: heightValueClass,
      data: "variant",
      ariaLabel: "Высота ёлки",
      value: `${initial.height} см.`,
      options: product.variants.filter((variant) => variant.category === initial.category).map((variant) => ({ value: variant.height, label: `${variant.height} см.` }))
    });
    const rootTag = opening.replace(/\sdata-tt-collection-item-id=(?:"[^"]*"|'[^']*')/g, "").replace(/>$/, ` data-storefront-product="${escapeHtml(product.id)}">`);
    return `${rootTag}
  <div class="${escapeHtml(imageClass)}" data-storefront-image style="display:flex;${imageRatioStyle(image, template)}">${productImageHtml(image, title, template)}</div>
  <div class="${escapeHtml(contentClass)}">
    <div class="${escapeHtml(propertiesClass)}">
      <div data-prop-title class="${escapeHtml(titleClass)}"><span class="text-block-wrap-div">${escapeHtml(title)}</span></div>
      <div class="list wrapper__list">
        <div class="${escapeHtml(diameterRowClass)}" data-storefront-diameter-row${initial.diameter ? "" : " hidden"}><div class="div content-dot__list"><div class="div dot__list"></div><div class="${escapeHtml(diameterWrapperClass)}"><div class="${escapeHtml(diameterLabelClass)}"><span class="text-block-wrap-div">Диаметр — </span></div><div data-prop-diam class="${escapeHtml(diameterValueClass)}"><span class="text-block-wrap-div">${initial.diameter ? `${initial.diameter} см.` : ""}</span></div></div></div><div class="div divider" data-storefront-properties-divider${initial.diameter && hasBranches ? "" : " hidden"}></div><div class="div divider div--u-iw5evcmty divider-no" data-storefront-properties-divider aria-hidden="true"${initial.diameter && hasBranches ? "" : " hidden"}></div></div>
        <div class="${escapeHtml(branchRowClass)}" data-storefront-branches-row${hasBranches ? "" : ' hidden style="display:none"'}><div class="div content-dot__list"><div class="div dot__list"></div><div class="${escapeHtml(branchWrapperClass)}"><div class="${escapeHtml(branchLabelClass)}"><span class="text-block-wrap-div">Кол-во веток —</span></div><div data-prop-branches class="${escapeHtml(branchValueClass)}"><span class="text-block-wrap-div">${hasBranches ? `${initial.branches} шт.` : ""}</span></div></div></div></div>
      </div>
      ${categoryField}
      ${heightField}
    </div>
    <div class="div price-button-wrapper__product"><div class="div price-wrapper__product"><div class="div offer-wrapper__product">
      <div class="text color__h2 price site-catalog__h1"><span class="text-block-wrap-div">${money4(initial.price)}</span></div>
      <div data-prop-discount class="text offer__product site-catalog__h3"><span class="text-block-wrap-div">${discount ? `-${Math.abs(discount)}%` : ""}</span></div>
    </div><div data-prop-offer class="text site__h4 color__h3" style="text-decoration:line-through"><span class="text-block-wrap-div">${initial.oldPrice > initial.price ? money4(initial.oldPrice) : ""}</span></div></div>
    <div class="div button-wrapper__product"><div tabindex="0" data-cart-open role="button" class="button standart-catalog__button-2 buy-btn"><span class="text-button"><span class="text-block-wrap-div">купить</span></span></div>
      <a href="${escapeHtml(pagePath(route.path))}" class="button stroke-catalog__button"><span class="text-button"><span class="text-block-wrap-div">подробнее</span></span></a></div></div>
  </div><script type="application/json" data-storefront-variants>${serialized}<\/script></div>`;
  }
  function decorCardHtml(opening, product, route, template = "") {
    const title = productTitle(product, route);
    const first = product.variants[0];
    const types = [...new Set(product.variants.map((variant) => variant.category))];
    const imageFor = (variant) => catalogPhotos(variant.photos)[0] || "";
    const serialized = jsonForHtml(presentProduct(product, route));
    const rootTag = opening.replace(/\sdata-tt-collection-item-id=(?:"[^"]*"|'[^']*')/g, "").replace(/>$/, ` data-storefront-product="${escapeHtml(product.id)}">`);
    return `${rootTag}
    <div class="image product__img" data-storefront-image style="${imageRatioStyle(imageFor(first), template)}">${productImageHtml(imageFor(first), title, template)}</div>
    <div class="div content__product div--u-io63gnvw2">
      <div class="div title-and-input"><div class="div title-and-opisanie">
        <div class="text color__h2 site-catalog__h1"><span class="text-block-wrap-div">${escapeHtml(title)}</span></div>
      </div>
    ${types.length > 1 ? fieldHtml({ classes: "div input__catalog", labelClass: templateClass(template, byData("data-prop-category"), "text site-catalog__h3 color__h2"), data: "category", ariaLabel: "Тип декора", value: first.category, options: types.map((type) => ({ value: type, label: type })) }) : ""}
      ${product.variants.length > 1 || first.size ? fieldHtml({ classes: "div input__catalog", labelClass: templateClass(template, byData("data-prop-height"), "text site-catalog__h3 color__h2"), data: "variant", ariaLabel: "Вариант декора", value: first.label || first.category, options: product.variants.filter((v) => v.category === first.category).map((v) => ({ value: v.size, label: v.label || v.category })) }) : ""}
      </div><div class="div price-button-wrapper__product"><div data-price-decor class="text color__h2 site-catalog__h1"><span class="text-block-wrap-div">${money4(first.price)}</span></div>
      <div class="div button-wrapper__product"><div tabindex="0" data-cart-open role="button" class="button standart-catalog__button-2 buy-btn"><span class="text-button"><span class="text-block-wrap-div">в корзину</span></span></div>
      <a href="${escapeHtml(pagePath(route.path))}" class="button stroke-catalog__button"><span class="text-button"><span class="text-block-wrap-div">подробнее</span></span></a></div></div>
    </div><script type="application/json" data-storefront-variants>${serialized}<\/script></div>`;
  }

  // storefront/client/catalog-sync.js
  var liveProducts;
  var productRoutes;
  function loadLiveProducts() {
    if (!liveProducts) liveProducts = Promise.all([loadTreeProducts(), loadDecorProducts()]);
    return liveProducts;
  }
  function loadProductRoutes() {
    if (!productRoutes) productRoutes = fetch("/product-routes.json", { cache: "no-store" }).then((response) => response.ok ? response.json() : []).catch(() => []);
    return productRoutes;
  }
  var productId = (product) => String(product.id);
  function rootOpening(card) {
    var _a;
    return ((_a = /^<div\b[^>]*>/i.exec(card.outerHTML)) == null ? void 0 : _a[0]) || "";
  }
  function detailProduct() {
    const script = document.querySelector("[data-storefront-page-product]");
    if (!script) return null;
    try {
      return { script, product: JSON.parse(script.textContent) };
    } catch {
      return null;
    }
  }
  async function syncFromSupabase() {
    var _a, _b, _c;
    const cards = [...document.querySelectorAll("[data-storefront-product]")].filter((card) => card.querySelector("[data-storefront-variants]"));
    const detail = detailProduct();
    if (!cards.length && !detail) return;
    const [products, routes] = await Promise.all([loadLiveProducts(), loadProductRoutes()]);
    const [trees, decor] = products;
    const byKind = { tree: trees, decor };
    if (detail) {
      const kind = detail.product.kind;
      const source = (_a = byKind[kind]) == null ? void 0 : _a.get(productId(detail.product));
      if (source == null ? void 0 : source.variants.length) {
        const view = presentProduct(source, { kind, path: location.pathname, liveTitle: source.title });
        detail.script.textContent = jsonForHtml(view);
      }
    }
    const existingIds = /* @__PURE__ */ new Set();
    const templateCard = cards[0] || document.querySelector(".collection__list.list__catalog [data-storefront-product]");
    const templateOpening = templateCard ? rootOpening(templateCard) : "";
    const templateHtml = (templateCard == null ? void 0 : templateCard.outerHTML) || "";
    const cardList = (templateCard == null ? void 0 : templateCard.parentElement) || document.querySelector(".collection__list.list__catalog");
    for (const card of cards) {
      const data = card.querySelector("[data-storefront-variants]");
      let previous;
      try {
        previous = JSON.parse(data.textContent);
      } catch {
        card.remove();
        continue;
      }
      const kind = previous.kind || "tree";
      existingIds.add(`${kind}:${String(previous.id)}`);
      const source = (_b = byKind[kind]) == null ? void 0 : _b.get(productId(previous));
      if (!(source == null ? void 0 : source.variants.length)) {
        card.remove();
        continue;
      }
      const opening = rootOpening(card);
      if (!opening) {
        card.remove();
        continue;
      }
      const path = ((_c = card.querySelector("a.stroke-catalog__button[href]")) == null ? void 0 : _c.getAttribute("href")) || "/catalog/";
      const route = { id: source.id, kind, path, liveTitle: source.title };
      const template = card.outerHTML;
      const html = kind === "decor" ? decorCardHtml(opening, source, route, template) : cardHtml(opening, source, route, template);
      const holder = document.createElement("template");
      holder.innerHTML = html.trim();
      const updated = holder.content.firstElementChild;
      if (updated) card.replaceWith(updated);
    }
    const pathname = location.pathname.replace(/\/+$/, "") || "/";
    const landscapePage = pathname === "/catalog/landscape-gardening";
    const standardCatalogPage = pathname === "/" || pathname === "/main" || pathname === "/catalog";
    const decorPage = ["/catalog-tree", "/catalog-decor", "/catalog-tree-1"].includes(pathname);
    if (cardList && templateOpening && templateHtml && (landscapePage || standardCatalogPage || decorPage)) {
      const kind = decorPage ? "decor" : "tree";
      const activeProducts = [...byKind[kind].values()].filter((product) => product.variants.length);
      for (const source of activeProducts) {
        const route = routes.find((item) => item.kind === kind && String(item.id) === String(source.id));
        if (!route || existingIds.has(`${kind}:${String(source.id)}`)) continue;
        const isLandscape = /^\/tree\/(?:tuya-|mozhzhevelnik$|kiparisovik$)/.test(route.path);
        if (landscapePage && !isLandscape || standardCatalogPage && (kind === "decor" || isLandscape) || decorPage && kind !== "decor") continue;
        const html = kind === "decor" ? decorCardHtml(templateOpening, source, route, templateHtml) : cardHtml(templateOpening, source, route, templateHtml);
        const holder = document.createElement("template");
        holder.innerHTML = html.trim();
        const updated = holder.content.firstElementChild;
        if (updated) cardList.append(updated);
      }
    }
    initProducts();
  }
  function initCatalogSync() {
    const initialLoad = syncFromSupabase().catch((error) => console.error("Supabase catalog could not be loaded", error));
    document.addEventListener("storefront:products-added", () => {
      void syncFromSupabase().catch((error) => console.error("Supabase catalog could not be loaded", error));
    });
    return initialLoad;
  }

  // storefront/client/index.js
  document.addEventListener("storefront:products-added", initProducts);
  var demand;
  var formsReady = false;
  function loadForms() {
    return demand || (demand = import("/f/checkout-demand.js").then((module) => {
      module.start(getPromo, cart_store_exports);
      formsReady = true;
    }).catch((error) => {
      demand = null;
      throw error;
    }));
  }
  function start() {
    initFormPresentation();
    const relevant = (target) => {
      var _a;
      return (_a = target == null ? void 0 : target.closest) == null ? void 0 : _a.call(target, "form,[data-cart-open],.buy-btn,[data-modal-open]");
    };
    for (const type of ["pointerdown", "focusin", "click", "keydown"]) document.addEventListener(type, (event) => {
      if (relevant(event.target)) void loadForms().catch((error) => console.error("Form runtime unavailable", error));
    }, true);
    let replaying = false;
    document.addEventListener("submit", (event) => {
      if (formsReady || replaying || !event.target.matches("form[data-lead-type], [data-cart-popup] form")) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      const form = event.target, submitter = event.submitter;
      void loadForms().then(() => {
        replaying = true;
        try {
          form.requestSubmit(submitter || void 0);
        } finally {
          replaying = false;
        }
      }).catch((error) => console.error("Form runtime unavailable", error));
    }, true);
    initProducts();
    initGallery();
    const cart = initCart(getPromo);
    initPromo(() => cart == null ? void 0 : cart.render());
    void initCatalogSync().finally(initFilter);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, { once: true });
  else start();
})();
