/** Runs each test file with the runner it is written for: `bun:test`, or Vitest where jsdom is needed. */
import { $ } from 'bun';

const root = new URL('..', import.meta.url).pathname;
const bunFiles: string[] = [];
for await (const path of new Bun.Glob('packages/*/test/**/*.test.{ts,tsx}').scan(root)) {
  if ((await Bun.file(root + path).text()).includes("from 'bun:test'")) bunFiles.push(`./${path}`);
}
await $`bun test ${bunFiles.toSorted()}`.cwd(root);
await $`bunx --no-install vitest run`.cwd(root);
