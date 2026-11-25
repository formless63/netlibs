import { Mark, mergeAttributes, Node, type Extensions } from '@tiptap/core';
import { CodeBlockLowlight } from '@tiptap/extension-code-block-lowlight';
import { Details, DetailsContent, DetailsSummary } from '@tiptap/extension-details';
import { Heading } from '@tiptap/extension-heading';
import { Image, type ImageOptions } from '@tiptap/extension-image';
import { InvisibleCharacters } from '@tiptap/extension-invisible-characters';
import { Link, type LinkOptions } from '@tiptap/extension-link';
import { OrderedList } from '@tiptap/extension-list';
import { BlockMath, InlineMath } from '@tiptap/extension-mathematics';
import { Placeholder } from '@tiptap/extension-placeholder';
import { Table } from '@tiptap/extension-table';
import { TableCell } from '@tiptap/extension-table-cell';
import { TableHeader } from '@tiptap/extension-table-header';
import { TableRow } from '@tiptap/extension-table-row';
import { TaskItem } from '@tiptap/extension-task-item';
import { TaskList } from '@tiptap/extension-task-list';
import { Subscript } from '@tiptap/extension-subscript';
import { Superscript } from '@tiptap/extension-superscript';
import { StarterKit } from '@tiptap/starter-kit';

import { type RichViewerKind } from './viewer-kind.ts';

import {
  CHILDREN_INDEX_EMPTY_LABEL,
  CHILDREN_INDEX_PLACEHOLDER_BODY,
  CHILDREN_INDEX_PLACEHOLDER_HEADING
} from './children-index-format.ts';
import {
  DEFAULT_CHILDREN_INDEX_SORT,
  nextChildrenIndexSort,
  sortChildrenIndexRows,
  type ChildrenIndexSortState
} from './children-index-sort.ts';
import { nullResolver, resourceKindLabel, type EditorResolver } from './resolver.ts';
import {
  canonicalizeRichHref,
  RICH_RESOURCE_SCHEME,
  RICH_TASK_SCHEME,
  richLinkAttrsForHref,
  formatRichStableDocumentLink,
  parseRichStableDocumentLink,
  SAFE_ANCHOR_PATTERN
} from './stable-link.ts';

import { RichBlockIdentity } from './block-identity.ts';
import {
  buildChildrenIndexHeaderElement,
  buildChildrenIndexListElement
} from './children-index-dom.ts';
import { RICH_CODE_BLOCK_DEFAULT_LANGUAGE } from './code-languages.ts';
import { createRichLowlight } from './lowlight.ts';
import { RichBlockDragHandle } from './drag-handle.ts';
import { RichLinkClick } from './link-click.ts';
import { RICH_LINK_REL, RichLinkNormalizer } from './link-normalize.ts';
import {
  formatRichFileSize,
  richFileDownloadName,
  richFileExtensionLabel,
  richResourceChipKindLabel
} from './file-card.ts';
import { replaceRichImageWithFallback } from './image-fallback.ts';
import {
  buildRichOpenAffordance,
  RichOpenAffordance,
  type RichOpenAffordanceOptions
} from './open-affordance.ts';
import { richResourceCardViewerKey } from './resource-preview.ts';
import { RichTableGrips } from './table-grips.ts';
import {
  isRichCustomEmojiName,
  RICH_CALLOUT_COLORS,
  RICH_CALLOUT_KINDS,
  RICH_IMAGE_ALIGNMENTS,
  RICH_IMAGE_WIDTH_MAX,
  RICH_IMAGE_WIDTH_MIN,
  RICH_PREVIEW_HEIGHT_MAX,
  RICH_PREVIEW_HEIGHT_MIN,
  RICH_TABLE_COLWIDTH_MAX,
  RICH_TABLE_COLWIDTH_MIN,
  richCustomEmojiNameFromSrc,
  type RichCalloutColor,
  type RichCalloutKind,
  type RichChildrenIndexNodeRow
} from './types.ts';

/** Option carried by every node whose DOM needs a host URL. */
export interface ResolverOption {
  resolver: EditorResolver;
}

/** A resource id from rendered or pasted markup. */
function resourceIdFromElement(element: Element): string | null {
  const src = element.getAttribute('src') ?? '';
  return src.startsWith(RICH_RESOURCE_SCHEME)
    ? src.slice(RICH_RESOURCE_SCHEME.length)
    : element.getAttribute('data-resource-id');
}

/** The URL to put in the DOM, falling back to the canonical (inert) reference. */
function resourceDomHref(
  resolver: EditorResolver,
  resourceId: string,
  purpose: 'content' | 'download'
): string {
  return resolver.resourceHref(resourceId, purpose) ?? `${RICH_RESOURCE_SCHEME}${resourceId}`;
}

/**
 * Clamps a pixel integer to `[min, max]`, or null when it is not a finite positive number. Used
 * when parsing pasted widths.
 */
function clampDimension(value: unknown, min: number, max: number): number | null {
  const numeric = typeof value === 'number' ? value : Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(numeric) || numeric <= 0) return null;
  return Math.min(max, Math.max(min, Math.round(numeric)));
}

/**
 * Sanitize a parsed `colwidth` array into a bounded positive-integer array, or
 * null. A single unusable entry collapses the whole array to null — a
 * partially-trusted width vector is worse than none (the table just falls back
 * to equal columns).
 */
function sanitizeRichColwidth(raw: unknown): number[] | null {
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const sanitized: number[] = [];
  for (const entry of raw) {
    const clamped = clampDimension(entry, RICH_TABLE_COLWIDTH_MIN, RICH_TABLE_COLWIDTH_MAX);
    if (clamped === null) return null;
    sanitized.push(clamped);
  }
  return sanitized;
}

const CALLOUT_LABELS: Record<RichCalloutKind, string> = {
  note: 'Note',
  tip: 'Tip',
  important: 'Important',
  warning: 'Warning',
  caution: 'Caution'
};

const CALLOUT_ICONS: Record<RichCalloutKind, string> = {
  note: 'i',
  tip: '◆',
  important: '!',
  warning: '▲',
  caution: '■'
};

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    richCallout: {
      setRichCallout: (
        kind: RichCalloutKind,
        title?: string | null,
        color?: RichCalloutColor | null
      ) => ReturnType;
      setRichCalloutColor: (color: RichCalloutColor | null) => ReturnType;
      unsetRichCallout: () => ReturnType;
    };
  }
}

export const RichHeading = Heading.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      anchorId: {
        default: null,
        // A pasted page's ids may not fit the anchor grammar; drop those.
        parseHTML: (element) => {
          const id = element.getAttribute('id');
          return id && SAFE_ANCHOR_PATTERN.test(id) ? id : null;
        },
        renderHTML: (attributes) => (attributes.anchorId ? { id: attributes.anchorId } : {})
      }
    };
  }
});

