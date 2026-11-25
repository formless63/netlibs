/** Copies the viewers' stylesheets next to their built code. */
import { copyFile } from 'node:fs/promises';

const root = new URL('..', import.meta.url).pathname;
for (const name of ['viewer-core', 'viewer-markdown', 'viewers']) {
  await copyFile(`${root}packages/${name}/src/styles.css`, `${root}packages/${name}/dist/styles.css`);
}
