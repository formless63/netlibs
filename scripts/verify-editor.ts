/**
 * Proves the packed editor tarballs work outside this workspace: installs them into a
 * fresh directory with npm, runs them under Node, and typechecks a consumer
 * under both bundler and NodeNext resolution.
 */
import { $ } from 'bun';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
await $`bun scripts/pack.ts`.cwd(root).quiet();

const dir = await mkdtemp(join(tmpdir(), 'netlibs-editor-verify-'));
const tarball = (name: string): string => `file:${root}artifacts/formless63-editor-${name}-0.1.0.tgz`;
const local = {
  '@formless63/editor-core': tarball('core'),
  '@formless63/editor-renderer': tarball('renderer'),
  '@formless63/editor-react': tarball('react')
};
await Bun.write(
  join(dir, 'package.json'),
  JSON.stringify({
    private: true,
    type: 'module',
    dependencies: { ...local, react: '19.3.1', 'react-dom': '19.3.1' },
    devDependencies: {
      '@types/react': '19.3.0',
      '@types/react-dom': '19.3.0',
      typescript: '7.0.2'
    }
  })
);

await Bun.write(
  join(dir, 'smoke.mjs'),
  `
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
assert.equal(typeof globalThis.document, 'undefined');

const core = await import('@formless63/editor-core');
const { document: doc, canCommit } = core.importMarkdown('# Hi\\n\\n- a\\n  - b\\n    - c\\n\\n$x_1$ and [l](rich-doc:abc)');
assert.equal(canCommit, true);
assert.equal(core.validateEditorDocument(doc).success, true);
assert.deepEqual(core.importMarkdown(core.serializeMarkdown(doc)).document, doc);
const service = core.createDocumentService({ store: new core.MemoryDocumentStore() });
const made = await service.create({ title: 'T', content: doc, actorId: 'a' });
const next = await service.applyOperations({ id: made.id, expectedVersion: 1, actorId: 'a', operations: [{ op: 'replaceText', find: 'Hi', replace: 'Bye' }] });
assert.equal(next.version, 2);

const { renderDocumentToHtml } = await import('@formless63/editor-renderer/html');
const html = renderDocumentToHtml({ document: next.content, resolver: { documentHref: ({ documentId }) => '/d/' + documentId, resourceHref: () => null } });
assert.match(html, /<h1 id="bye">Bye<\\/h1>/);
assert.match(html, /href="\\/d\\/abc"/);

const { createElement } = await import('react');
const { renderToString } = await import('react-dom/server');
const { RichTextEditor } = await import('@formless63/editor-react');
await import('@formless63/editor-react/viewers');
assert.match(renderToString(createElement(RichTextEditor, { documentId: 'a', initialContent: doc, version: 1, onSave: async () => ({ version: 2 }) })), /Loading editor/);
for (const css of ['@formless63/editor-renderer/styles.css', '@formless63/editor-react/styles.css']) assert.ok(existsSync(fileURLToPath(import.meta.resolve(css))));
console.log('smoke ok on', process.version);
`
);

// The model and renderer must not even load Tiptap/ProseMirror at run time.
await Bun.write(
  join(dir, 'isolation.mjs'),
  `
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
const loaded = [];
registerHooks({ resolve(specifier, context, next) { const result = next(specifier, context); loaded.push(result.url); return result; } });
await import('@formless63/editor-core/model');
await import('@formless63/editor-renderer');
await import('@formless63/editor-renderer/html');
assert.deepEqual(loaded.filter((url) => /tiptap|prosemirror|codemirror|radix/.test(url)), []);
console.log('isolation ok:', loaded.length, 'modules');
`
);

await Bun.write(
  join(dir, 'consumer.tsx'),
  `
import { applyDocumentOperations, openDocument, type DocumentStore, type EditorResolver } from '@formless63/editor-core';
import { collectDocumentReferences } from '@formless63/editor-core/model';
import { RichTextEditor, type RichTextEditorHandle } from '@formless63/editor-react';
import { configurePdfPreview } from '@formless63/editor-react/viewers';
import { RenderDocument, type NodeComponents } from '@formless63/editor-renderer';
import { createRef } from 'react';

const resolver: EditorResolver = { documentHref: ({ documentId }) => documentId, resourceHref: (id) => id };
const components: NodeComponents = { resourceCard: ({ node }) => <b>{node.type}</b> };
export const ref = createRef<RichTextEditorHandle>();
export const doc = applyDocumentOperations(openDocument({ type: 'doc' }), []);
export const ids: string[] = collectDocumentReferences(doc).resourceIds;
export const bold = (): boolean | undefined => ref.current?.getEditor()?.chain().focus().toggleBold().run();
export declare const store: DocumentStore;
configurePdfPreview({ workerSrc: '/w.mjs' });
export const ui = (
  <>
    <RenderDocument components={components} document={doc} resolver={resolver} />
    <RichTextEditor documentId='a' initialContent={doc} onSave={async ({ expectedVersion }) => ({ version: expectedVersion + 1 })} ref={ref} resolver={resolver} version={1} />
  </>
);
`
);
const tsconfig = (module: string, moduleResolution: string): string =>
  JSON.stringify({
    compilerOptions: {
      target: 'ES2023',
      lib: ['ES2023', 'DOM', 'DOM.Iterable'],
      module,
      moduleResolution,
      jsx: 'react-jsx',
      strict: true,
      noEmit: true,
      skipLibCheck: true,
      types: []
    },
    files: ['consumer.tsx']
  });
await Bun.write(join(dir, 'tsconfig.bundler.json'), tsconfig('ESNext', 'bundler'));
await Bun.write(join(dir, 'tsconfig.node.json'), tsconfig('NodeNext', 'NodeNext'));

await $`npm install --no-audit --no-fund --loglevel=error`.cwd(dir);
await $`node smoke.mjs`.cwd(dir);
await $`node isolation.mjs`.cwd(dir);
await $`bun smoke.mjs`.cwd(dir);
await $`npx --no-install tsc -p tsconfig.bundler.json`.cwd(dir);
await $`npx --no-install tsc -p tsconfig.node.json`.cwd(dir);
console.log(`Editor packages verified in ${dir}`);
