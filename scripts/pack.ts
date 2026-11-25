/** Packs every package into ./artifacts. Nothing is published. */
import { $ } from 'bun';
import { copyFile, mkdir, readdir } from 'node:fs/promises';

const root = new URL('..', import.meta.url).pathname;
await mkdir(`${root}artifacts`, { recursive: true });
for (const name of await readdir(`${root}packages`)) {
  await copyFile(`${root}LICENSE`, `${root}packages/${name}/LICENSE`);
  if (/^(editor-|viewer)/.test(name)) {
    await copyFile(`${root}THIRD_PARTY_NOTICES.md`, `${root}packages/${name}/THIRD_PARTY_NOTICES.md`);
  }
  await $`bun pm pack --destination ${root}artifacts --quiet`.cwd(`${root}packages/${name}`);
}
