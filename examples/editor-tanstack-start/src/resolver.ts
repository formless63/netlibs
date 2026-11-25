import type { EditorResolver } from '@formless63/editor-core/model';

/** Shared by the server render and the browser editor, so both produce the same URLs. */
export const resolver: EditorResolver = {
  documentHref: ({ documentId, anchor }) =>
    `/docs/${encodeURIComponent(documentId)}${anchor ? `#${anchor}` : ''}`,
  parseDocumentHref: (href) => {
    const match = /^\/docs\/([^/?#]+)(?:#([\w-]+))?$/.exec(href);
    return match ? { documentId: decodeURIComponent(match[1]!), anchor: match[2] ?? null } : null;
  },
  resourceHref: (id, purpose) =>
    `/media/${encodeURIComponent(id)}${purpose === 'download' ? '?download=1' : ''}`
};
