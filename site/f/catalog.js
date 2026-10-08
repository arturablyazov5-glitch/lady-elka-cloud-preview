(() => {
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
      labels.forEach((label2, index) => {
        label2.textContent = originals[index];
      });
    };
    if (!(seconds > 0)) {
      restore();
      return () => {
      };
    }
    let left = Math.ceil(seconds);
    const paint = () => labels.forEach((label2) => {
      label2.textContent = `Повторить через ${formatWait(left)}`;
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
  var money3 = (value) => `${Number(value || 0).toLocaleString("ru-RU")} ₽`;
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
  var mounted3 = /* @__PURE__ */ new WeakMap();
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
    const label2 = (control, text) => {
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
      label2(control, text);
      if (autocomplete && control.setAttribute) control.setAttribute("autocomplete", autocomplete);
      if (["name", "email", "phone", "address"].includes(key)) (_a = control.setAttribute) == null ? void 0 : _a.call(control, "aria-required", "true");
    }
    const promo = (_b = form.querySelector) == null ? void 0 : _b.call(form, "[data-promo-input]");
    if (promo) {
      label2(promo, "Промокод");
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
  function initCheckout(form, getPromo2) {
    var _a, _b, _c, _d;
    if (!form) return;
    if (((_a = mounted3.get(form)) == null ? void 0 : _a()) === false) return;
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
    const label2 = (button == null ? void 0 : button.querySelector(".text-block-wrap-div")) || button;
    const originalLabel = (label2 == null ? void 0 : label2.textContent) || "купить";
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
        result = reprice(await lookupFresh());
      } catch {
        return reportFailure(new RequestFailure("network"));
      }
      pending = null;
      savePendingQuietly();
      if (!getItems().length) return show("Товары из корзины больше недоступны. Корзина пересчитана — выберите товары заново.", true);
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
          result = reprice(await lookupFresh());
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
      if (description.retryAfter) cancelHold = holdSubmit([button], [label2], [originalLabel], description.retryAfter);
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
      const items2 = getItems();
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
      const promo = getPromo2();
      const signature = JSON.stringify({ items: items2, customer, promo, paymentMethod });
      const retry = (pending == null ? void 0 : pending.signature) === signature;
      const payload = retry ? pending.payload : buildOrderPayload(items2, customer, promo, location.origin, Date.now(), paymentMethod);
      if (!payload.amount) {
        show("Сумма заказа нулевая.", true);
        return;
      }
      submitting = true;
      button.disabled = true;
      label2.textContent = "Оформляем заказ…";
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
          clear();
          pending = null;
          savePending();
          form.reset();
          clearDraft();
          show(`Заказ № ${result.orderId || payload.orderId} оплачен. Мы скоро свяжемся с вами.`);
          return;
        }
        if (paymentMethod === "cash_on_delivery") {
          if (!result.ok || !result.orderId) throw new Error("Подтверждение заказа не получено");
          clear();
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
        label2.textContent = originalLabel;
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
    mounted3.set(form, () => {
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
  var money4 = (value) => `${Number(value).toLocaleString("ru-RU")} ₽`;
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
      if (min) min.placeholder = relevantPrices.length ? money4(Math.min(...relevantPrices)) : "";
      if (max) max.placeholder = relevantPrices.length ? money4(Math.max(...relevantPrices)) : "";
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
      <div class="text color__h2 price site-catalog__h1"><span class="text-block-wrap-div">${money3(initial.price)}</span></div>
      <div data-prop-discount class="text offer__product site-catalog__h3"><span class="text-block-wrap-div">${discount ? `-${Math.abs(discount)}%` : ""}</span></div>
    </div><div data-prop-offer class="text site__h4 color__h3" style="text-decoration:line-through"><span class="text-block-wrap-div">${initial.oldPrice > initial.price ? money3(initial.oldPrice) : ""}</span></div></div>
    <div class="div button-wrapper__product"><div tabindex="0" data-cart-open role="button" class="button standart-catalog__button-2 buy-btn"><span class="text-button"><span class="text-block-wrap-div">купить</span></span></div>
      <a href="${escapeHtml(route.path)}" class="button stroke-catalog__button"><span class="text-button"><span class="text-block-wrap-div">подробнее</span></span></a></div></div>
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
      </div><div class="div price-button-wrapper__product"><div data-price-decor class="text color__h2 site-catalog__h1"><span class="text-block-wrap-div">${money3(first.price)}</span></div>
      <div class="div button-wrapper__product"><div tabindex="0" data-cart-open role="button" class="button standart-catalog__button-2 buy-btn"><span class="text-button"><span class="text-block-wrap-div">в корзину</span></span></div>
      <a href="${escapeHtml(route.path)}" class="button stroke-catalog__button"><span class="text-button"><span class="text-block-wrap-div">подробнее</span></span></a></div></div>
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
      const path = ((_c = card.querySelector("a.stroke-catalog__button[href]")) == null ? void 0 : _c.getAttribute("href")) || "/catalog";
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
  var mounted4 = /* @__PURE__ */ new WeakSet();
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
    var _a;
    for (const form of root.querySelectorAll("form")) {
      if (mounted4.has(form) || form.matches("[data-pay-now]") || form.querySelector("[data-pay-now]")) continue;
      if (form.method.toLowerCase() === "get" && new URL(form.action, location.href).pathname === "/search") continue;
      if (form.querySelector(".js-flt")) {
        form.addEventListener("submit", (event) => event.preventDefault(), true);
        mounted4.add(form);
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
      const originals = labels.map((label2) => label2.textContent);
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
        labels.forEach((label2) => label2.textContent = "Отправляем…");
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
      mounted4.add(form);
    }
  }

  // storefront/client/index.js
  document.addEventListener("storefront:products-added", initProducts);
  function start() {
    initForms();
    initProducts();
    initGallery();
    initPhoneMasks();
    const cart = initCart(getPromo);
    initPromo(() => cart == null ? void 0 : cart.render());
    initCheckout(cart == null ? void 0 : cart.form, getPromo);
    void initCatalogSync().finally(initFilter);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, { once: true });
  else start();
})();
