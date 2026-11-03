const fs = require('fs');
const path = require('path');
const { HEALTH_DATA_CONSENT } = require('../src/legal/healthDataConsent');

const read = (file) => fs.readFileSync(path.join(__dirname, '..', '..', 'docs', 'legal', file), 'utf8');

// The consent text lives in two places: the code (what the app shows and the version it
// records) and the printable form. If someone edits one and not the other, patients would
// sign a text that differs from the version on record.
describe('docs/legal/consentimiento-datos-salud.md', () => {
  const printable = read('consentimiento-datos-salud.md');

  it('states the version the code records', () => {
    expect(printable).toContain(`**Versión del texto: \`${HEALTH_DATA_CONSENT.version}\`**`);
  });

  it('has every paragraph of the text the app shows, word for word', () => {
    for (const paragraph of HEALTH_DATA_CONSENT.paragraphs) expect(printable).toContain(paragraph);
  });

  it('has the same title', () => {
    expect(printable.startsWith(`# ${HEALTH_DATA_CONSENT.title}`)).toBe(true);
  });
});

const PUBLIC_DOCS = ['politica-de-privacidad.md', 'terminos-de-uso.md', 'eliminacion-de-datos.md', 'contacto.md'];
const company = JSON.parse(read('empresa.json'));

describe('the public documents', () => {
  it.each(['politica-de-privacidad.md', 'terminos-de-uso.md', 'eliminacion-de-datos.md'])('%s carries its version and a title', (file) => {
    const text = read(file);
    expect(text).toMatch(/^# .+/);
    expect(text).toMatch(/Versión 2026-11-v1/);
  });

  it('contacto.md carries a title', () => {
    expect(read('contacto.md')).toMatch(/^# .+/);
  });

  // The pages write the company's details as {{empresa.campo}} and the app fills them from
  // empresa.json: a token without a field would reach the public page as raw text.
  it.each(PUBLIC_DOCS)('%s only uses company fields that exist in empresa.json', (file) => {
    const tokens = [...read(file).matchAll(/\{\{empresa\.([a-z_]+)\}\}/g)].map((m) => m[1]);
    expect(tokens.length).toBeGreaterThan(0);
    for (const key of tokens) expect(company).toHaveProperty(key);
  });

  it('empresa.json has every field the pages need, all filled in', () => {
    for (const key of ['razon_social', 'ruc', 'domicilio', 'correo_privacidad', 'telefono', 'sitio']) {
      expect(typeof company[key]).toBe('string');
      expect(company[key].trim()).not.toBe('');
    }
    expect(company.sitio).toMatch(/^https:\/\/[^/]+$/);
  });

  it('the privacy policy tells people how to ask for their data to be deleted and where', () => {
    const text = read('politica-de-privacidad.md');
    expect(text).toContain('{{empresa.sitio}}/data-deletion');
    expect(text).toContain('{{empresa.correo_privacidad}}');
  });

  it('the privacy policy does not name a hosting provider the project stopped using', () => {
    expect(read('politica-de-privacidad.md')).toMatch(/Railway/);
  });
});
