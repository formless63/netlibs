/**
 * Regenerate `packages/viewer-ecad/vendor/`.
 *
 * KiCanvas has no npm package, so its published bundle is vendored, pinned by
 * hash, with TWO modifications:
 *
 *  1. Its final statement injects a Google Fonts stylesheet into the host page,
 *     a third-party request on every page showing a board. Removed; the icon
 *     font is self-hosted.
 *  2. Its icon template briefly holds a literal placeholder in an SVG `href`,
 *     so every mount requests `<host page>/$$:0:$$`. The node is built directly.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const UPSTREAM = 'https://kicanvas.org/kicanvas/kicanvas.js';
const UPSTREAM_SHA256 = 'ca910f25276c3efb9aacb3a5d6341d4d9af4736d4c875fb0440d2cc856865ab7';
const out = join(import.meta.dir, '../packages/viewer-ecad/vendor');

const local = process.argv[2];
const source = local ? readFileSync(local, 'utf8') : await (await fetch(UPSTREAM)).text();
const sha = createHash('sha256').update(source).digest('hex');
if (sha !== UPSTREAM_SHA256) {
  throw new Error(`KiCanvas bundle changed (sha256 ${sha}). Review it, then update the pin.`);
}

const fontInjection =
  /document\.body\.appendChild\(f`<link\s+rel="stylesheet"\s+href="https:\/\/fonts\.googleapis\.com[^`]*`\);?/;
if (!fontInjection.test(source)) throw new Error('Font injection statement not found');
const iconHref = '<use xlink:href="${r}" />';
if (source.split(iconHref).length !== 2) throw new Error('Icon template not found');
const iconNode =
  "${(()=>{let u=document.createElementNS('http://www.w3.org/2000/svg','use');u.setAttribute('href',r);return u})()}";
await Bun.write(
  join(out, 'kicanvas.js'),
  `/*! KiCanvas (c) 2022 Alethea Katherine Flowers, MIT. See LICENSE.md. Modified; see README.md. */\n${source.replace(fontInjection, '').replace(iconHref, () => iconNode)}`,
);

// Material Symbols ligature names the bundle uses as icons.
const icons = new Set<string>();
for (const match of source.matchAll(/<kc-ui-icon[^>]*>([a-z_0-9]+)<\/kc-ui-icon>/g))
  icons.add(match[1]!);
for (const match of source.matchAll(/\bicon="([a-z_0-9]+)"/g)) icons.add(match[1]!);
for (const match of source.matchAll(/button_icon="([a-z_0-9]+)"/g)) icons.add(match[1]!);
for (const name of process.env.EXTRA_ICONS?.split(',') ?? []) if (name) icons.add(name);
const names = [...icons].sort();
const css = await (
  await fetch(
    `https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@48,400,0,0&icon_names=${names.join(',')}`,
    // Google serves woff2 only to user agents it knows support it.
    {
      headers: {
        'user-agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/140 Safari/537.36',
      },
    },
  )
).text();
const fontUrl = /url\((https:[^)]+)\) format\('woff2'\)/.exec(css)?.[1];
if (!fontUrl) throw new Error(`No woff2 in Google Fonts response:\n${css.slice(0, 400)}`);
const font = Buffer.from(await (await fetch(fontUrl)).arrayBuffer());
await Bun.write(
  join(out, 'material-symbols.js'),
  [
    '/*! Material Symbols Outlined (c) Google, Apache-2.0 (LICENSE-material-symbols.txt). Subset of the icons KiCanvas uses. */',
    `// ${names.join(' ')}`,
    `export default 'data:font/woff2;base64,${font.toString('base64')}';`,
    '',
  ].join('\n'),
);
console.log(`${names.length} icons, ${font.length} byte font:`, names.join(' '));
