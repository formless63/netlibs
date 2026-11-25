/**
 * Installs the packed tarballs into clean directories with npm: each package
 * on its own (so an undeclared dependency fails), then all together with a
 * typechecked consumer. No network access beyond the npm registry.
 */
import { $ } from 'bun';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
await rm(`${root}artifacts`, { recursive: true, force: true });
await $`bun scripts/pack.ts`.cwd(root).quiet();

type Manifest = { name: string; version: string; dependencies?: Record<string, string>; exports: Record<string, unknown> };
const manifests = new Map<string, Manifest>();
for (const dir of await readdir(`${root}packages`)) {
  if (dir.startsWith('editor-')) continue; // scripts/verify-editor.ts
  const manifest = (await Bun.file(`${root}packages/${dir}/package.json`).json()) as Manifest;
  manifests.set(manifest.name, manifest);
}
const tarball = ({ name, version }: Manifest): string =>
  `file:${root}artifacts/${name.slice(1).replace('/', '-')}-${version}.tgz`;
/** A package and the workspace packages it declares, transitively. */
const closure = (name: string): Set<string> => {
  const found = new Set([name]);
  for (const dependency of Object.keys(manifests.get(name)!.dependencies ?? {})) {
    if (manifests.has(dependency)) for (const inner of closure(dependency)) found.add(inner);
  }
  return found;
};

async function consumer(names: Iterable<string>, extra: Record<string, string> = {}): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'netlibs-verify-'));
  const local = Object.fromEntries([...names].map((name) => [name, tarball(manifests.get(name)!)]));
  await Bun.write(
    join(dir, 'package.json'),
    JSON.stringify({ private: true, type: 'module', dependencies: { ...local, ...extra }, overrides: local })
  );
  await $`npm install --no-audit --no-fund --loglevel=error`.cwd(dir).quiet();
  return dir;
}

for (const [name, manifest] of manifests) {
  // React is a peer: npm installs it for packages that declare it.
  const dir = await consumer(closure(name));
  // Stylesheets and worker entries are not loadable in Node.
  const entries = Object.keys(manifest.exports).filter((key) => !/\.json$|\.css$|worker$|mermaid$/.test(key));
  const imports = entries.map((key) => `await import(${JSON.stringify(name + key.slice(1))});`).join('\n');
  await Bun.write(join(dir, 'load.mjs'), `${imports}\n`);
  await $`node load.mjs`.cwd(dir);
  const count = async (glob: string): Promise<number> =>
    (await Array.fromAsync(new Bun.Glob(glob).scan(dir))).length;
  const installed = (await count('node_modules/*/package.json')) + (await count('node_modules/@*/*/package.json'));
  console.log(`${name}: loads alone (${installed} package(s) installed)`);
  await rm(dir, { recursive: true });
}

