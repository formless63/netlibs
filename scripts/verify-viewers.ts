/**
 * Prove the tarballs work outside this workspace: install them into an empty
 * project, import every entry point under plain Node (no DOM), and bundle a
 * client with Vite. Run `bun run build` first.
 */
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = join(import.meta.dir, '..');
const packs = join(root, 'artifacts');
Bun.spawnSync(['bun', 'scripts/pack.ts'], { cwd: root, stdio: ['ignore', 'ignore', 'inherit'] });
const names = ['core', 'media', 'markdown', 'pdf', 'model', 'ecad', 'lbx'].map(
  (n) => `@formless63/viewer-${n}`,
);
names.push('@formless63/viewers');

const tarball = (name: string) => {
  const file = readdirSync(packs).find((f) =>
    f.startsWith(`${name.replace('@', '').replace('/', '-')}-0`),
  );
  if (!file) throw new Error(`No tarball for ${name}. Run bun run pack:all.`);
  return `file:${join(packs, file)}`;
};
const versions = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
  .devDependencies as Record<string, string>;
const dir = mkdtempSync(join(tmpdir(), 'viewer-consumer-'));
const files = Object.fromEntries(names.map((name) => [name, tarball(name)]));
writeFileSync(
  join(dir, 'package.json'),
  JSON.stringify({
    name: 'consumer',
    private: true,
    type: 'module',
    dependencies: {
      ...files,
      react: versions['react'],
      'react-dom': versions['react-dom'],
      vite: versions['vite'],
      typescript: versions['typescript'],
      '@types/react': versions['@types/react'],
      '@types/react-dom': versions['@types/react-dom'],
    },
    // The packages depend on each other by version, and are on no registry.
    overrides: files,
  }),
);
writeFileSync(
  join(dir, 'ssr.mjs'),
  `const ids = ${JSON.stringify([
    ...names,
    ...names.filter((n) => !/core$|viewers$/.test(n)).map((n) => `${n}/definitions`),
    '@formless63/viewers/registry',
  ])};
if (typeof window !== 'undefined') throw new Error('expected no DOM');
for (const id of ids) await import(id);
const { createDefaultRegistry, FileViewer, ViewerProvider } = await import('@formless63/viewers');
const { createElement: h } = await import('react');
const { renderToString } = await import('react-dom/server');
const registry = createDefaultRegistry();
const html = renderToString(h(ViewerProvider, { registry }, h(FileViewer, { source: '/a.lbx' })));
if (!html.includes('data-fv-frame="lbx"')) throw new Error(html);
for (const d of registry.definitions) renderToString(h((await d.load()).default, { source: '/x' }));
console.log('SSR import and render OK under', process.version, '-', ids.length, 'entry points');
`,
);
writeFileSync(
  join(dir, 'index.html'),
  '<div id="root"></div><script type="module" src="/main.tsx"></script>',
);
writeFileSync(
  join(dir, 'main.tsx'),
  `import '@formless63/viewers/styles.css';
import { createDefaultRegistry, FileViewer, ViewerProvider } from '@formless63/viewers';
import { createRoot } from 'react-dom/client';
const registry = createDefaultRegistry();
createRoot(document.getElementById('root')!).render(
  <ViewerProvider registry={registry}><FileViewer source="/a.pdf" /></ViewerProvider>,
);
`,
);
writeFileSync(
  join(dir, 'tsconfig.json'),
  JSON.stringify({
    compilerOptions: {
      strict: true,
      noEmit: true,
      jsx: 'react-jsx',
      module: 'ESNext',
      moduleResolution: 'bundler',
      target: 'ES2023',
      lib: ['ES2023', 'DOM', 'DOM.Iterable'],
      types: ['vite/client'],
      skipLibCheck: false,
    },
    include: ['main.tsx'],
  }),
);

function run(...cmd: string[]): void {
  const result = Bun.spawnSync(cmd, { cwd: dir, stdio: ['ignore', 'inherit', 'inherit'] });
  if (result.exitCode !== 0) throw new Error(`${cmd.join(' ')} failed`);
}
try {
  run('bun', 'install', '--silent');
  run('node', 'ssr.mjs');
  run('node', 'node_modules/vite/bin/vite.js', 'build', '--logLevel', 'error');
  const assets = readdirSync(join(dir, 'dist/assets'));
  const entry = assets.find((f) => /^index-.*\.js$/.test(f))!;
  const size = readFileSync(join(dir, 'dist/assets', entry)).length;
  for (const chunk of ['pdf-worker', 'kicanvas', 'o3dv', 'model-viewer', 'lbx-viewer']) {
    if (!assets.some((f) => f.startsWith(chunk)))
      throw new Error(`no separate ${chunk} chunk: ${assets.join(' ')}`);
  }
  if (size > 400_000) throw new Error(`entry chunk is ${size} bytes; an engine leaked into it`);
  console.log(`Vite consumer OK: ${size} byte entry (React included), ${assets.length} assets`);
  run('node', 'node_modules/typescript/bin/tsc', '-p', 'tsconfig.json');
  console.log('Types OK with skipLibCheck off');
} finally {
  if (process.env['KEEP']) console.log(dir);
  else rmSync(dir, { recursive: true, force: true });
}
