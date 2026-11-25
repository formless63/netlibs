/** Packs every package into ./artifacts. Nothing is published. */
import { $ } from 'bun';
import { copyFile, mkdir, readdir } from 'node:fs/promises';

const root = new URL('..', import.meta.url).pathname;
await mkdir(`${root}artifacts`, { recursive: true });
for (const name of await readdir(`${root}packages`)) {
  await copyFile(`${root}LICENSE`, `${root}packages/${name}/LICENSE`);
  await $`bun pm pack --destination ${root}artifacts --quiet`.cwd(`${root}packages/${name}`);
}