/** A callout has a `kind`, an optional title, and ordinary block content. */
export const RichCallout = Node.create({
  name: 'callout',
  group: 'block',
  content: 'block+',
  defining: true,

  addAttributes() {
    return {
      kind: {
        default: 'note',
        parseHTML: (element) => element.getAttribute('data-callout-kind') ?? 'note',
        renderHTML: (attributes) => ({ 'data-callout-kind': attributes.kind })
      },
      title: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-callout-title'),
        renderHTML: (attributes) =>
          typeof attributes.title === 'string' && attributes.title.length > 0
            ? { 'data-callout-title': attributes.title }
            : {}
      },
      // Optional palette override. null/absent keeps the
      // kind-derived color; a named color from RICH_CALLOUT_COLORS overrides
      // just the palette. Foreign/unknown values sanitize to null on parse.
      color: {
        default: null,
        parseHTML: (element) => {
          const value = element.getAttribute('data-callout-color');
          return value && (RICH_CALLOUT_COLORS as readonly string[]).includes(value)
            ? value
            : null;
        },
        renderHTML: (attributes) =>
          typeof attributes.color === 'string' &&
          (RICH_CALLOUT_COLORS as readonly string[]).includes(attributes.color)
            ? { 'data-callout-color': attributes.color }
            : {}
      }
    };
  },

  parseHTML() {
    return [{ tag: 'aside[data-callout-kind]' }];
  },

  renderHTML({ node, HTMLAttributes }) {
    const rawKind = node.attrs.kind;
    const kind = (RICH_CALLOUT_KINDS as readonly string[]).includes(rawKind)
      ? (rawKind as RichCalloutKind)
      : 'note';
    const color =
      typeof node.attrs.color === 'string' &&
      (RICH_CALLOUT_COLORS as readonly string[]).includes(node.attrs.color)
        ? node.attrs.color
        : null;
    const title = typeof node.attrs.title === 'string' ? node.attrs.title.trim() : '';
    const accessibleLabel = title ? `${CALLOUT_LABELS[kind]}: ${title}` : CALLOUT_LABELS[kind];

    return [
      'aside',
      mergeAttributes(HTMLAttributes, {
        class: 'rich-callout',
        role: 'note',
        'aria-label': accessibleLabel,
        'data-callout-kind': kind,
        ...(color ? { 'data-callout-color': color } : {})
      }),
      [
        'div',
        { class: 'rich-callout__label', contenteditable: 'false' },
        ['span', { class: 'rich-callout__icon', 'aria-hidden': 'true' }, CALLOUT_ICONS[kind]],
        ['span', { class: 'rich-callout__label-text' }, accessibleLabel]
      ],
      ['div', { class: 'rich-callout__body' }, 0]
    ];
  },

  addCommands() {
    return {
      setRichCallout:
        (kind, title = null, color = null) =>
        ({ commands }) =>
          commands.wrapIn(this.name, { kind, title, color }),
      setRichCalloutColor:
        (color) =>
        ({ commands }) =>
          commands.updateAttributes(this.name, { color }),
      unsetRichCallout:
        () =>
        ({ commands }) =>
          commands.lift(this.name)
    };
  }
});

/** Resolves one rendered/pasted anchor back to its canonical stored href. */
function canonicalHrefFromAnchor(element: Element, resolver: EditorResolver): string | null {
  const documentId = element.getAttribute('data-document-id');
  if (documentId) {
    const href = formatRichStableDocumentLink({
      documentId,
      anchor: element.getAttribute('data-document-anchor')
    });
    if (parseRichStableDocumentLink(href)) return href;
  }
  const raw = element.getAttribute('href') ?? '';
  const target = resolver.parseDocumentHref?.(raw);
  if (target) return formatRichStableDocumentLink(target);
  return canonicalizeRichHref(raw);
}

export const RichLink = Link.extend<LinkOptions & ResolverOption>({
  addOptions() {
    return { ...(this.parent?.() as LinkOptions), resolver: nullResolver };
  },

  addAttributes() {
    const { resolver } = this.options;
    return {
      ...this.parent?.(),
      // Stored form stays `rich-doc:<id>#anchor`; only the rendered DOM
      // points at the host's route. ProseMirror keeps attrs, not the DOM, as
      // the source of truth, and parseHTML maps a pasted route URL back.
      href: {
        default: null,
        parseHTML: (element) => canonicalHrefFromAnchor(element, resolver),
        renderHTML: (attributes) => {
          if (typeof attributes.href !== 'string') return {};
          const target = parseRichStableDocumentLink(attributes.href);
          return { href: (target && resolver.documentHref(target)) ?? attributes.href };
        }
      },
      // Link styling and rel are presentation; a pasted anchor's own values
      // are never persisted.
      target: {
        default: '_blank',
        parseHTML: (element) => (element.getAttribute('target') === '_blank' ? '_blank' : null)
      },
      rel: { default: RICH_LINK_REL, parseHTML: () => RICH_LINK_REL },
      class: { default: null, parseHTML: () => null },
      targetDocumentId: {
        default: null,
        parseHTML: (element) =>
          richLinkAttrsForHref(canonicalHrefFromAnchor(element, resolver) ?? '').targetDocumentId,
        renderHTML: (attributes) =>
          attributes.targetDocumentId ? { 'data-document-id': attributes.targetDocumentId } : {}
      },
      targetAnchor: {
        default: null,
        parseHTML: (element) =>
          richLinkAttrsForHref(canonicalHrefFromAnchor(element, resolver) ?? '').targetAnchor,
        renderHTML: (attributes) =>
          attributes.targetAnchor ? { 'data-document-anchor': attributes.targetAnchor } : {}
      },
      title: {
        default: null,
        parseHTML: (element) => element.getAttribute('title'),
        renderHTML: (attributes) => (attributes.title ? { title: attributes.title } : {})
      }
    };
  },

  parseHTML() {
    const { resolver } = this.options;
    return [
      {
        tag: 'a[href]',
        getAttrs: (element) => (canonicalHrefFromAnchor(element, resolver) ? null : false)
      }
    ];
  }
});

/** `start` is clamped and alternate marker styles (`<ol type="a">`) are not persisted. */
export const RichOrderedList = OrderedList.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      start: {
        default: 1,
        parseHTML: (element) => {
          const start = Number.parseInt(element.getAttribute('start') ?? '', 10);
          return Number.isInteger(start) && start > 0 ? start : 1;
        }
      },
      type: { default: null, parseHTML: () => null }
    };
  }
});

// Superscript and subscript exclude each other; the published extensions do not declare it.
export const RichSuperscript = Superscript.extend({ excludes: 'subscript' });
export const RichSubscript = Subscript.extend({ excludes: 'superscript' });

/** Sanitize a raw align value to a canonical alignment or null. */
function sanitizeRichImageAlign(value: unknown): string | null {
  return typeof value === 'string' &&
    (RICH_IMAGE_ALIGNMENTS as readonly string[]).includes(value)
    ? value
    : null;
}

