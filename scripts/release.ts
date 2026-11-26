/**
 * Publishes every public package whose version is not on the registry yet,
 * dependencies first. Private packages are skipped.
 *
 *   bun scripts/release.ts            plan only: what would be published
 *   bun scripts/release.ts --dry-run  pack and run `npm publish --dry-run`
 *   bun scripts/release.ts --publish  publish (CI only; see docs/releasing.md)
 *
 * With trusted publishing (OIDC) npm adds provenance itself. With a token
 * (first release only) `--provenance` is passed explicitly.
 */
import { $ } from 'bun';
import { readdir, rm } from 'node:fs/promises';

const root = new URL('..', import.meta.url).pathname;
const mode = process.argv.includes('--publish') ? 'publish' : process.argv.includes('--dry-run') ? 'dry-run' : 'plan';

type Manifest = { name: string; version: string; private?: boolean; dependencies?: Record<string, string> };
const manifests = new Map<string, Manifest & { dir: string }>();
for (const dir of await readdir(`${root}packages`)) {
  const manifest = (await Bun.file(`${root}packages/${dir}/package.json`).json()) as Manifest;
  manifests.set(manifest.name, { ...manifest, dir });
}

/** Dependencies before dependents. */
const order: string[] = [];
const visit = (name: string, path: string[] = []): void => {
  if (order.includes(name)) return;
  if (path.includes(name)) throw new Error(`dependency cycle: ${[...path, name].join(' -> ')}`);
  for (const dependency of Object.keys(manifests.get(name)!.dependencies ?? {})) {
    if (manifests.has(dependency)) visit(dependency, [...path, name]);
  }
  order.push(name);
};
for (const name of [...manifests.keys()].sort()) visit(name);

async function published(name: string, version: string): Promise<boolean> {
  const result = await $`npm view ${`${name}@${version}`} version --json`.quiet().nothrow();
  if (result.exitCode === 0) return result.stdout.toString().trim() !== '';
  if (/E404|404 Not Found/.test(result.stderr.toString())) return false;
  throw new Error(`could not query the registry for ${name}: ${result.stderr.toString().slice(0, 300)}`);
}

const pending: string[] = [];
for (const name of order) {
  const manifest = manifests.get(name)!;
  if (manifest.private) continue;
  // A public package must not depend on a private one.
  for (const dependency of Object.keys(manifest.dependencies ?? {})) {
    if (manifests.get(dependency)?.private) throw new Error(`${name} depends on private ${dependency}`);
  }
  if (await published(name, manifest.version)) continue;
  pending.push(name);
}

console.log(pending.length === 0 ? 'Nothing to publish.' : `To publish:\n${pending.map((name) => `  ${name}@${manifests.get(name)!.version}`).join('\n')}`);
if (mode === 'plan' || pending.length === 0) process.exit(0);

await rm(`${root}artifacts`, { recursive: true, force: true });
await $`bun scripts/pack.ts`.cwd(root).quiet();
const usingToken = Boolean(process.env['NODE_AUTH_TOKEN']);
for (const name of pending) {
  const { version } = manifests.get(name)!;
  const tarball = `${root}artifacts/${name.slice(1).replace('/', '-')}-${version}.tgz`;
  const flags = ['--access', 'public', ...(mode === 'dry-run' ? ['--dry-run'] : []), ...(usingToken && mode === 'publish' ? ['--provenance'] : [])];
  await $`npm publish ${tarball} ${flags}`.cwd(root);
  console.log(`${mode === 'dry-run' ? 'checked' : 'published'} ${name}@${version}`);
}
