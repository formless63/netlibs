import { renderToStaticMarkup } from 'react-dom/server';

import { RenderDocument, type RenderDocumentProps } from './render-document.tsx';

/** Renders a document to an HTML string, for feeds, e-mail, search indexing or non-React hosts. */
export function renderDocumentToHtml(props: RenderDocumentProps): string {
  return renderToStaticMarkup(<RenderDocument {...props} />);
}
