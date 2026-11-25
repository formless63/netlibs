/**
 * Canonical link grammar shared by the schema, validator, importer and
 * renderers. Leaf module: it must not import `schema.ts` or `validation.ts`
 * (schema -> links -> validation -> schema would be a load-order cycle).
 */

export const RICH_STABLE_LINK_SCHEME = 'rich-doc:';
export const RICH_RESOURCE_SCHEME = 'rich-resource:';
export const RICH_TASK_SCHEME = 'rich-task:';

export interface DocumentLinkTarget {
  documentId: string;
  anchor: string | null;
}

export type RichStableDocumentLink = DocumentLinkTarget;

export const SAFE_ANCHOR_PATTERN = /^[A-Za-z][A-Za-z0-9_-]*$/;
const SAFE_DOCUMENT_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const SAFE_LINK_SCHEMES = new Set(['http:', 'https:', 'mailto:', RICH_STABLE_LINK_SCHEME]);

export function containsControlCharacter(value: string): boolean {
  return [...value].some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint <= 31 || codePoint === 127;
  });
}

/** Parses the canonical stable internal-link form `rich-doc:<id>[#anchor]`. */
export function parseRichStableDocumentLink(href: string): DocumentLinkTarget | null {
  if (!href.startsWith(RICH_STABLE_LINK_SCHEME)) return null;
  if (href.trim() !== href || containsControlCharacter(href)) return null;

  const target = href.slice(RICH_STABLE_LINK_SCHEME.length);
  const separator = target.indexOf('#');
  const documentId = separator === -1 ? target : target.slice(0, separator);
  const anchor = separator === -1 ? null : target.slice(separator + 1);
  if (!SAFE_DOCUMENT_ID_PATTERN.test(documentId)) return null;
  if (anchor !== null && !SAFE_ANCHOR_PATTERN.test(anchor)) return null;
  return { documentId, anchor };
}

export function formatRichStableDocumentLink(link: DocumentLinkTarget): string {
  return `${RICH_STABLE_LINK_SCHEME}${link.documentId}${link.anchor ? `#${link.anchor}` : ''}`;
}

/** The canonical, safe form of a link destination, or `null` when it is not allowed. */
export function canonicalizeRichHref(href: string): string | null {
  if (href.length === 0 || href.trim() !== href || containsControlCharacter(href)) return null;
  if (href.startsWith('#')) {
    const anchor = href.slice(1);
    return SAFE_ANCHOR_PATTERN.test(anchor) ? `#${anchor}` : null;
  }
  // Protocol-relative URLs would resolve to another origin.
  if (href.startsWith('//') || href.startsWith('/\\')) return null;
  if (href.startsWith('/')) {
    try {
      const parsed = new URL(href, 'https://document.invalid');
      if (parsed.origin !== 'https://document.invalid') return null;
      return `${parsed.pathname}${parsed.search}${parsed.hash}`;
    } catch {
      return null;
    }
  }
  if (href.startsWith(RICH_STABLE_LINK_SCHEME)) {
    const link = parseRichStableDocumentLink(href);
    return link ? formatRichStableDocumentLink(link) : null;
  }
  try {
    const parsed = new URL(href);
    return SAFE_LINK_SCHEMES.has(parsed.protocol) ? parsed.toString() : null;
  } catch {
    return null;
  }
}

export function isSafeRichLink(href: string): boolean {
  return canonicalizeRichHref(href) === href;
}

/** The full canonical attribute set for a link mark pointing at `href`. */
export function richLinkAttrsForHref(href: string): {
  href: string;
  targetDocumentId: string | null;
  targetAnchor: string | null;
} {
  const stable = parseRichStableDocumentLink(href);
  return {
    href,
    targetDocumentId: stable?.documentId ?? null,
    targetAnchor: stable?.anchor ?? null
  };
}
