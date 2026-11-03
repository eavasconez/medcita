import company from '../../../docs/legal/empresa.json';

export const EMPRESA = company;

// The legal texts in docs/legal/ write the company's details as {{empresa.campo}}, so the
// name, RUC, address, e-mail and phone live in docs/legal/empresa.json and change in every
// page at once. A token with no matching field is left as written, which makes the mistake visible.
export function fillCompany(text, data = company) {
  return text.replace(/\{\{empresa\.([a-z_]+)\}\}/g, (whole, key) =>
    Object.prototype.hasOwnProperty.call(data, key) && !key.startsWith('_') ? data[key] : whole
  );
}
