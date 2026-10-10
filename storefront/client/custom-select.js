let activeDropdown = null;
let dropdownId = 0;
let dropdownListenersInstalled = false;

function closeDropdown(control = activeDropdown, focusTrigger = false) {
  if (!control) return;
  control.menu.hidden = true;
  control.trigger.setAttribute('aria-expanded', 'false');
  control.wrapper.classList.remove('dd-open');
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
    position: 'fixed', left: `${left}px`, top: `${top}px`, width: `${width}px`, maxHeight: `${available}px`,
  });
}

function openDropdown(control, focusSelected = false) {
  if (activeDropdown && activeDropdown !== control) closeDropdown(activeDropdown);
  control.menu.hidden = false;
  document.body.append(control.menu);
  activeDropdown = control;
  control.trigger.setAttribute('aria-expanded', 'true');
  control.wrapper.classList.add('dd-open');
  positionDropdown(control);
  if (focusSelected) {
    const selected = control.menu.querySelector('[aria-selected="true"]') || control.menu.querySelector('[role="option"]');
    selected?.focus();
  }
}

function installDropdownDismissal() {
  if (dropdownListenersInstalled) return;
  dropdownListenersInstalled = true;
  document.addEventListener('pointerdown', event => {
    if (activeDropdown && !activeDropdown.wrapper.contains(event.target) && !activeDropdown.menu.contains(event.target)) closeDropdown();
  }, true);
  window.addEventListener('scroll', () => closeDropdown(), true);
  window.addEventListener('resize', () => closeDropdown());
}

export function enhanceSelect(select, { wrapper = select.closest('.input__catalog'), valueNode = null } = {}) {
  if (!wrapper) return null;
  let trigger = wrapper.querySelector('.storefront-select-trigger');
  if (!trigger) {
    trigger = document.createElement('button');
    trigger.type = 'button'; trigger.className = 'storefront-select-trigger';
    trigger.setAttribute('aria-haspopup', 'listbox'); trigger.setAttribute('aria-expanded', 'false');
    wrapper.append(trigger);
  }
  let menu = wrapper.querySelector('.storefront-select-menu');
  if (!menu) {
    menu = document.createElement('div'); menu.className = 'storefront-select-menu'; menu.hidden = true;
    menu.setAttribute('role', 'listbox'); wrapper.append(menu);
  }
  if (!menu.id) menu.id = `storefront-select-menu-${++dropdownId}`;
  trigger.setAttribute('aria-controls', menu.id);
  trigger.setAttribute('aria-label', select.getAttribute('aria-label') || 'Выбрать вариант');
  wrapper.classList.add('storefront-select-ready');
  select.setAttribute('aria-hidden', 'true'); select.tabIndex = -1;
  const control = { select, wrapper, trigger, menu };
  const sync = () => {
    menu.replaceChildren(...[...select.options].map(option => {
      const button = document.createElement('button');
      button.type = 'button'; button.className = 'storefront-select-option';
      button.setAttribute('role', 'option'); button.tabIndex = -1;
      button.dataset.value = option.value;
      const selected = option.value === select.value;
      button.setAttribute('aria-selected', String(selected));
      const text = document.createElement('span'); text.className = 'storefront-select-option-label site__h5 color__h3';
      text.textContent = option.textContent;
      const mark = document.createElement('span'); mark.className = 'storefront-select-option-check';
      mark.setAttribute('aria-hidden', 'true'); mark.textContent = '✓';
      button.append(text, mark);
      return button;
    }));
    const current = select.selectedOptions[0]?.textContent || '';
    const name = select.getAttribute('aria-label') || 'Выбрать вариант';
    trigger.setAttribute('aria-label', current ? `${name}: ${current}` : name);
    if (valueNode) valueNode.textContent = current;
    if (activeDropdown === control) positionDropdown(control);
  };
  trigger.addEventListener('click', () => activeDropdown === control ? closeDropdown(control) : openDropdown(control));
  trigger.addEventListener('keydown', event => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault(); openDropdown(control, true);
    } else if (event.key === 'Escape' && activeDropdown === control) closeDropdown(control);
  });
  menu.addEventListener('click', event => {
    const option = event.target.closest('[role="option"]');
    if (!option || !menu.contains(option)) return;
    const changed = select.value !== option.dataset.value;
    select.value = option.dataset.value;
    closeDropdown(control);
    if (changed) select.dispatchEvent(new Event('change', { bubbles: true }));
    trigger.focus();
  });
  menu.addEventListener('keydown', event => {
    const options = [...menu.querySelectorAll('[role="option"]')];
    const current = options.indexOf(event.target.closest('[role="option"]'));
    let next = current;
    if (event.key === 'ArrowDown') next = Math.min(options.length - 1, current + 1);
    else if (event.key === 'ArrowUp') next = Math.max(0, current - 1);
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = options.length - 1;
    else if (event.key === 'Escape') { event.preventDefault(); closeDropdown(control, true); return; }
    else if (event.key === 'Tab') { closeDropdown(control); return; }
    else return;
    event.preventDefault(); options[next]?.focus();
  });
  select.addEventListener('change', sync);
  installDropdownDismissal();
  sync();
  return { sync, control };
}

export function closeDropdownIfDetached() {
  if (activeDropdown && !activeDropdown.wrapper.isConnected) closeDropdown();
}
