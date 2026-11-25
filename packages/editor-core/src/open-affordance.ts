import { Extension } from '@tiptap/core';
import type { Mark, Node as ProseMirrorNode } from '@tiptap/pm/model';
import { Plugin, PluginKey, type EditorState } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';

/**
 * One-click open icons beside links in the live editor. A click on the label selects or edits; the
 * icon opens.
 *
 * The icon is never part of the document: it is a widget decoration for `link` marks and node-view
 * DOM for `taskReference`, so JSON, clipboard HTML and Markdown are unchanged. The renderer needs
 * none, since its links already navigate.
 *
 * It is always present at reduced opacity. Revealing it on hover would reflow text or be
 * unreachable by touch.
 */

/** Marker attribute on every affordance element (styling + test hook). */
export const RICH_OPEN_AFFORDANCE_ATTR = 'data-rich-open-affordance';

/** Which link-shaped element an affordance belongs to (styling + tests). */
export type RichOpenAffordanceKind = 'link' | 'task';

export interface RichOpenAffordanceSpec {
  kind: RichOpenAffordanceKind;
  /**
   * A REAL, resolvable href — never an internal scheme. `rich-doc:` link
   * marks arrive here already mapped to the stable reader route (the caller's
   * `resolveLinkTarget`).
   */
  href: string;
  /** Accessible name, e.g. `Open Example file`. */
  label: string;
  /** New tab + `rel="noopener noreferrer"` (external / content-route opens). */
  newTab: boolean;
  /**
   * In-app navigation for same-tab targets. Returning `true` consumes the
   * click (the anchor's `href` is then only a right-click / middle-click /
   * copy-link target); returning `false`, or omitting the callback, lets the
   * browser follow `href` normally rather than silently swallowing the click
   * — the same fallback contract `children-index-dom.ts` uses.
   */
  onActivate?: ((href: string) => boolean) | null;
}

/**
 * The ↗ glyph. An inline SVG (not `Icons.externalLink`) because every
 * consumer of this builder is vanilla DOM — a ProseMirror widget factory or a
 * node view — with no React root to mount into. Path data is lucide's
 * `external-link`, matching the icon the link popover's Open button renders.
 */
function buildAffordanceIcon(): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  for (const d of [
    'M15 3h6v6',
    'M10 14 21 3',
    'M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h6'
  ]) {
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', d);
    svg.appendChild(path);
  }
  return svg;
}

/**
 * A real anchor, so it is keyboard reachable, named, and supports open-in-new-tab. Both handlers
 * stop propagation: otherwise `mousedown` would select the node and `click` would open the link
 * twice.
 */
export function buildRichOpenAffordance(spec: RichOpenAffordanceSpec): HTMLAnchorElement {
  const anchor = document.createElement('a');
  anchor.className = `rich-open-affordance rich-open-affordance--${spec.kind}`;
  anchor.setAttribute(RICH_OPEN_AFFORDANCE_ATTR, spec.kind);
  anchor.setAttribute('contenteditable', 'false');
  anchor.href = spec.href;
  anchor.title = spec.label;
  anchor.setAttribute('aria-label', spec.label);
  if (spec.newTab) {
    anchor.target = '_blank';
    anchor.rel = 'noopener noreferrer';
  }
  anchor.appendChild(buildAffordanceIcon());
  anchor.addEventListener('mousedown', (event) => {
    event.stopPropagation();
  });
  anchor.addEventListener('click', (event) => {
    event.stopPropagation();
    const activate = spec.onActivate;
    if (!activate) return;
    if (activate(spec.href)) event.preventDefault();
  });
  return anchor;
}

export interface RichOpenAffordanceLinkTarget {
  /** Presentation href — resolvable by the browser. */
  href: string;
  newTab: boolean;
}

export interface RichOpenAffordanceOptions {
  /**
   * Maps a link href to its target, or `null` for no icon (an empty draft or an unsafe scheme).
   * Passed in to avoid an import cycle with the schema.
   */
  resolveLinkTarget: ((href: string) => RichOpenAffordanceLinkTarget | null) | null;
  /**
   * Executes an in-app open for a link mark — the live editor threads
   * `openRichLink` (the ONE open mapping shared with the popover's Open
   * button and the plain-click plugin). `null` leaves the anchor's own href
   * to the browser.
   */
  onOpenLink: ((href: string) => boolean) | null;
}

/** One contiguous run of text carrying the same `link` mark. */
interface LinkRun {
  end: number;
  mark: Mark;
}

/** Exported for tests. */
export function buildRichOpenAffordanceDecorations(
  doc: ProseMirrorNode,
  options: RichOpenAffordanceOptions
): DecorationSet {
  const decorations: Decoration[] = [];
  const { resolveLinkTarget, onOpenLink } = options;

  // Link marks are per-text-node, but one visual link is often several text
  // nodes (a bolded word inside it, a soft-broken run). Coalescing adjacent
  // text nodes that carry an EQUAL link mark puts exactly one affordance at
  // the end of each visual link instead of one per fragment.
  let openRun: LinkRun | null = null;
  const flushRun = (): void => {
    if (!openRun) return;
    const { end, mark } = openRun;
    openRun = null;
    if (!resolveLinkTarget) return;
    const href = typeof mark.attrs.href === 'string' ? mark.attrs.href : '';
    if (!href) return;
    const target = resolveLinkTarget(href);
    if (!target) return;
    decorations.push(
      Decoration.widget(
        end,
        () =>
          buildRichOpenAffordance({
            kind: 'link',
            href: target.href,
            label: 'Open link',
            newTab: target.newTab,
            onActivate: onOpenLink ? () => onOpenLink(href) : null
          }),
        {
          key: `rich-open-link-${end}-${href}`,
          side: 1,
          // The widget is chrome, not content: never let it influence where a
          // click maps in the document or how the selection is drawn.
          ignoreSelection: true,
          stopEvent: () => true
        }
      )
    );
  };

  doc.descendants((node, pos) => {
    if (node.isText) {
      const mark = node.marks.find((candidate) => candidate.type.name === 'link') ?? null;
      if (mark && openRun && openRun.end === pos && mark.eq(openRun.mark)) {
        openRun = { end: pos + node.nodeSize, mark };
        return true;
      }
      flushRun();
      if (mark) openRun = { end: pos + node.nodeSize, mark };
      return true;
    }

    // Any non-text node ends the current run — a link mark cannot continue
    // across one.
    flushRun();

    return true;
  });
  flushRun();

  return DecorationSet.create(doc, decorations);
}

export const RichOpenAffordance = Extension.create<RichOpenAffordanceOptions>({
  name: 'richOpenAffordance',

  addOptions() {
    return { resolveLinkTarget: null, onOpenLink: null };
  },

  addProseMirrorPlugins() {
    const options = this.options;
    return [
      new Plugin({
        key: new PluginKey('richOpenAffordance'),
        props: {
          decorations(state: EditorState) {
            return buildRichOpenAffordanceDecorations(state.doc, options);
          }
        }
      })
    ];
  }
});