export const RichImage = Image.extend<ImageOptions & ResolverOption>({
  addOptions() {
    return { ...(this.parent?.() as ImageOptions), resolver: nullResolver };
  },

  // Only images that already map to a stored resource become image nodes. A
  // foreign `<img>` has no resource id, so it could never validate or save;
  // it is dropped on paste instead (its surrounding text is kept).
  parseHTML() {
    return [
      { tag: 'img[data-resource-id]' },
      { tag: 'img[src^="rich-resource:"]' }
    ];
  },

  addAttributes() {
    return {
      ...this.parent?.(),
      // Round-trip guard: the base Image extension's default `src` parseHTML
      // reads whatever is literally in the DOM's `src` attribute. Rendered
      // `src` is the resolvable content route (see the node-level
      // `renderHTML` below), NOT the canonical `rich-resource:<id>` form
      // `editor/validation.ts` requires (`attrs.src` must equal
      // `rich-resource:${resourceId}` or be null/absent). A same-editor
      // copy/paste serializes to HTML and reparses it on drop, so without
      // this override a paste would silently poison `attrs.src` with the
      // content-route URL and fail canonical validation on the next save.
      // Always re-derive from `data-resource-id` instead, exactly like
      // `resourceId` below — never trust `src` itself.
      src: {
        default: null,
        parseHTML: (element) => {
          const resourceId = resourceIdFromElement(element);
          return resourceId ? `${RICH_RESOURCE_SCHEME}${resourceId}` : null;
        },
        renderHTML: () => ({})
      },
      resourceId: {
        default: null,
        parseHTML: (element) => resourceIdFromElement(element),
        renderHTML: (attributes) => ({ 'data-resource-id': attributes.resourceId })
      },
      description: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-description'),
        renderHTML: (attributes) =>
          attributes.description ? { 'data-description': attributes.description } : {}
      },
      // Display width in px; null is the intrinsic size. Foreign values are sanitized on parse.
      width: {
        default: null,
        parseHTML: (element) =>
          clampDimension(
            element.getAttribute('width') ?? element.getAttribute('data-width'),
            RICH_IMAGE_WIDTH_MIN,
            RICH_IMAGE_WIDTH_MAX
          ),
        renderHTML: (attributes) =>
          typeof attributes.width === 'number' ? { width: String(attributes.width) } : {}
      },
      // Alignment; null is the default placement. Foreign values become null on parse.
      align: {
        default: null,
        parseHTML: (element) => sanitizeRichImageAlign(element.getAttribute('data-align')),
        renderHTML: (attributes) => {
          const align = sanitizeRichImageAlign(attributes.align);
          return align ? { 'data-align': align } : {};
        }
      }
    };
  },

  renderHTML({ node, HTMLAttributes }) {
    const resourceId = String(node.attrs.resourceId ?? '');
    const width = typeof node.attrs.width === 'number' ? node.attrs.width : null;
    const align = sanitizeRichImageAlign(node.attrs.align);
    return [
      'img',
      mergeAttributes(HTMLAttributes, {
        // The resolvable render-time URL — see `richResourceContentHref`'s
        // doc comment. Canonical storage stays `rich-resource:<id>` on the
        // node's `resourceId`/`src` attrs; only the DOM src changes here,
        // same presentation-boundary split as `RichLink`'s href.
        src: resourceDomHref(this.options.resolver, resourceId, 'content'),
        'data-resource-id': resourceId,
        ...(width ? { width: String(width) } : {}),
        ...(align ? { 'data-align': align } : {})
      })
    ];
  },

  // A plain DOM node view, so a failed image can show its alt text without a document edit.
  // `ignoreMutation` keeps ProseMirror out of the wrapper's contents.
  addNodeView() {
    const { resolver } = this.options;
    return ({ editor, node: initialNode, getPos }) => {
      const wrapper = document.createElement('div');
      wrapper.className = 'rich-image-view';

      // Corner drag-resize: both bottom corners while selected, width only (height follows the
      // ratio), with a live readout. The clamped width is committed on release.
      const startResize = (
        event: PointerEvent,
        img: HTMLImageElement,
        readout: HTMLElement,
        currentNode: typeof initialNode,
        direction: 'left' | 'right'
      ): void => {
        event.preventDefault();
        event.stopPropagation();
        const startX = event.clientX;
        const startWidth = img.getBoundingClientRect().width;
        wrapper.classList.add('rich-image-view--resizing');
        readout.textContent = `${Math.round(startWidth)} px`;
        const onMove = (moveEvent: PointerEvent): void => {
          const delta = moveEvent.clientX - startX;
          const next = clampDimension(
            startWidth + (direction === 'right' ? delta : -delta),
            RICH_IMAGE_WIDTH_MIN,
            RICH_IMAGE_WIDTH_MAX
          );
          if (next) {
            img.style.width = `${next}px`;
            readout.textContent = `${next} px`;
          }
        };
        const onUp = (): void => {
          window.removeEventListener('pointermove', onMove);
          window.removeEventListener('pointerup', onUp);
          wrapper.classList.remove('rich-image-view--resizing');
          const committed = clampDimension(
            img.getBoundingClientRect().width,
            RICH_IMAGE_WIDTH_MIN,
            RICH_IMAGE_WIDTH_MAX
          );
          if (typeof getPos === 'function' && committed !== currentNode.attrs.width) {
            editor
              .chain()
              .command(({ tr }) => {
                const pos = getPos();
                if (typeof pos !== 'number') return false;
                tr.setNodeAttribute(pos, 'width', committed);
                return true;
              })
              .run();
          }
        };
        window.addEventListener('pointermove', onMove);
        window.addEventListener('pointerup', onUp);
      };

      const applyNode = (currentNode: typeof initialNode): void => {
        wrapper.replaceChildren();
        const align = sanitizeRichImageAlign(currentNode.attrs.align);
        if (align) wrapper.setAttribute('data-align', align);
        else wrapper.removeAttribute('data-align');

        // Inner frame so the resize handles/readout/caption anchor to the
        // IMAGE's box, not the full-width wrapper (the wrapper spans the
        // content column so `text-align` can drive the alignment attr).
        // Structure: frame (inline-block, shrink-
        // wraps the image) > box (position:relative — anchors the resize
        // chrome to the image alone, NOT image+caption) > img, then the
        // caption as the frame's second child so it is exactly as wide as
        // the image and centers under it regardless of alignment.
        const frame = document.createElement('span');
        frame.className = 'rich-image-frame';
        const box = document.createElement('span');
        box.className = 'rich-image-box';

        const resourceId = String(currentNode.attrs.resourceId ?? '');
        const img = document.createElement('img');
        const contentHref = resolver.resourceHref(resourceId, 'content');
        if (contentHref) img.src = contentHref;
        img.setAttribute('data-resource-id', resourceId);
        img.alt = typeof currentNode.attrs.alt === 'string' ? currentNode.attrs.alt : '';
        if (typeof currentNode.attrs.title === 'string' && currentNode.attrs.title) {
          img.title = currentNode.attrs.title;
        }
        const width = typeof currentNode.attrs.width === 'number' ? currentNode.attrs.width : null;
        img.style.width = width ? `${width}px` : '';
        img.style.maxWidth = '100%';
        img.style.height = 'auto';
        img.addEventListener('error', () => replaceRichImageWithFallback(img), { once: true });
        box.appendChild(img);
        if (!contentHref) {
          // Unavailable to this viewer: show the alt text, same as a failed load.
          queueMicrotask(() => replaceRichImageWithFallback(img));
        }

        if (editor.isEditable) {
          const readout = document.createElement('span');
          readout.className = 'rich-image-resize-readout';
          readout.setAttribute('aria-hidden', 'true');
          for (const direction of ['left', 'right'] as const) {
            const handle = document.createElement('span');
            handle.className = `rich-image-resize-handle rich-image-resize-handle--${direction}`;
            handle.setAttribute('aria-hidden', 'true');
            handle.addEventListener('pointerdown', (event) =>
              startResize(event, img, readout, currentNode, direction)
            );
            box.appendChild(handle);
          }
          box.appendChild(readout);
        }

        frame.appendChild(box);

        // Caption (the canonical `description` attr — the same text the read
        // view renders as `<figcaption>`). Shown in the editor too so an
        // authored caption is visible while editing; edited via the
        // image-specific bubble menu, never contenteditable here. Inside the
        // frame — under the image, centered — never a full-column line.
        const description =
          typeof currentNode.attrs.description === 'string' ? currentNode.attrs.description : '';
        if (description) {
          const caption = document.createElement('span');
          caption.className = 'rich-image-caption';
          caption.textContent = description;
          frame.appendChild(caption);
        }

        wrapper.appendChild(frame);
      };

      applyNode(initialNode);

      return {
        dom: wrapper,
        update(updatedNode) {
          if (updatedNode.type.name !== 'image') return false;
          applyNode(updatedNode);
          return true;
        },
        ignoreMutation: () => true
      };
    };
  }
});

/**
 * A custom emoji with no Unicode form: an inline atom with one `name` from
 * `RICH_CUSTOM_EMOJI_NAMES`, shown as a shortcode chip. Unicode emojis are plain text. It holds no
 * marks, and round-trips through Markdown as `:name:`.
 */
