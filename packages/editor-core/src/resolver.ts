import type { DocumentLinkTarget } from './stable-link.ts';

export type ResourceUrlPurpose = 'content' | 'download' | 'preview';

/**
 * The single seam between stored documents and a host application.
 *
 * Documents store stable ids (`rich-doc:<id>`, `rich-resource:<id>`,
 * `rich-task:<id>`) and never URLs. A host supplies this object to turn an
 * id into a URL at presentation time. Every method is synchronous: preload
 * whatever is needed with `collectDocumentReferences` first (that is what an
 * SSR loader does).
 *
 * Returning `null` means "not available to this viewer": renderers fall back
 * to plain text/alt text and the editor keeps the canonical reference.
 */
export interface EditorResolver {
  documentHref(target: DocumentLinkTarget): string | null;
  /** Inverse of `documentHref`, so a pasted app URL becomes a stable link again. */
  parseDocumentHref?(href: string): DocumentLinkTarget | null;
  resourceHref(resourceId: string, purpose: ResourceUrlPurpose): string | null;
  taskHref?(taskId: string): string | null;
  /** Human label for a non-file resource kind (chips and reference cards). */
  resourceKindLabel?(kind: string): string | null;
}

/** Resolves nothing. Used by the validator and whenever a host passes no resolver. */
export const nullResolver: EditorResolver = {
  documentHref: () => null,
  resourceHref: () => null
};

/** Label for a reference kind, or `null` when the kind has no dedicated label. */
export function resourceKindLabel(kind: unknown, resolver?: EditorResolver): string | null {
  if (typeof kind !== 'string' || kind === 'file') return null;
  const label = resolver?.resourceKindLabel?.(kind);
  if (label) return label;
  const name = /^app_([a-z]+)$/.exec(kind)?.[1];
  return name ? name[0]!.toUpperCase() + name.slice(1) : null;
}

/** Kinds that read as inline citations and insert as a chip rather than a card. */
export function isInlineReferenceKind(kind: string): boolean {
  return kind.startsWith('app_');
}
