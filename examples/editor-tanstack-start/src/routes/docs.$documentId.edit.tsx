import type { RichTextEditorHandle } from '@formless63/editor-react';
import editorCss from '@formless63/editor-react/styles.css?url';
import { ClientOnly, createFileRoute, Link, useBlocker, useRouter } from '@tanstack/react-router';
import { lazy, Suspense, useRef, useState } from 'react';

import { readDocument, saveDocument } from '../documents.functions.ts';
import { resolver } from '../resolver.ts';

// Code-split: only this route downloads the editor, and only in the browser.
const RichTextEditor = lazy(() =>
  import('@formless63/editor-react').then((module) => ({ default: module.RichTextEditor }))
);

class VersionConflictError extends Error {
  readonly code = 'VERSION_CONFLICT';
}

export const Route = createFileRoute('/docs/$documentId/edit')({
  loader: ({ params }) => readDocument({ data: params.documentId }),
  head: () => ({ links: [{ rel: 'stylesheet', href: editorCss }] }),
  component: EditPage
});

function EditPage() {
  const { id, title, version, content } = Route.useLoaderData();
  const router = useRouter();
  const editor = useRef<RichTextEditorHandle>(null);
  const [unsaved, setUnsaved] = useState(false);
  const blocker = useBlocker({
    shouldBlockFn: () => unsaved,
    enableBeforeUnload: false, // the editor already warns on tab close
    withResolver: true
  });
  return (
    <main>
      <h1>{title}</h1>
      {blocker.status === 'blocked' ? (
        <p role='alert'>
          Unsaved changes.{' '}
          <button
            onClick={() => void editor.current?.save().then((saved) => saved && blocker.proceed())}
            type='button'
          >
            Save and leave
          </button>{' '}
          <button onClick={blocker.reset} type='button'>
            Stay
          </button>{' '}
          <button onClick={blocker.proceed} type='button'>
            Leave without saving
          </button>
        </p>
      ) : null}
      <ClientOnly fallback={<p>Loading editor…</p>}>
        <Suspense fallback={<p>Loading editor…</p>}>
          <RichTextEditor
            documentId={id}
            initialContent={JSON.parse(content) as unknown}
            onNavigate={(href) => void router.navigate({ href })}
            onSave={async (input) => {
              const result = await saveDocument({
                data: {
                  id,
                  expectedVersion: input.expectedVersion,
                  content: JSON.stringify(input.content)
                }
              });
              if ('conflict' in result) throw new VersionConflictError('Document changed');
              return result;
            }}
            onUnsavedChange={(state) => setUnsaved(state.hasUnsavedChanges)}
            ref={editor}
            resolver={resolver}
            version={version}
          />
        </Suspense>
      </ClientOnly>
      <Link params={{ documentId: id }} to='/docs/$documentId'>
        View
      </Link>
    </main>
  );
}