export const RichCustomEmoji = Node.create({
  name: 'customEmoji',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  marks: '',

  addAttributes() {
    return {
      name: {
        default: null,
        parseHTML: (element) => {
          const value =
            element.getAttribute('data-rich-custom-emoji');
          return isRichCustomEmojiName(value) ? value : null;
        },
        renderHTML: () => ({})
      }
    };
  },

  parseHTML() {
    // Higher priority than the base Image extension's `img[src]` rule so a
    // same-editor copy/paste of this atom can never reparse as an `image`
    // block node.
    return [
      { tag: 'span[data-rich-custom-emoji]', priority: 100 },
      { tag: 'img[data-rich-custom-emoji]', priority: 100 },
      // Recovery rule: clipboard intermediaries —
      // Chrome's right-click "Copy image" chief among them — rebuild the tag
      // as a bare `<img src="…/rich-emoji/<name>.png">`, dropping the
      // data marker above. Without this rule such a paste fell through to
      // the base Image `img[src]` rule and landed as a block-height `image`
      // node with a drag handle. Recover the inline atom from the asset
      // path itself; unknown names return false and fall through unchanged.
      {
        tag: 'img[src]',
        priority: 100,
        getAttrs: (element) => {
          const name = richCustomEmojiNameFromSrc(element.getAttribute('src'));
          return name ? { name } : false;
        }
      }
    ];
  },

  renderHTML({ node, HTMLAttributes }) {
    const name = node.attrs.name;
    const known = isRichCustomEmojiName(name);
    return [
      'span',
      mergeAttributes(HTMLAttributes, {
        class: 'rich-custom-emoji',
        'data-rich-custom-emoji': known ? name : '',
        role: 'img',
        'aria-label': known ? `:${name}:` : ':unknown-emoji:'
      }),
      known ? `:${name}:` : ':unknown-emoji:'
    ];
  }
});

export const RichTaskItem = TaskItem.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      authority: {
        default: 'document_local',
        parseHTML: () => 'document_local',
        renderHTML: () => ({ 'data-task-authority': 'document_local' })
      }
    };
  }
});

// Merged cells and cell alignment have no lossless Markdown form, so `colspan`, `rowspan` and
// `align` are forced to defaults on parse. `colwidth` is kept, sanitized to bounded integers, so a
// spreadsheet paste can never produce an unsaveable table.
const STAGE1_TABLE_CELL_ATTRS = {
  colspan: { default: 1, parseHTML: () => 1 },
  rowspan: { default: 1, parseHTML: () => 1 },
  colwidth: {
    default: null,
    parseHTML: (element: HTMLElement) => {
      const raw = element.getAttribute('colwidth') ?? element.getAttribute('data-colwidth');
      if (!raw) return null;
      return sanitizeRichColwidth(raw.split(',').map((value) => Number.parseInt(value, 10)));
    },
    renderHTML: (attributes: { colwidth?: unknown }) =>
      Array.isArray(attributes.colwidth) && attributes.colwidth.length > 0
        ? { colwidth: attributes.colwidth.join(',') }
        : {}
  },
  align: { default: null, parseHTML: () => null }
};

// Comment mark: a pointer to a host-owned thread.
export const RichCommentMark = Mark.create({
  name: 'comment',
  inclusive: false,
  excludes: '',

  addAttributes() {
    return {
      commentId: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-comment-id'),
        renderHTML: (attributes) =>
          attributes.commentId ? { 'data-comment-id': attributes.commentId } : {}
      }
    };
  },

  parseHTML() {
    return [{ tag: 'span[data-comment-id]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['span', mergeAttributes(HTMLAttributes, { class: 'rich-comment-anchor' }), 0];
  }
});

/**
 * Builds the `/tree` card with DOM APIs, so titles are always inert text.
 *
 * `onNavigate` handles link clicks in the host's router. `mousedown` stops propagation so following
 * a link does not select the block.
 */
function buildRichChildrenIndexDom(
  rows: readonly RichChildrenIndexNodeRow[] | null,
  onNavigate: ((href: string) => void) | undefined
): HTMLElement {
  const wrapper = document.createElement('div');
  wrapper.setAttribute('data-rich-children-index', '');
  wrapper.setAttribute('contenteditable', 'false');

  if (rows === null) {
    wrapper.className = 'rich-children-index';
    const heading = document.createElement('strong');
    heading.textContent = CHILDREN_INDEX_PLACEHOLDER_HEADING;
    wrapper.appendChild(heading);
    const preview = document.createElement('span');
    preview.textContent = CHILDREN_INDEX_PLACEHOLDER_BODY;
    wrapper.appendChild(preview);
    return wrapper;
  }

  wrapper.className = 'rich-children-index rich-children-index--resolved';

  if (rows.length === 0) {
    const empty = document.createElement('span');
    empty.className = 'rich-children-index__empty';
    empty.textContent = CHILDREN_INDEX_EMPTY_LABEL;
    wrapper.appendChild(empty);
    return wrapper;
  }

  // The sort order is local to this node view and resets on remount.
  let sort: ChildrenIndexSortState = DEFAULT_CHILDREN_INDEX_SORT;

  function render() {
    wrapper.replaceChildren(
      buildChildrenIndexHeaderElement(sort, (key) => {
        sort = nextChildrenIndexSort(sort, key);
        render();
      }),
      buildChildrenIndexListElement(sortChildrenIndexRows(rows!, sort), onNavigate)
    );
  }

  render();
  return wrapper;
}

// The `/tree` marker. It stores only itself; the host supplies the rows at render time.
export const RichChildrenIndex = Node.create<{
  /**
   * Child rows for this document, resolved once by the host. `null` shows a placeholder. They are
   * static for the editing session.
   */
  rows: readonly RichChildrenIndexNodeRow[] | null;
  /** See `buildRichChildrenIndexDom`'s doc comment. */
  onNavigate: ((href: string) => void) | undefined;
}>({
  name: 'childrenIndex',
  group: 'block',
  atom: true,
  selectable: true,

  addOptions() {
    return { rows: null, onNavigate: undefined };
  },

  addAttributes() {
    return {};
  },

  parseHTML() {
    return [{ tag: 'div[data-rich-children-index]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'div',
      mergeAttributes(HTMLAttributes, {
        class: 'rich-children-index',
        'data-rich-children-index': '',
        contenteditable: 'false'
      }),
      ['strong', {}, CHILDREN_INDEX_PLACEHOLDER_HEADING],
      ['span', {}, CHILDREN_INDEX_PLACEHOLDER_BODY]
    ];
  },

  // A plain DOM node view of the rows resolved when the editor loaded.
  addNodeView() {
    return () => ({
      dom: buildRichChildrenIndexDom(this.options.rows, this.options.onNavigate)
    });
  }
});

export const RichTableCell = TableCell.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      ...STAGE1_TABLE_CELL_ATTRS
    };
  }
});

export const RichTableHeader = TableHeader.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      ...STAGE1_TABLE_CELL_ATTRS
    };
  }
});

/** See `RichResourceCard`'s options doc comment below. */
export type RichResourceFileMetaFetcher = (
  resourceId: string
) => Promise<{ sizeBytes: number | null } | null>;

/**
 * Mounts a viewer into a preview frame and returns a cleanup. Passed in so this module needs no
 * React.
 */
export type RichFilePreviewMounter = (
  slot: HTMLElement,
  props: {
    src: string;
    title: string;
    sizeBytes: number | null;
    viewerKey: RichViewerKind;
  }
) => () => void;

/** Sanitize a raw resourceCard presentation value to the canonical pair. */
function sanitizeRichResourceCardPresentation(value: unknown): 'card' | 'preview' {
  return value === 'preview' ? 'preview' : 'card';
}

/**
 * A file-card button whose pointer gesture never reaches ProseMirror. `action` is the CSS hook for
 * icon-only rendering on narrow screens; `title` and `aria-label` carry the name.
 */
function buildRichFileCardActionButton(
  label: string,
  action: string,
  onClick: () => void
): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'rich-file-card__download';
  button.dataset.action = action;
  button.title = label;
  button.setAttribute('aria-label', label);
  button.textContent = label;
  button.addEventListener('mousedown', (event) => event.stopPropagation());
  button.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    onClick();
  });
  return button;
}

