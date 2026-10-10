// Explicit mapping of the owned templates; placeholders are presentation, never an API.
export const leadForms = {
  iawvkogkq_0: { type: 'question', fields: ['comment', 'phone', 'consent'] },
  iu4a9894i_0: { type: 'installment', fields: ['name', 'phone', 'comment', 'consent'] },
  ibfs75na0_0: { type: 'consultation', fields: ['name', 'phone', 'comment', 'consent'] },
  i1hecfw24_0: { type: 'consultation', fields: ['name', 'phone', 'comment', 'consent'] },
  ir9vcpl2u_0: { type: 'wholesale', fields: ['name', 'email', 'phone', 'city', 'business', 'consent'] },
  iiv1gzzdr_0: { type: 'wholesale', fields: ['name', 'email', 'phone', 'city', 'business', 'consent'] },
};
export function annotateLeadForms(html) {
  return html.replace(/<form\b[^>]*>[\s\S]*?<\/form>/gi, form => {
    const id = /\bid=['"]([^'"]+)['"]/.exec(form)?.[1];
    const schema = leadForms[id];
    if (!schema) {
      if (/type=['"]tel['"]/.test(form) && !/data-pay-now/.test(form)) throw new Error(`Unmapped contact form: ${id}`);
      return form;
    }
    let index = 0;
    form = form.replace(/^<form\b[^>]*>/i, tag => tag.replace(/\s(?:method|action)=['"][^'"]*['"]/gi, '').replace(/>$/, ` method="post" action="/" data-lead-type="${schema.type}">`));
    form = form.replace(/<(?:button|input)\b[^>]*type=['"]submit['"][^>]*>/gi, tag => tag.replace(/\sdisabled(?:=['"][^'"]*['"])?/gi,'').replace(/>$/, ' data-lead-enable disabled>')); 
    form = form.replace(/<(?:input|textarea|select)\b[^>]*>/gi, tag => {
      if (/type=['"](?:hidden|submit)['"]/.test(tag)) return tag;
      const key = schema.fields[index++];
      if (!key) throw new Error(`Unexpected lead control: ${id}`);
      return tag.replace(/\sname=['"][^'"]*['"]/g, '').replace(/>$/, ` name="${key}" data-lead-field="${key}" required>`);
    });
    if (index !== schema.fields.length) throw new Error(`Missing lead control: ${id}`);
    return form;
  });
}
