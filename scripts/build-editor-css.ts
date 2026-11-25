/** Builds the two published stylesheets. KaTeX's own CSS stays a separate host import. */
import { $ } from 'bun';
import { mkdir } from 'node:fs/promises';

const root = new URL('..', import.meta.url).pathname;
const read = (path: string): Promise<string> => Bun.file(root + path).text();

await mkdir(`${root}packages/editor-renderer/dist`, { recursive: true });
await mkdir(`${root}packages/editor-react/dist`, { recursive: true });

const content = `${await read('packages/editor-renderer/styles/tokens.css')}\n${await read('packages/editor-renderer/styles/content.css')}`;
await Bun.write(`${root}packages/editor-renderer/dist/styles.css`, content);

const utilities = await $`bunx --no-install tailwindcss -i packages/editor-react/styles/utilities.css --minify`
  .cwd(root)
  .quiet()
  .text();
await Bun.write(
  `${root}packages/editor-react/dist/styles.css`,
  `${content}\n${await read('packages/editor-react/styles/editor.css')}\n${utilities}`
);