export const RichResourceCard = Node.create<{
  /**
   * Optional async size lookup for kind='file' cards —
   * the live editor threads `getRichResourceCardRenderMetaAction`
   * through `createEditorExtensions({ fetchResourceFileMeta })`
   * (same option-threading pattern as `RichChildrenIndex`'s `rows`),
   * because this shared module must never import the data service
   * directly (it is also loaded by `editor/validation.ts`'s server-side
   * `getSchema()` and by vitest). `undefined` (validator, preview, tests)
   * simply renders the card without a size line — size is best-effort
   * chrome, never canonical content.
   */
  fetchResourceFileMeta: RichResourceFileMetaFetcher | undefined;
  /**
   * Mounts viewers for preview cards. Without it the frame is drawn with an empty slot; the
   * document is the same either way.
   */
  mountFilePreview: RichFilePreviewMounter | undefined;
  resolver: EditorResolver;
}>({
  name: 'resourceCard',
  group: 'block',
  atom: true,
  selectable: true,

  addOptions() {
    return {
      fetchResourceFileMeta: undefined,
      mountFilePreview: undefined,
      resolver: nullResolver
    };
  },

  addAttributes() {
    return {
      resourceId: { default: null },
      title: { default: null },
      description: { default: null },
      kind: { default: 'file' },
      selector: { default: 'latest-approved' },
      // Presentation attrs, sanitized on parse.
      width: {
        default: null,
        parseHTML: (element) =>
          clampDimension(
            element.getAttribute('data-width'),
            RICH_IMAGE_WIDTH_MIN,
            RICH_IMAGE_WIDTH_MAX
          ),
        renderHTML: (attributes) =>
          typeof attributes.width === 'number' ? { 'data-width': String(attributes.width) } : {}
      },
      // Pinned preview height in px; null derives it from the viewer's aspect ratio.
      height: {
        default: null,
        parseHTML: (element) =>
          clampDimension(
            element.getAttribute('data-height'),
            RICH_PREVIEW_HEIGHT_MIN,
            RICH_PREVIEW_HEIGHT_MAX
          ),
        renderHTML: (attributes) =>
          typeof attributes.height === 'number' ? { 'data-height': String(attributes.height) } : {}
      },
      align: {
        default: null,
        parseHTML: (element) => sanitizeRichImageAlign(element.getAttribute('data-align')),
        renderHTML: (attributes) => {
          const align = sanitizeRichImageAlign(attributes.align);
          return align ? { 'data-align': align } : {};
        }
      },
      caption: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-caption'),
        renderHTML: (attributes) =>
          typeof attributes.caption === 'string' && attributes.caption.length > 0
            ? { 'data-caption': attributes.caption }
            : {}
      },
      presentation: {
        default: 'card',
        parseHTML: (element) =>
          sanitizeRichResourceCardPresentation(element.getAttribute('data-presentation')),
        renderHTML: (attributes) =>
          attributes.presentation === 'preview' ? { 'data-presentation': 'preview' } : {}
      }
    };
  },

  parseHTML() {
    return [{ tag: '[data-rich-resource-card]' }];
  },

  renderHTML({ node, HTMLAttributes }) {
    const resourceId = String(node.attrs.resourceId ?? '');
    const title = String(node.attrs.title ?? 'Untitled resource');
    const description = typeof node.attrs.description === 'string' ? node.attrs.description : '';
    // kind='file' renders the distinct FILE-card wrapper:
    // extension chip + filename + Download anchor. The outer element must be
    // a <div> here — the generic branch's outer <a> cannot legally nest the
    // download <a>. Round-trip safety is unchanged either way: the parse
    // rule above matches `[data-rich-resource-card]` on ANY tag, attrs
    // ride on the outer element via `mergeAttributes(HTMLAttributes)`, and
    // the node is an atom, so pasted inner markup is never re-parsed.
    if (String(node.attrs.kind ?? '') === 'file') {
      return [
        'div',
        mergeAttributes(HTMLAttributes, {
          class: 'rich-reference-card rich-file-card',
          'data-rich-resource-card': '',
          'data-resource-id': resourceId
        }),
        [
          'span',
          { class: 'rich-file-card__icon', 'aria-hidden': 'true' },
          richFileExtensionLabel(title)
        ],
        [
          'span',
          { class: 'rich-file-card__body' },
          ['strong', { class: 'rich-file-card__name' }, title],
          ...(description
            ? [['span', { class: 'rich-file-card__description' }, description] as const]
            : [])
        ],
        [
          'a',
          {
            class: 'rich-file-card__download',
            // Icon-only hook for narrow screens, matching the node view.
            'data-action': 'download',
            title: 'Download',
            'aria-label': 'Download',
            href: resourceDomHref(this.options.resolver, resourceId, 'download'),
            // The filename as the value (not a bare boolean attribute): the
            // read view's sanitizer strips empty non-boolean attributes, and
            // the value doubles as the save-as hint (the route's
            // Content-Disposition filename still wins when it differs).
            // Omitted entirely for an extension-less title — see
            // `richFileDownloadName`.
            ...(richFileDownloadName(title) ? { download: title } : {})
          },
          'Download'
        ]
      ];
    }
    //: app-reference kinds get a small type chip
    // ('App'/'Product'/'Part') — the serialized markup mirror of the node
    // view's chip below. Same atom/round-trip reasoning as the file branch:
    // inner markup is never re-parsed.
    const kindLabel = resourceKindLabel(node.attrs.kind, this.options.resolver);
    return [
      'a',
      mergeAttributes(HTMLAttributes, {
        class: 'rich-reference-card rich-reference-card--resource',
        href: `${RICH_RESOURCE_SCHEME}${resourceId}`,
        'data-rich-resource-card': '',
        'data-resource-id': resourceId
      }),
      ['strong', {}, title],
      ...(kindLabel
        ? [
            [
              'span',
              { class: 'rich-reference-card__badge' },
              kindLabel
            ] as const
          ]
        : []),
      ...(description ? [['span', {}, description] as const] : [])
    ];
  },

  // A plain DOM node view, so the Download link stays clickable inside the editor and the size line
  // can load without touching the document.
  //
  // A file with a registered viewer and `presentation: 'preview'` shows an inline frame with
  // resize, alignment, caption and a file bar; otherwise it is a card. The viewer mounts through
  // `mountFilePreview`.
  addNodeView() {
    const fetchResourceFileMeta = this.options.fetchResourceFileMeta;
    const mountFilePreview = this.options.mountFilePreview;
    const { resolver } = this.options;
    return ({ editor, node: initialNode, getPos }) => {
      const wrapper = document.createElement('div');
      wrapper.setAttribute('contenteditable', 'false');
      // The same marker attribute `renderHTML` emits, which CSS targets.
      wrapper.setAttribute('data-rich-resource-card', '');

      // Active viewer mount for the preview presentation — torn down before
      // every rebuild and on destroy so a React root never outlives its slot.
      let cleanupPreview: (() => void) | null = null;
      const teardownPreview = (): void => {
        if (!cleanupPreview) return;
        const cleanup = cleanupPreview;
        cleanupPreview = null;
        cleanup();
      };

      /** Commit one attr on THIS node — same tr.setNodeAttribute pattern as `RichImage`'s resize commit. */
      const commitAttr = (name: string, value: unknown): void => {
        if (typeof getPos !== 'function') return;
        editor
          .chain()
          .command(({ tr }) => {
            const pos = getPos();
            if (typeof pos !== 'number') return false;
            tr.setNodeAttribute(pos, name, value);
            return true;
          })
          .run();
      };

      /**
       * The shared file bar (extension chip + name + meta + Download) both
       * presentations render. Returns the meta span so the async size lookup
       * can land in either layout.
       */
      const buildFileBar = (
        container: HTMLElement,
        resourceId: string,
        title: string,
        description: string,
        currentNode: typeof initialNode,
        previewable: boolean
      ): HTMLSpanElement => {
        const icon = document.createElement('span');
        icon.className = 'rich-file-card__icon';
        icon.setAttribute('aria-hidden', 'true');
        icon.textContent = richFileExtensionLabel(title);

        const body = document.createElement('span');
        body.className = 'rich-file-card__body';
        const name = document.createElement('strong');
        name.className = 'rich-file-card__name';
        name.textContent = title;
        // Truncated to one line when narrow; the full text is in the tooltip.
        name.title = title;
        body.appendChild(name);
        const meta = document.createElement('span');
        meta.className = 'rich-file-card__meta';
        meta.textContent = description;
        if (description) body.appendChild(meta);

        const download = document.createElement('a');
        download.className = 'rich-file-card__download';
        download.href = resourceDomHref(resolver, resourceId, 'download');
        const saveAs = richFileDownloadName(title);
        if (saveAs) download.setAttribute('download', saveAs);
        download.dataset.action = 'download';
        download.title = 'Download';
        download.setAttribute('aria-label', 'Download');
        download.textContent = 'Download';
        // Keep the pointer gesture on the anchor: without this, ProseMirror
        // treats the mousedown as the atom's node-selection gesture and the
        // browser never follows the link — the same `stopPropagation`
        // technique `RichImage`'s resize handles use above. Clicking
        // anywhere ELSE on the card still selects the node (popover opens,
        // block stays deletable).
        download.addEventListener('mousedown', (event) => event.stopPropagation());

        container.append(icon, body, download);

        // Card/preview toggle: previewable files only, and only while editable.
        if (previewable && editor.isEditable) {
          const showing =
            sanitizeRichResourceCardPresentation(currentNode.attrs.presentation) === 'preview';
          container.appendChild(
            buildRichFileCardActionButton(
              showing ? 'Hide preview' : 'Show preview',
              showing ? 'hide-preview' : 'show-preview',
              () => commitAttr('presentation', showing ? 'card' : 'preview')
            )
          );
        }
        return meta;
      };

      /** Best-effort human size into the file bar's meta span. */
      const resolveSizeLine = (
        resourceId: string,
        description: string,
        meta: HTMLSpanElement,
        body: Element | null
      ): void => {
        if (!fetchResourceFileMeta || !resourceId) return;
        void fetchResourceFileMeta(resourceId)
          .then((result) => {
            const size = formatRichFileSize(result?.sizeBytes);
            if (!size) return;
            meta.textContent = description ? `${size} · ${description}` : size;
            if (!meta.parentNode && body) body.appendChild(meta);
          })
          .catch(() => {
            // Size is optional chrome; a failed lookup renders nothing.
          });
      };

      /** Pointer drag-resize for the preview frame — same interaction as `RichImage`'s handles. */
      const startFrameResize = (
        event: PointerEvent,
        frame: HTMLElement,
        readout: HTMLElement,
        currentNode: typeof initialNode,
        direction: 'left' | 'right'
      ): void => {
        event.preventDefault();
        event.stopPropagation();
        const startX = event.clientX;
        const startWidth = frame.getBoundingClientRect().width;
        wrapper.classList.add('rich-file-preview-view--resizing');
        readout.textContent = `${Math.round(startWidth)} px`;
        const onMove = (moveEvent: PointerEvent): void => {
          const delta = moveEvent.clientX - startX;
          const next = clampDimension(
            startWidth + (direction === 'right' ? delta : -delta),
            RICH_IMAGE_WIDTH_MIN,
            RICH_IMAGE_WIDTH_MAX
          );
          if (next) {
            frame.style.width = `${next}px`;
            readout.textContent = `${next} px`;
          }
        };
        const onUp = (): void => {
          window.removeEventListener('pointermove', onMove);
          window.removeEventListener('pointerup', onUp);
          wrapper.classList.remove('rich-file-preview-view--resizing');
          const committed = clampDimension(
            frame.getBoundingClientRect().width,
            RICH_IMAGE_WIDTH_MIN,
            RICH_IMAGE_WIDTH_MAX
          );
          if (committed !== currentNode.attrs.width) commitAttr('width', committed);
        };
        window.addEventListener('pointermove', onMove);
        window.addEventListener('pointerup', onUp);
      };

      /** Bottom-edge resize for the preview frame, committing the clamped `height` on release. */
      const startFrameHeightResize = (
        event: PointerEvent,
        slot: HTMLElement,
        readout: HTMLElement,
        currentNode: typeof initialNode
      ): void => {
        event.preventDefault();
        event.stopPropagation();
        const startY = event.clientY;
        const startHeight = slot.getBoundingClientRect().height;
        wrapper.classList.add('rich-file-preview-view--resizing');
        readout.textContent = `${Math.round(startHeight)} px`;
        const applyFixedHeight = (next: number): void => {
          slot.style.height = `${next}px`;
          slot.classList.add('rich-file-preview-slot--fixed');
        };
        const onMove = (moveEvent: PointerEvent): void => {
          const next = clampDimension(
            startHeight + (moveEvent.clientY - startY),
            RICH_PREVIEW_HEIGHT_MIN,
            RICH_PREVIEW_HEIGHT_MAX
          );
          if (next) {
            applyFixedHeight(next);
            readout.textContent = `${next} px`;
          }
        };
        const onUp = (): void => {
          window.removeEventListener('pointermove', onMove);
          window.removeEventListener('pointerup', onUp);
          wrapper.classList.remove('rich-file-preview-view--resizing');
          const committed = clampDimension(
            slot.getBoundingClientRect().height,
            RICH_PREVIEW_HEIGHT_MIN,
            RICH_PREVIEW_HEIGHT_MAX
          );
          if (committed !== currentNode.attrs.height) commitAttr('height', committed);
        };
        window.addEventListener('pointermove', onMove);
        window.addEventListener('pointerup', onUp);
      };

      const applyNode = (currentNode: typeof initialNode): void => {
        teardownPreview();
        wrapper.removeAttribute('data-align');
        const resourceId = String(currentNode.attrs.resourceId ?? '');
        const title = String(currentNode.attrs.title ?? 'Untitled resource');
        const description =
          typeof currentNode.attrs.description === 'string' ? currentNode.attrs.description : '';

        const kind = String(currentNode.attrs.kind ?? '');
        const viewerKey = richResourceCardViewerKey(kind, title);
        const presentation = sanitizeRichResourceCardPresentation(
          currentNode.attrs.presentation
        );
        if (kind !== 'file') {
          // Generic reference card — same shape renderHTML emits. App
          // references additionally get their type chip
          // ('App'/'Product'/'Part'); they never render a preview frame or
          // Show-preview affordance — both are gated on kind='file' below.
          // (The wrapper's own class is set with the affordance at the end of
          // this branch.)
          const card = document.createElement('div');
          card.className = 'rich-reference-card rich-reference-card--resource';
          card.setAttribute('data-resource-id', resourceId);
          card.setAttribute('aria-label', `${title} reference; opening is unavailable`);
          const name = document.createElement('strong');
          name.textContent = title;
          card.appendChild(name);
          const kindLabel = resourceKindLabel(kind, resolver);
          if (kindLabel) {
            const chip = document.createElement('span');
            chip.className = 'rich-reference-card__badge';
            chip.textContent = kindLabel;
            card.appendChild(chip);
          }
          if (description) {
            const note = document.createElement('span');
            note.textContent = description;
            card.appendChild(note);
          }
          wrapper.className = 'rich-reference-card-view';
          wrapper.replaceChildren(card);
          return;
        }

        if (!viewerKey || presentation !== 'preview') {
          // Plain file card, with Show preview when a viewer exists.
          wrapper.className = 'rich-reference-card rich-file-card';
          wrapper.setAttribute('data-resource-id', resourceId);
          wrapper.replaceChildren();
          const meta = buildFileBar(
            wrapper,
            resourceId,
            title,
            description,
            currentNode,
            viewerKey !== null
          );
          resolveSizeLine(
            resourceId,
            description,
            meta,
            wrapper.querySelector('.rich-file-card__body')
          );
          return;
        }

        // Preview presentation — image-parity frame chrome.
        wrapper.className = 'rich-file-preview-view';
        wrapper.setAttribute('data-resource-id', resourceId);
        const align = sanitizeRichImageAlign(currentNode.attrs.align);
        if (align) wrapper.setAttribute('data-align', align);

        // Same frame/box structure as `RichImage`:
        // frame shrink-wraps the preview so the caption + file bar match its
        // width; box anchors the resize chrome to the viewer area alone.
        const frame = document.createElement('span');
        frame.className = 'rich-file-preview-frame';
        const width = typeof currentNode.attrs.width === 'number' ? currentNode.attrs.width : null;
        frame.style.width = width ? `${width}px` : '100%';
        const box = document.createElement('span');
        box.className = 'rich-file-preview-box';
        const slot = document.createElement('div');
        slot.className = 'rich-file-preview-slot';
        // A pinned height fixes the slot, and `--fixed` makes the viewer fill it. null keeps the
        // aspect-derived height.
        const height =
          typeof currentNode.attrs.height === 'number' ? currentNode.attrs.height : null;
        if (height) {
          slot.style.height = `${height}px`;
          slot.classList.add('rich-file-preview-slot--fixed');
        }
        // Let the mounted viewer own pointer gestures (scroll, text select)
        // instead of ProseMirror's atom-selection gesture — clicking the
        // frame chrome around it still selects the node.
        slot.addEventListener('mousedown', (event) => event.stopPropagation());
        box.appendChild(slot);

        if (editor.isEditable) {
          const readout = document.createElement('span');
          readout.className = 'rich-image-resize-readout';
          readout.setAttribute('aria-hidden', 'true');
          for (const direction of ['left', 'right'] as const) {
            const handle = document.createElement('span');
            handle.className = `rich-image-resize-handle rich-image-resize-handle--${direction}`;
            handle.setAttribute('aria-hidden', 'true');
            handle.addEventListener('pointerdown', (event) =>
              startFrameResize(event, frame, readout, currentNode, direction)
            );
            box.appendChild(handle);
          }
          // Bottom-edge height handle.
          const heightHandle = document.createElement('span');
          heightHandle.className =
            'rich-image-resize-handle rich-image-resize-handle--bottom';
          heightHandle.setAttribute('aria-hidden', 'true');
          heightHandle.addEventListener('pointerdown', (event) =>
            startFrameHeightResize(event, slot, readout, currentNode)
          );
          box.appendChild(heightHandle);
          box.appendChild(readout);
        }

        frame.appendChild(box);

        const bar = document.createElement('span');
        bar.className = 'rich-reference-card rich-file-card rich-file-preview-bar';
        const meta = buildFileBar(bar, resourceId, title, description, currentNode, true);
        frame.appendChild(bar);

        const caption =
          typeof currentNode.attrs.caption === 'string' ? currentNode.attrs.caption : '';
        if (caption) {
          const captionEl = document.createElement('span');
          captionEl.className = 'rich-image-caption';
          captionEl.textContent = caption;
          frame.appendChild(captionEl);
        }

        wrapper.replaceChildren(frame);

        // Mount the registry viewer. When the size fetcher is available,
        // resolve the stored byte size FIRST so the frame's auto-load guard
        // sees the true size (mounting with unknown size would auto-load a
        // huge file); the size line lands in the bar either way.
        const src = resolver.resourceHref(resourceId, 'preview');
        if (mountFilePreview && src) {
          const mount = (sizeBytes: number | null): void => {
            queueMicrotask(() => {
              if (!slot.isConnected) return;
              cleanupPreview = mountFilePreview(slot, { src, title, sizeBytes, viewerKey });
            });
          };
          if (fetchResourceFileMeta && resourceId) {
            void fetchResourceFileMeta(resourceId)
              .then((result) => {
                const sizeBytes = result?.sizeBytes ?? null;
                const size = formatRichFileSize(sizeBytes);
                if (size) {
                  meta.textContent = description ? `${size} · ${description}` : size;
                  if (!meta.parentNode) {
                    bar.querySelector('.rich-file-card__body')?.appendChild(meta);
                  }
                }
                mount(sizeBytes);
              })
              .catch(() => mount(null));
          } else {
            mount(null);
          }
        } else {
          resolveSizeLine(
            resourceId,
            description,
            meta,
            bar.querySelector('.rich-file-card__body')
          );
        }
      };

      applyNode(initialNode);

      return {
        dom: wrapper,
        update(updatedNode) {
          if (updatedNode.type.name !== 'resourceCard') return false;
          applyNode(updatedNode);
          return true;
        },
        destroy() {
          teardownPreview();
        },
        ignoreMutation: () => true
      };
    };
  }
});

