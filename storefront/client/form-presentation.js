// Presentation is eager; submission/checkout logic remains in the demand chunk.
export function describeLeadControl(control) {
      // Placeholder-only captured fields get an accessible name and autofill hint.
      const autocomplete = { name: 'name', phone: 'tel', email: 'email', city: 'address-level2' }[control.dataset.leadField];
      if (autocomplete && !control.hasAttribute('autocomplete')) control.setAttribute('autocomplete', autocomplete);
      if (control.dataset.leadField === 'phone' && control.closest('form[data-lead-type="question"]')) control.setAttribute('aria-label', 'Телефон');
      if (control.type !== 'checkbox' && !control.labels?.length && !control.hasAttribute('aria-label') && !control.hasAttribute('aria-labelledby')) {
        const name = control.placeholder?.replace(/\*+\s*$/, '').trim();
        if (name) control.setAttribute('aria-label', name);
      }
      if (control.type !== 'checkbox') control.maxLength = { name: 120, phone: 40, email: 200, comment: 1500, city: 100, business: 200 }[control.dataset.leadField] || 200;
}
export function initFormPresentation() {
  document.querySelectorAll('form[data-lead-type]').forEach(form => { form.noValidate = true; });
  document.querySelectorAll('form[data-lead-type] [data-lead-field]').forEach(describeLeadControl);
  document.querySelectorAll('form[data-lead-type] [data-lead-enable]').forEach(button => { button.disabled = false; });
}
