const attachedMasks = new WeakMap();

export function formatRussianPhone(rawValue, caretPosition = String(rawValue || '').length) {
  const raw = String(rawValue || '');
  const digits = raw.replace(/\D/g, '');
  if (!digits) return { value: '', caret: 0, localDigits: '' };

  // Accept both a local 10-digit number and pasted numbers with +7/8 prefix.
  const explicitCountryPrefix = /^\s*\+7(?:\D|$)/.test(raw);
  const pastedCountryPrefix = digits.length > 10 && /^[78]/.test(digits);
  const hasCountryPrefix = explicitCountryPrefix || pastedCountryPrefix;
  const localDigits = (hasCountryPrefix ? digits.slice(1) : digits).slice(0, 10);
  const prefixDigitIndex = hasCountryPrefix ? raw.search(/[78]/) : -1;

  let value = '+7';
  if (localDigits.length) {
    value += ` (${localDigits.slice(0, 3)}`;
    if (localDigits.length > 3) value += `) ${localDigits.slice(3, 6)}`;
    if (localDigits.length > 6) value += `-${localDigits.slice(6, 8)}`;
    if (localDigits.length > 8) value += `-${localDigits.slice(8, 10)}`;
  }

  let localDigitsBeforeCaret = raw.slice(0, caretPosition).replace(/\D/g, '').length;
  if (prefixDigitIndex >= 0 && caretPosition > prefixDigitIndex) localDigitsBeforeCaret -= 1;
  localDigitsBeforeCaret = Math.max(0, Math.min(localDigits.length, localDigitsBeforeCaret));

  let caret = value.length;
  if (localDigitsBeforeCaret === 0) {
    caret = localDigits.length ? value.indexOf('(') : value.length;
  } else {
    let seen = 0;
    for (let index = value.indexOf('(') + 1; index < value.length; index += 1) {
      if (/\d/.test(value[index]) && ++seen === localDigitsBeforeCaret) {
        caret = index + 1;
        break;
      }
    }
  }
  return { value, caret, localDigits };
}

export function attachRussianPhoneMask(input) {
  if (!input) return () => {};
  const existing = attachedMasks.get(input);
  if (existing) return existing;

  const maskPhone = () => {
    const formatted = formatRussianPhone(input.value, input.selectionStart ?? input.value.length);
    input.value = formatted.value;
    try { input.setSelectionRange(formatted.caret, formatted.caret); } catch {}
  };
  input.addEventListener('input', maskPhone);
  maskPhone();

  const cleanup = () => {
    input.removeEventListener('input', maskPhone);
    attachedMasks.delete(input);
  };
  attachedMasks.set(input, cleanup);
  return cleanup;
}

export function initPhoneMasks(root = document) {
  const inputs = new Set(root.querySelectorAll(
    'input[type="tel"]:not([data-checkout-field="phone"]), input[name="phone"]:not([data-checkout-field="phone"])',
  ));
  inputs.forEach(attachRussianPhoneMask);
}
