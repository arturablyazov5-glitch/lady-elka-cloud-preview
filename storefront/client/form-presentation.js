// Presentation is eager; submission/checkout logic remains in the demand chunk.
export function describeLeadControl(control) {
      // Placeholder-only captured fields get a persistent (visually hidden) label and autofill hint.
      const autocomplete = { name: 'name', phone: 'tel', email: 'email', city: 'address-level2' }[control.dataset.leadField];
      if (autocomplete && !control.hasAttribute('autocomplete')) control.setAttribute('autocomplete', autocomplete);
      if (control.type !== 'checkbox' && !control.labels?.length && !control.hasAttribute('aria-label') && control.id && control.placeholder) {
        const label = document.createElement('label');
        label.className = 'storefront-visually-hidden'; label.htmlFor = control.id;
        label.textContent = control.placeholder.replace(/\*+\s*$/, '').trim();
        control.before(label);
      }
      if (control.type !== 'checkbox') control.maxLength = { name: 120, phone: 40, email: 200, comment: 1500, city: 100, business: 200 }[control.dataset.leadField] || 200;
}
export function initFormPresentation() {
  document.querySelectorAll('form[data-lead-type]').forEach(form => { form.noValidate = true; });
  document.querySelectorAll('form[data-lead-type] [data-lead-field]').forEach(describeLeadControl);
  document.querySelectorAll('form[data-lead-type] [data-lead-enable]').forEach(button => { button.disabled = false; });
}