/**
 * Inline reference chip. Same identity as `resourceCard` (resourceId, title, kind, selector)
 * without its presentation attrs. An inline atom with no marks. Its canonical href is
 * `rich-resource:<id>`; Markdown is `[title](rich-resource:id)`.
 */
export const RichResourceChip = Node.create<ResolverOption>({
  name: 'resourceChip',
  addOptions() {
    return { resolver: nullResolver };
  },
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  marks: '',

  addAttributes() {
    return {
      resourceId: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-resource-id'),
        renderHTML: () => ({})
      },
      title: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-title'),
        renderHTML: () => ({})
      },
      kind: {
        default: 'file',
        parseHTML: (element) => element.getAttribute('data-kind') ?? 'file',
        renderHTML: () => ({})
      },
      selector: {
        default: 'latest-approved',
        parseHTML: (element) => element.getAttribute('data-selector') ?? 'latest-approved',
        renderHTML: () => ({})
      }
    };
  },

  parseHTML() {
    // Higher priority than any generic `a[...]` rule so a same-editor paste
    // can never reparse the chip as a plain link.
    return [
      { tag: 'a[data-rich-resource-chip]', priority: 100 }
    ];
  },

  renderHTML({ node, HTMLAttributes }) {
    const resourceId = String(node.attrs.resourceId ?? '');
    const title = String(node.attrs.title ?? 'Untitled resource');
    const kind = String(node.attrs.kind ?? 'file');
    return [
      'a',
      mergeAttributes(HTMLAttributes, {
        class: 'rich-resource-chip',
        href: `${RICH_RESOURCE_SCHEME}${resourceId}`,
        title,
        'data-rich-resource-chip': '',
        'data-resource-id': resourceId,
        'data-title': title,
        'data-kind': kind,
        'data-selector': String(node.attrs.selector ?? 'latest-approved')
      }),
      [
        'span',
        { class: 'rich-resource-chip__kind', 'aria-hidden': 'true' },
        richResourceChipKindLabel(kind, title, this.options.resolver)
      ],
      ['span', { class: 'rich-resource-chip__label' }, title]
    ];
  }
});

