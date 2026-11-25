import { RICH_STABLE_LINK_SCHEME, parseRichStableDocumentLink } from './stable-link.ts';
import type { EditorNode } from './types.ts';

export interface DocumentReferences {
  resourceIds: string[];
  documentIds: string[];
  taskIds: string[];
  /** True when the document contains a children index, so a loader knows to fetch child rows. */
  hasChildrenIndex: boolean;
}

/**
 * Every external id a document refers to, deduplicated in document order.
 * Use it to preload data for a synchronous `EditorResolver`, or to maintain
 * backlink and attachment-usage tables on save.
 */
export function collectDocumentReferences(doc: EditorNode): DocumentReferences {
  const resources = new Set<string>();
  const documents = new Set<string>();
  const tasks = new Set<string>();
  let hasChildrenIndex = false;

  const visit = (node: EditorNode): void => {
    const attrs = node.attrs ?? {};
    if (typeof attrs.resourceId === 'string' && attrs.resourceId) resources.add(attrs.resourceId);
    if (typeof attrs.taskId === 'string' && attrs.taskId) tasks.add(attrs.taskId);
    if (node.type === 'childrenIndex') hasChildrenIndex = true;
    for (const mark of node.marks ?? []) {
      if (mark.type !== 'link' || typeof mark.attrs?.href !== 'string') continue;
      const href = mark.attrs.href;
      if (!href.startsWith(RICH_STABLE_LINK_SCHEME)) continue;
      const target = parseRichStableDocumentLink(href);
      if (target) documents.add(target.documentId);
    }
    for (const child of node.content ?? []) visit(child);
  };
  visit(doc);
  return {
    resourceIds: [...resources],
    documentIds: [...documents],
    taskIds: [...tasks],
    hasChildrenIndex
  };
}
