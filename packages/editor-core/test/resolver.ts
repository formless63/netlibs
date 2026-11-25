import { type EditorResolver } from '../src/index.ts';

export const testResolver: EditorResolver = {
  documentHref: ({ documentId, anchor }) => `/docs/${documentId}${anchor ? `#${anchor}` : ''}`,
  parseDocumentHref: (href) => {
    const match = /^\/docs\/([^/#?]+)(?:#(.+))?$/.exec(href);
    return match ? { documentId: match[1]!, anchor: match[2] ?? null } : null;
  },
  resourceHref: (id, purpose) => `/media/${id}${purpose === 'download' ? '?download=1' : ''}`,
  taskHref: (id) => `/tasks/${id}`
};