export const RichTaskReference = Node.create<ResolverOption>({
  name: 'taskReference',
  addOptions() {
    return { resolver: nullResolver };
  },
  group: 'block',
  atom: true,
  selectable: true,

  addAttributes() {
    return {
      taskId: { default: null },
      fallbackTitle: { default: null }
    };
  },

  parseHTML() {
    return [{ tag: '[data-rich-task-reference]' }];
  },

  renderHTML({ node, HTMLAttributes }) {
    const taskId = String(node.attrs.taskId ?? '');
    const title = String(node.attrs.fallbackTitle ?? 'linked task');
    return [
      'a',
      mergeAttributes(HTMLAttributes, {
        class: 'rich-reference-card rich-reference-card--task',
        href: `${RICH_TASK_SCHEME}${taskId}`,
        'data-rich-task-reference': '',
        'data-task-id': taskId
      }),
      ['strong', {}, title]
    ];
  },

  // Vanilla node view added purely to host the one-click open affordance
  // — same reasoning and shape as `RichResourceCard`'s
  // generic branch above. `renderHTML` still governs `editor.getHTML()` /
  // clipboard serialization and the canonical JSON is untouched; this only
  // The canonical task link stays in stored content while the live node view
  // exposes the host application's focused-task route.
  addNodeView() {
    const { resolver } = this.options;
    return ({ node: initialNode }) => {
      const wrapper = document.createElement('div');
      wrapper.setAttribute('contenteditable', 'false');
      wrapper.setAttribute('data-rich-task-reference', '');

      const applyNode = (currentNode: typeof initialNode): void => {
        const taskId = String(currentNode.attrs.taskId ?? '');
        const title = String(currentNode.attrs.fallbackTitle ?? 'linked task');
        wrapper.className = 'rich-reference-card-view';
        wrapper.setAttribute('data-task-id', taskId);

        const card = document.createElement('a');
        card.className = 'rich-reference-card rich-reference-card--task';
        card.href = `${RICH_TASK_SCHEME}${taskId}`;
        card.setAttribute('data-task-id', taskId);
        const name = document.createElement('strong');
        name.textContent = title;
        card.appendChild(name);

        wrapper.replaceChildren(card);
        const href = resolver.taskHref?.(taskId);
        if (href) {
          wrapper.appendChild(
            buildRichOpenAffordance({ kind: 'task', href, label: `Open ${title}`, newTab: false })
          );
        }
      };

      applyNode(initialNode);

      return {
        dom: wrapper,
        update(updatedNode) {
          if (updatedNode.type.name !== 'taskReference') return false;
          applyNode(updatedNode);
          return true;
        },
        ignoreMutation: () => true
      };
    };
  }
});

