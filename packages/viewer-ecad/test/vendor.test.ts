import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { expect, it } from 'vitest';

const vendor = (name: string) =>
  readFileSync(join(process.cwd(), 'packages/viewer-ecad/vendor', name), 'utf8');

it('ships KiCanvas without the Google Fonts injection, and with its licence', () => {
  const bundle = vendor('kicanvas.js');
  expect(bundle).not.toContain('fonts.googleapis.com');
  expect(bundle).not.toContain('xlink:href="${r}"');
  expect(bundle).toContain('customElements.define("kicanvas-embed"');
  expect(bundle.startsWith('/*! KiCanvas')).toBe(true);
  expect(vendor('LICENSE.md')).toContain('Alethea Katherine Flowers');
});
