import '@formless63/editor-react/styles.css';
import 'katex/dist/katex.min.css';

import { serializeMarkdown, type EditorDocument, type EditorResolver } from '@formless63/editor-core';
import { configurePdfPreview, RichMermaidViewer, RichTextEditor } from '@formless63/editor-react';
import { RenderDocument } from '@formless63/editor-renderer';
import pdfWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';

import { SAMPLES } from './documents.ts';

configurePdfPreview({ workerSrc: pdfWorker });

const uploads = new Map<string, string>();

const canvasImage = (): string => {
  const canvas = document.createElement('canvas');
  canvas.width = 720;
  canvas.height = 360;
  const context = canvas.getContext('2d');
  if (context) {
    context.fillStyle = '#2457c5';
    context.fillRect(0, 0, 720, 360);
    context.fillStyle = '#ffffff';
    context.font = '48px sans-serif';
    context.fillText('Sample image', 200, 195);
  }
  const bytes = Uint8Array.from(atob(canvas.toDataURL('image/png').split(',')[1]!), (c) => c.charCodeAt(0));
  return URL.createObjectURL(new Blob([bytes], { type: 'image/png' }));
};
uploads.set('sample-image', canvasImage());
uploads.set('sample-file', URL.createObjectURL(new Blob(['part,qty\nwall,4\n'], { type: 'text/csv' })));

/** An in-memory host: ids resolve to hash routes and blob URLs. */
const resolver: EditorResolver = {
  documentHref: ({ documentId, anchor }) => `/?doc=${documentId}${anchor ? `#${anchor}` : ''}`,
  parseDocumentHref: (href) => {
    const url = new URL(href, location.href);
    const documentId = url.origin === location.origin ? url.searchParams.get('doc') : null;
    return documentId ? { documentId, anchor: url.hash.slice(1) || null } : null;
  },
  resourceHref: (id) => uploads.get(id) ?? null,
  taskHref: (id) => `/?task=${id}`
};

const childDocuments = [
  {
    id: 'cms',
    documentType: 'page',
    title: 'Public CMS page',
    href: '/?doc=cms',
    updatedAt: '2026-11-01T00:00:00Z',
    publishedAt: '2026-10-01T00:00:00Z',
    childCount: 0
  }
];

async function upload(file: File): Promise<{ id: string; name: string; mimeType: string }> {
  const id = crypto.randomUUID();
  uploads.set(id, URL.createObjectURL(file));
  return { id, name: file.name, mimeType: file.type };
}

function App() {
  const [key, setKey] = useState(new URL(location.href).searchParams.get('doc') ?? 'docs');
  const sample = SAMPLES[key] ?? SAMPLES.docs!;
  const [content, setContent] = useState<EditorDocument>(sample.content);
  const [pane, setPane] = useState<'public' | 'json' | 'markdown'>('public');
  const [dark, setDark] = useState(false);
  useEffect(() => {
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  }, [dark]);
  const mermaid = content.content?.find(
    (node) => node.type === 'codeBlock' && node.attrs?.language === 'mermaid'
  );
  return (
    <div
      style={{
        minHeight: '100vh',
        padding: 16,
        fontFamily: 'system-ui',
        background: 'var(--rich-background)',
        color: 'var(--rich-foreground)'
      }}
    >
      <header style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
        <select
          aria-label='Document'
          onChange={(event) => {
            setKey(event.target.value);
            setContent(SAMPLES[event.target.value]!.content);
          }}
          value={key}
        >
          {Object.entries(SAMPLES).map(([id, { title }]) => (
            <option key={id} value={id}>
              {title}
            </option>
          ))}
        </select>
        {(['public', 'json', 'markdown'] as const).map((name) => (
          <button aria-pressed={pane === name} key={name} onClick={() => setPane(name)} type='button'>
            {name}
          </button>
        ))}
        <button onClick={() => setDark((value) => !value)} type='button'>
          {dark ? 'Light' : 'Dark'}
        </button>
      </header>
      <main style={{ display: 'grid', gap: 16, gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 28rem), 1fr))' }}>
        <RichTextEditor
          childDocuments={childDocuments}
          documentId={key}
          documents={Object.entries(SAMPLES).map(([id, { title }]) => ({ id, title }))}
          initialContent={sample.content}
          onContentChange={setContent}
          onSave={async ({ expectedVersion }) => ({ version: expectedVersion + 1 })}
          onUpload={upload}
          resolver={resolver}
          resources={[{ id: 'sample-file', title: 'bill-of-materials.csv' }]}
          tasks={[{ id: 't-1', title: 'Order the prototype' }]}
          version={1}
        />
        <section>
          {pane === 'public' ? (
            <>
              <RenderDocument
                childrenIndexRows={childDocuments}
                document={content}
                resolver={resolver}
              />
              {mermaid ? (
                <RichMermaidViewer source={(mermaid.content ?? []).map((node) => node.text).join('')} />
              ) : null}
            </>
          ) : (
            <pre style={{ overflow: 'auto', fontSize: 12 }}>
              {pane === 'json' ? JSON.stringify(content, null, 2) : serializeMarkdown(content)}
            </pre>
          )}
        </section>
      </main>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
