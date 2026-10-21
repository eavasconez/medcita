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

describe('the public documents', () => {
  it.each(['politica-de-privacidad.md', 'terminos-de-uso.md'])('%s carries its version and a title', (file) => {
    const text = read(file);
    expect(text).toMatch(/^# .+/);
    expect(text).toMatch(/Versión 2026-10-v1/);
  });
});