export interface CreateEditorExtensionsOptions {
  /** Turns stored ids into host URLs. Defaults to a resolver that resolves nothing. */
  resolver?: EditorResolver;
  /** Empty-document hint text. */
  placeholder?: string;
  /** See `RichChildrenIndex`'s `rows` option doc comment. */
  childrenIndexRows?: readonly RichChildrenIndexNodeRow[] | null;
  /** Client-side navigation for the children index. Without it the rows are plain links. */
  onChildrenIndexNavigate?: (href: string) => void;
  /**
   * Plain-click link opening for text link marks — see
   * `RichLinkClick`'s doc comment in `./link-click.ts`. The live editor
   * threads `openRichLink` (internal/app-page → router push, external
   * http(s) → new tab) through here; returns whether it opened. `undefined`
   * (validator, revision preview, tests) registers no click plugin.
   */
  onLinkOpen?: (href: string) => boolean;
  /**
   * One-click open affordance for `link` marks — maps a
   * stored href to its presentation target, or null for a draft/unsafe href
   * that must get no affordance. See `RichOpenAffordance`'s
   * `resolveLinkTarget` option doc comment in `./open-affordance.ts` for why
   * this is threaded rather than computed there. `undefined` (validator,
   * revision preview, most tests) means link marks get no affordance; the
   * reference chip/card/task affordances are unconditional, since their
   * hrefs derive from the node's own id.
   */
  resolveLinkTarget?: RichOpenAffordanceOptions['resolveLinkTarget'];
  /** See `RichResourceCard`'s `fetchResourceFileMeta` option doc comment. */
  fetchResourceFileMeta?: RichResourceFileMetaFetcher;
  /** See `RichResourceCard`'s `mountFilePreview`. */
  mountFilePreview?: RichFilePreviewMounter;
}

/** The complete headless extension set. Interactive UI is layered on by `@formless63/editor-react`. */
export function createEditorExtensions(options?: CreateEditorExtensionsOptions): Extensions {
  const resolver = options?.resolver ?? nullResolver;
  return [
    // `codeBlock: false`: replaced by CodeBlockLowlight below, with the same node name and attrs.
    //
    // `underline: false`: StarterKit bundles it with a keyboard shortcut, but the validator does
    // not accept the mark, so it would block saving.
    StarterKit.configure({
      link: false,
      heading: false,
      codeBlock: false,
      orderedList: false,
      underline: false
    }),
    // Superscript and subscript, with their Mod-. and Mod-, shortcuts.
    RichOrderedList,
    RichSuperscript,
    RichSubscript,
    CodeBlockLowlight.configure({
      lowlight: createRichLowlight(),
      defaultLanguage: RICH_CODE_BLOCK_DEFAULT_LANGUAGE
    }),
    RichHeading.configure({ levels: [1, 2, 3, 4, 5, 6] }),
    RichLinkNormalizer,
    RichLink.configure({
      resolver,
      // Plain-click opening is handled by `RichLinkClick` below (canonical
      // mark href + our own routing), NOT by the stock click handler — its
      // `openOnClick: true` path would `window.open` the DOM's presentation
      // href, full-page-loading internal links.
      openOnClick: false,
      autolink: true,
      protocols: ['rich-doc']
    }),
    RichLinkClick.configure({ onOpen: options?.onLinkOpen ?? null }),
    // One-click open affordance — widget decorations for
    // the inline shapes (`link` marks, `resourceChip`); the block shapes
    // (`resourceCard`, `taskReference`) grow theirs in their node views.
    // Decorations + node-view DOM are both pure view layer: nothing here
    // reaches canonical JSON, `getHTML()`, or the Markdown serializer.
    RichOpenAffordance.configure({
      resolveLinkTarget: options?.resolveLinkTarget ?? null,
      onOpenLink: options?.onLinkOpen ?? null
    }),
    Placeholder.configure({ placeholder: options?.placeholder ?? 'Start writing, or type / for commands…' }),
    TaskList,
    RichTaskItem.configure({ nested: true }),
    // Column resizing writes a bounded `colwidth`. `cellMinWidth` must equal
    // `RICH_TABLE_COLWIDTH_MIN`: a drag writes attrs directly, and the plugin's default of 25px
    // would be unsaveable.
    Table.configure({
      resizable: true,
      cellMinWidth: RICH_TABLE_COLWIDTH_MIN,
      handleWidth: 6
    }),
    TableRow,
    RichTableHeader,
    RichTableCell,
    // Hover grips for rows, columns and the table; `EditorTableControls` owns the menu.
    RichTableGrips,
    RichImage.configure({ allowBase64: false, resolver }),
    // Custom emoji atom, inserted by the `:shortcode:` popover.
    RichCustomEmoji,
    RichCallout,
    // Toggle block. `persist` stores the open state as the `open` attr.
    Details.configure({ persist: true, HTMLAttributes: { class: 'rich-details' } }),
    DetailsSummary,
    DetailsContent,
    // Inline and block KaTeX math: atoms with one `latex` attr.
    InlineMath,
    BlockMath,
    RichResourceCard.configure({
      resolver,
      fetchResourceFileMeta: options?.fetchResourceFileMeta,
      mountFilePreview: options?.mountFilePreview
    }),
    // Inline reference chip.
    RichResourceChip.configure({ resolver }),
    RichTaskReference.configure({ resolver }),
    RichChildrenIndex.configure({
      rows: options?.childrenIndexRows ?? null,
      onNavigate: options?.onChildrenIndexNavigate
    }),
    RichCommentMark,
    // View-only power-user affordance (decoration decorations, no schema
    // impact); toggled from the editor overflow menu. Default off.
    InvisibleCharacters.configure({ visible: false }),
    // Stable block identity — reserves the `blockId`
    // attribute slot on every block-level node listed in
    // `block-identity.ts` and assigns/preserves it through edits.
    RichBlockIdentity,
    // Hover-revealed drag handle for top-level block reordering
    //. No configuration — it reads `editor.isEditable`
    // live, so it needs no `canEdit` wiring here.
    RichBlockDragHandle
  ];
}