/** React packages are checked by verify-viewers.ts. */
const plain = [...manifests].filter(([name]) => !name.includes('/viewer')).map(([name]) => name);
const dir = await consumer(plain, { typescript: '7.0.2' });
await Bun.write(
  join(dir, 'consumer.ts'),
  `
import { createCloudflareDns, CloudflareError } from '@formless63/cloudflare-dns';
import { diffRecords, planOperations, type DnsProvider } from '@formless63/dns-plan';
import { compareRegistrations, inferDnsProvider } from '@formless63/domain-intel';
import { createPangolinClient } from '@formless63/pangolin-client';
import { createRateBudget, ProviderError, type ProviderErrorKind } from '@formless63/provider-http';
import { createRdapClient, type RdapDomain } from '@formless63/rdap';
import { diffBlocks } from '@formless63/block-diff';
import { proseMirrorDiff } from '@formless63/block-diff/prosemirror';
import { fileDelivery } from '@formless63/file-delivery';
import { column, decimal, readTable } from '@formless63/messy-table';
import { WriteBehind } from '@formless63/write-behind';
import type { Registrar } from '@formless63/registrar';
import { assertRegistrarConformance } from '@formless63/registrar/testing';
import { createNamecheapRegistrar } from '@formless63/registrar-namecheap';
import { createSpaceshipRegistrar } from '@formless63/registrar-spaceship';

const registrars: Registrar[] = [
  createSpaceshipRegistrar({ apiKey: 'k', apiSecret: 's' }),
  createNamecheapRegistrar({ apiUser: 'u', apiKey: 'k', userName: 'u', clientIp: '192.0.2.1' })
];
const dns: DnsProvider = createCloudflareDns({ apiToken: 't', rateBudget: createRateBudget({ capacity: 1, refillPerSecond: 1 }) });
const pangolin = createPangolinClient({ baseUrl: 'https://api.example.com', apiKeyId: 'i', apiKeySecret: 's' });
// RDAP results feed change detection directly.
const changes = (a: RdapDomain, b: RdapDomain) => compareRegistrations(a, b);
const kind = (error: unknown): ProviderErrorKind | null => (error instanceof ProviderError ? error.kind : null);

// One ProviderError class is shared by every installed package.
try {
  createCloudflareDns({ apiToken: '' });
} catch (error) {
  if (!(error instanceof CloudflareError) || kind(error) !== 'invalid_input') throw new Error('error identity');
}
const desired = [{ type: 'A', name: '@', content: '192.0.2.1', ttlSeconds: null, priority: null, proxied: false }];
if (planOperations(diffRecords(desired, [])).length !== 1) throw new Error('plan');
if (diffBlocks([{ type: 'p' }], [{ type: 'p' }], proseMirrorDiff())[0]?.status !== 'unchanged') throw new Error('diff');
if (fileDelivery({ contentType: 'text/html', filename: 'x' }).disposition !== 'attachment') throw new Error('delivery');
const total: string | null | undefined = readTable([['Total', 'Sku'], ['$1.50', 'a']], { total: column('Total', { read: decimal() }), sku: column('Sku') })?.rows[0]?.values.total;
if (total !== '1.50') throw new Error('table');
const saved: Promise<number> = new WriteBehind({ initialResult: 0, store: async () => 1 }).flush();
if ((await saved) !== 0) throw new Error('write-behind');
if (inferDnsProvider(['a.ns.cloudflare.com']) !== 'Cloudflare') throw new Error('infer');
const fetch = async (url: string) => new Response(JSON.stringify(url.endsWith('dns.json') ? { services: [[['example'], ['https://r.example.invalid/']]] } : { objectClassName: 'domain', ldhName: 'A.EXAMPLE', status: ['ok'] }));
const found = await createRdapClient({ fetch }).lookup('a.example');
if (found.status[0] !== 'active' || changes(found, found).length !== 0) throw new Error('rdap');
console.log('consumer ok on', globalThis.process.version, registrars.length, dns.id, typeof pangolin.probe, typeof assertRegistrarConformance);
`
);
await Bun.write(
  join(dir, 'globals.d.ts'),
  'declare global { var process: { version: string }; }\nexport {};\n'
);
for (const [module, moduleResolution] of [['NodeNext', 'NodeNext'], ['ESNext', 'bundler']] as const) {
  await Bun.write(
    join(dir, 'tsconfig.json'),
    JSON.stringify({
      compilerOptions: { target: 'ES2023', lib: ['ES2023', 'DOM', 'DOM.Iterable'], module, moduleResolution, strict: true, exactOptionalPropertyTypes: true, noEmit: true, types: [] },
      files: ['consumer.ts', 'globals.d.ts']
    })
  );
  // skipLibCheck is off: the published declarations must be sound on their own.
  await $`npx --no-install tsc -p tsconfig.json`.cwd(dir);
}
await $`npx --no-install tsc --target ES2023 --module NodeNext --moduleResolution NodeNext --types "" --ignoreConfig --outDir out consumer.ts globals.d.ts`.cwd(dir).quiet().nothrow();
await $`node ${(await Bun.file(join(dir, 'out/consumer.js')).exists()) ? 'out/consumer.js' : 'consumer.ts'}`.cwd(dir);
await $`bun consumer.ts`.cwd(dir);
console.log(`Packages verified in ${dir}`);
