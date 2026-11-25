import { getTableOfContents, RenderDocument } from '@formless63/editor-renderer';
import { createFileRoute, Link } from '@tanstack/react-router';

import { readDocument } from '../documents.functions.ts';
import { resolver } from '../resolver.ts';

/** The public page: server rendered, no editor, no Tiptap in this route's bundle. */
export const Route = createFileRoute('/docs/$documentId/')({
  loader: ({ params }) => readDocument({ data: params.documentId }),
  component: DocumentPage
});

function DocumentPage() {
  const { id, title, content } = Route.useLoaderData();
  const document = JSON.parse(content) as unknown;
  return (
    <main>
      <h1>{title}</h1>
      <nav aria-label='Contents'>
        {getTableOfContents(document).map((entry) => (
          <a href={`#${entry.id}`} key={entry.id}>
            {entry.text}
          </a>
        ))}
      </nav>
      <RenderDocument document={document} resolver={resolver} />
      <Link params={{ documentId: id }} to='/docs/$documentId/edit'>
        Edit
      </Link>
    </main>
  );
}
