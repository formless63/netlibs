import { globSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

const root = fileURLToPath(new URL('.', import.meta.url));
const include = globSync('packages/*/test/**/*.test.{ts,tsx}', { cwd: root }).filter((path) =>
  readFileSync(root + path, 'utf8').includes("from 'vitest'")
);
const packages = `${root}packages`;

export default defineConfig({
  resolve: {
    // Test sources, so a stale build can never pass.
    alias: [
      { find: /^@formless63\/([\w-]+)\/mermaid$/, replacement: `${packages}/$1/src/mermaid.tsx` },
      { find: /^@formless63\/([\w-]+)\/([\w-]+)$/, replacement: `${packages}/$1/src/$2.ts` },
      { find: /^@formless63\/([\w-]+)$/, replacement: `${packages}/$1/src/index.ts` }
    ]
  },
  test: { include, setupFiles: ['./scripts/vitest-setup.ts'] }
});
