#!/usr/bin/env node
// Copy pdf.js runtime assets (fonts, CMaps, WASM decoders, ICC profiles) into a
// directory your app serves, for `configurePdf({ assetBaseUrl })`.
import { cpSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';

const target = process.argv[2];
if (!target) {
  console.error('usage: viewer-pdf-assets <output-directory>');
  process.exit(1);
}
const root = dirname(createRequire(import.meta.url).resolve('pdfjs-dist/package.json'));
const out = resolve(target);
mkdirSync(out, { recursive: true });
for (const dir of ['standard_fonts', 'cmaps', 'wasm', 'iccs', 'LICENSE']) {
  cpSync(join(root, dir), join(out, dir), { recursive: true });
}
console.log(`pdf.js assets copied to ${out}`);
