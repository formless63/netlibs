import type { Root } from 'mdast';
import remarkDirective from 'remark-directive';
import remarkGfm from 'remark-gfm';
import remarkParse from 'remark-parse';
import { unified } from 'unified';

import { RICH_INLINE_MATH_PATTERN } from './inline-math.ts';
import { canonicalizeRichHref, containsControlCharacter } from './stable-link.ts';
import {
  isRichCustomEmojiName,
  RICH_CALLOUT_COLORS,
  RICH_CALLOUT_KINDS,
  EDITOR_SCHEMA_VERSION,
  type RichCalloutKind,
  type EditorDocument,
  type EditorMark,
  type EditorNode,
  type RichImportFinding,
  type RichImportResult
} from './types.ts';
import { normalizeEmptyEditorDocument, validateEditorDocument } from './validation.ts';

interface MdNode {
  type: string;
  value?: string;
  depth?: number;
  ordered?: boolean;
  start?: number | null;
  checked?: boolean | null;
  url?: string;
  alt?: string;
  title?: string | null;
  lang?: string | null;
  name?: string;
  align?: Array<'left' | 'right' | 'center' | null>;
  data?: { directiveLabel?: boolean };
  attributes?: Record<string, string | null | undefined>;
  children?: MdNode[];
  position?: { start: { offset?: number }; end: { offset?: number } };
}

export type RichImageResourceResolution =
  | { resourceId: string; title?: string; description?: string | null }
  | { resourceId: null; reason?: string };

export interface RichMarkdownImportOptions {
  /**
   * Resolves one image source that is not `rich-resource:` to a stored resource. Return `{
   * resourceId: null, reason }` when unresolved; the reason appears in the finding.
   */
  resolveImageResource?: (input: {
    source: string;
    alt: string;
    /** Best-effort caption, with any size suffix removed and `alt` substituted when empty. */
    description: string | null;
  }) => RichImageResourceResolution;
  referenceManifest?: {
    resources?: Array<{
      resourceId: string;
      title: string;
      description?: string | null;
      kind: string;
      selector: 'live' | 'latest-approved' | 'pinned' | 'imported-copy';
    }>;
    tasks?: Array<{ taskId: string; fallbackTitle: string }>;
  };
}

const CALLOUT_ALIASES: Record<string, RichCalloutKind> = {
  info: 'note',
  danger: 'caution'
};
// A private-use character fenced by rare punctuation: the private-use character
// makes a collision with real text implausible, and the punctuation edges keep
// the escape's effect on `*`/`_` flanking identical to the character it stands for.
const sentinel = (character: string): string => `\u{2e4e}${character}\u{2e4e}`;
const ESCAPED_ANCHOR_SENTINEL = sentinel('\u{e000}');
// remark would unescape `\^`, `\~` and `\$` before our text scans run, making an
// escaped literal indistinguishable from a real mark or math run.
const ESCAPED_CARET_SENTINEL = sentinel('\u{e001}');
const ESCAPED_TILDE_SENTINEL = sentinel('\u{e002}');
const ESCAPED_DOLLAR_SENTINEL = sentinel('\u{e003}');

function protectInlineLiterals(line: string): string {
  return protectEscapedAnchorLiterals(liftInlineMath(line));
}

function protectEscapedAnchorLiterals(line: string): string {
  // `\\\\` is matched first so an escaped backslash never lends its second half
  // to the character after it.
  return line.replace(
    /\\(\\|\^|~|\$|\{#([A-Za-z][A-Za-z0-9_-]*)\})/g,
    (match, escaped: string, anchor: string | undefined) => {
      if (anchor) return `${ESCAPED_ANCHOR_SENTINEL}#${anchor}}`;
      if (escaped === '^') return ESCAPED_CARET_SENTINEL;
      if (escaped === '~') return ESCAPED_TILDE_SENTINEL;
      if (escaped === '$') return ESCAPED_DOLLAR_SENTINEL;
      return match;
    }
  );
}

/** Restores every protected inline literal (escaped `{#…}` anchor, `\^`, `\~`) in one string. */
function restoreProtectedInlineLiterals(value: string, insideCode = false): string {
  // Backslashes are literal inside code spans, so there the escape itself returns.
  const escape = insideCode ? '\\' : '';
  return restoreMathSource(value)
    .replaceAll(ESCAPED_ANCHOR_SENTINEL, `${escape}{`)
    .replaceAll(ESCAPED_CARET_SENTINEL, `${escape}^`)
    .replaceAll(ESCAPED_TILDE_SENTINEL, `${escape}~`)
    .replaceAll(ESCAPED_DOLLAR_SENTINEL, `${escape}$`);
}

function addFinding(
  findings: RichImportFinding[],
  code: RichImportFinding['code'],
  message: string,
  context?: RichImportFinding['context']
): void {
  findings.push({ code, severity: 'error', message, context });
}

/**
 * Checks fenced containers before parsing: boundaries must balance, callouts may not nest, and a
 * space-delimited title becomes the directive label form.
 */
function inspectOutlineContainers(markdown: string, findings: RichImportFinding[]): string {
  const stack: Array<{ line: number; kind: string }> = [];
  let codeFence: { marker: '`' | '~'; length: number } | null = null;
  const lines = markdown.split('\n');
  const normalized = lines.map((line, index) => {
    // Fences inside quotes and list items carry those containers' prefixes.
    const fence = line.match(/^(?:[\s>]|[-*+] +|\d{1,9}[.)] +)*(`{3,}|~{3,})(.*)$/);
    if (codeFence) {
      if (
        fence &&
        fence[1][0] === codeFence.marker &&
        fence[1].length >= codeFence.length &&
        fence[2].trim().length === 0
      ) {
        codeFence = null;
      }
      return line;
    }
    if (fence) {
      codeFence = {
        marker: fence[1][0] as '`' | '~',
        length: fence[1].length
      };
      return line;
    }

    if (/^\s*:::\s*$/.test(line)) {
      if (stack.length === 0) {
        addFinding(
          findings,
          'malformed_outline_callout',
          'Outline callout closes without an opener',
          {
            line: index + 1
          }
        );
      } else {
        stack.pop();
      }
      return line;
    }

    // An optional trailing `{…}` attribute block is kept for remark-directive to parse.
    const opening = line.match(
      /^\s*:::([A-Za-z][A-Za-z0-9_-]*)(?:\[([^\]]*)\]|\s+([^{]+?))?\s*(\{[^}]*\})?\s*$/
    );
    if (!opening) return protectInlineLiterals(line);
    const [, kind, bracketTitle, spacedTitle, directiveAttrs] = opening;
    if (stack.length > 0) {
      addFinding(findings, 'nested_outline_callout', 'Nested Outline callouts require review', {
        line: index + 1,
        outerKind: stack.at(-1)?.kind ?? null,
        innerKind: kind
      });
    }
    stack.push({ line: index + 1, kind });
    if (spacedTitle && !bracketTitle) {
      return `:::${kind}[${spacedTitle.replace(/\]/g, '\\]')}]${directiveAttrs ?? ''}`;
    }
    return line;
  });

  for (const unclosed of stack) {
    addFinding(findings, 'malformed_outline_callout', 'Outline callout is not closed', {
      line: unclosed.line,
      kind: unclosed.kind
    });
  }
  return normalized.join('\n');
}

function canonicalCalloutKind(
  raw: string,
  findings: RichImportFinding[]
): RichCalloutKind | null {
  const normalized = raw.toLowerCase();
  if ((RICH_CALLOUT_KINDS as readonly string[]).includes(normalized)) {
    return normalized as RichCalloutKind;
  }
  if (CALLOUT_ALIASES[normalized]) return CALLOUT_ALIASES[normalized];
  addFinding(findings, 'unsupported_callout_kind', `Unsupported callout kind: ${raw}`, {
    kind: raw
  });
  return null;
}

function withMark(nodes: EditorNode[], mark: EditorMark): EditorNode[] {
  return nodes.map((node) => {
    if (node.type === 'text') {
      const marks = node.marks ?? [];
      // Some sources nest the same emphasis twice (`**__text__**`), which would stack a duplicate
      // mark that the validator rejects.
      if (marks.some((existing) => existing.type === mark.type)) return node;
      // The editor's code mark excludes every other mark. Emphasis around code
      // is styling and is dropped; a link is information, so it wins over code.
      if (marks.some((existing) => existing.type === 'code')) {
        return mark.type === 'link' ? { ...node, marks: [mark] } : node;
      }
      return { ...node, marks: [...marks, mark] };
    }
    return { ...node, content: node.content ? withMark(node.content, mark) : node.content };
  });
}

/**
 * LaTeX is full of characters Markdown would consume (backslash escapes, `_`,
 * `*`), so `$...$` runs are lifted out of each line before parsing and put back
 * after: as `inlineMath` nodes in prose, and verbatim inside code and URLs.
 */
let currentMathRuns: string[] = [];
const MATH_TOKEN = /\u{2e4e}\u{e004}(\d+)\u{2e4e}/gu;

function liftInlineMath(line: string): string {
  return line.replace(RICH_INLINE_MATH_PATTERN(), (_match, latex: string) => {
    currentMathRuns.push(latex);
    return sentinel(`\u{e004}${currentMathRuns.length - 1}`);
  });
}

function restoreMathSource(value: string): string {
  return value.replace(
    MATH_TOKEN,
    (_match, index: string) => `$${currentMathRuns[Number(index)] ?? ''}$`
  );
}

function splitInlineMath(value: string): EditorNode[] {
  const nodes: EditorNode[] = [];
  let lastIndex = 0;
  for (const match of value.matchAll(MATH_TOKEN)) {
    if (match.index > lastIndex) {
      nodes.push({ type: 'text', text: value.slice(lastIndex, match.index) });
    }
    nodes.push({
      type: 'inlineMath',
      attrs: { latex: (currentMathRuns[Number(match[1])] ?? '').trim() }
    });
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < value.length) nodes.push({ type: 'text', text: value.slice(lastIndex) });
  return nodes;
}

/**
 * Splits `^…^` and `~…~` runs into superscript and subscript. Delimiters must hug non-space
 * content. Escaped literals are protected before parsing, and remark-gfm runs with `singleTilde:
 * false`, so neither can match here.
 */
function splitInlineSupSub(nodes: EditorNode[]): EditorNode[] {
  const pattern = /(\^|~)(\S(?:[^\n]*?\S)?)\1/g;
  return nodes.flatMap((node) => {
    if (node.type !== 'text' || typeof node.text !== 'string') return [node];
    const value = node.text;
    const output: EditorNode[] = [];
    let lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(value)) !== null) {
      const [whole, delimiter, inner] = match;
      // The run itself must not contain its delimiter (the lazy `[^\n]*?`
      // above can't express that without also blocking the OTHER delimiter).
      if (inner.includes(delimiter)) {
        pattern.lastIndex = match.index + 1;
        continue;
      }
      if (match.index > lastIndex) {
        output.push({ type: 'text', text: value.slice(lastIndex, match.index) });
      }
      output.push({
        type: 'text',
        text: inner,
        marks: [{ type: delimiter === '^' ? 'superscript' : 'subscript' }]
      });
      lastIndex = match.index + whole.length;
    }
    if (output.length === 0) return [node];
    if (lastIndex < value.length) output.push({ type: 'text', text: value.slice(lastIndex) });
    return output;
  });
}

/**
 * Rebuilds custom emojis from `:shortcode:` for known names only. Adjacent unmarked text is merged
 * first, because directive parsing can split a shortcode. Marked text, such as inline code, is
 * never scanned.
 */
function recoverRichCustomEmoji(nodes: EditorNode[]): EditorNode[] {
  const merged: EditorNode[] = [];
  for (const node of nodes) {
    const previous = merged.at(-1);
    if (
      node.type === 'text' &&
      !node.marks?.length &&
      previous?.type === 'text' &&
      !previous.marks?.length
    ) {
      merged[merged.length - 1] = {
        type: 'text',
        text: `${previous.text ?? ''}${node.text ?? ''}`
      };
      continue;
    }
    merged.push(node);
  }

  const pattern = /:([a-z0-9]+):/g;
  return merged.flatMap((node) => {
    if (node.type !== 'text' || node.marks?.length || typeof node.text !== 'string') return [node];
    const value = node.text;
    const output: EditorNode[] = [];
    let lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(value)) !== null) {
      const name = match[1];
      if (!isRichCustomEmojiName(name)) {
        // Let the closing colon re-serve as the next candidate's opener
        // (`:fake:octocat:` must still recover `:octocat:`).
        pattern.lastIndex = match.index + match[0].length - 1;
        continue;
      }
      if (match.index > lastIndex) {
        output.push({ type: 'text', text: value.slice(lastIndex, match.index) });
      }
      output.push({ type: 'customEmoji', attrs: { name } });
      lastIndex = match.index + match[0].length;
    }
    if (output.length === 0) return [node];
    if (lastIndex < value.length) output.push({ type: 'text', text: value.slice(lastIndex) });
    return output;
  });
}

/**
 * Options of the running `importMarkdown` call. Safe as module state because conversion is
 * synchronous; cleared in its `finally`.
 */
let currentImportOptions: RichMarkdownImportOptions = {};
/** The exact string mdast positions refer to, for the same synchronous window. */
let currentSource = '';

/**
 * Any inline link to `rich-resource:` becomes a chip, with kind and selector from the reference
 * manifest. A missing entry raises `reference_metadata_loss`.
 */
function resourceChipFromInlineLink(
  node: MdNode,
  findings: RichImportFinding[]
): EditorNode {
  const resourceId = (node.url ?? '').slice('rich-resource:'.length);
  const resource = currentImportOptions.referenceManifest?.resources?.find(
    (candidate) => candidate.resourceId === resourceId
  );
  if (!resource) {
    addFinding(
      findings,
      'reference_metadata_loss',
      'Inline resource chip metadata requires its reference manifest for exact reconstruction',
      { resourceId }
    );
  }
  return {
    type: 'resourceChip',
    attrs: {
      resourceId,
      title: resource?.title ?? restoreProtectedInlineLiterals(inlinePlainText(node)),
      kind: resource?.kind ?? 'file',
      selector: resource?.selector ?? 'latest-approved'
    }
  };
}

function convertInline(node: MdNode, findings: RichImportFinding[]): EditorNode[] {
  switch (node.type) {
    case 'text':
      return splitInlineSupSub(splitInlineMath(node.value ?? ''));
    case 'inlineCode':
      return [{ type: 'text', text: node.value ?? '', marks: [{ type: 'code' }] }];
    case 'strong':
      return withMark(convertInlineChildren(node, findings), { type: 'bold' });
    case 'emphasis':
      return withMark(convertInlineChildren(node, findings), { type: 'italic' });
    case 'delete':
      return withMark(convertInlineChildren(node, findings), { type: 'strike' });
    case 'link':
      if ((node.url ?? '').startsWith('rich-resource:')) {
        return [resourceChipFromInlineLink(node, findings)];
      }
      return withMark(convertInlineChildren(node, findings), {
        type: 'link',
        attrs: linkAttrs(node.url ?? '', node.title ?? null, findings)
      });
    case 'break':
      return [{ type: 'hardBreak' }];
    case 'html': {
      // `<br>` is the only line break a GFM table cell can hold, and the only inline HTML accepted
      // here.
      const raw = (node.value ?? '').trim();
      if (/^<br\s*\/?>$/i.test(raw)) return [{ type: 'hardBreak' }];
      addFinding(
        findings,
        'unsupported_editor_node',
        'Raw inline HTML requires sanitized structural review before it can become canonical content',
        { nodeType: 'html' }
      );
      return [{ type: 'text', text: node.value ?? '' }];
    }
    case 'textDirective':
    case 'leafDirective':
      // Only `:::` containers are meaningful; any inline directive is ordinary
      // punctuation ("16:9", ":foo{bar}"), so its source text is kept verbatim.
      return splitInlineSupSub(splitInlineMath(directiveSource(node)));
    case 'image':
      addFinding(
        findings,
        'unsupported_editor_node',
        'An image mixed with inline text requires structural review',
        { nodeType: 'image' }
      );
      return [{ type: 'text', text: node.alt || node.value || 'Unresolved image' }];
    default:
      addFinding(
        findings,
        'unsupported_editor_node',
        `Unsupported inline Markdown node: ${node.type}`,
        { nodeType: node.type }
      );
      return node.children?.length
        ? convertInlineChildren(node, findings)
        : [{ type: 'text', text: node.value ?? '' }];
  }
}

/** The literal text of a directive that is not one of ours, backslash escapes resolved. */
function directiveSource(node: MdNode): string {
  const { start, end } = node.position ?? { start: {}, end: {} };
  if (start.offset === undefined || end.offset === undefined) {
    return `:${node.name ?? ''}${inlinePlainText(node)}`;
  }
  return currentSource
    .slice(start.offset, end.offset)
    .replace(/\\([!-/:-@[-`{-~])/g, '$1');
}

function convertInlineChildren(
  node: MdNode,
  findings: RichImportFinding[]
): EditorNode[] {
  return (node.children ?? []).flatMap((child) => convertInline(child, findings));
}

function restoreEscapedAnchorLiterals(nodes: EditorNode[]): EditorNode[] {
  return nodes.map((node) => ({
    ...node,
    ...(typeof node.text === 'string'
      ? {
          text: restoreProtectedInlineLiterals(
            node.text,
            node.marks?.some((mark) => mark.type === 'code')
          )
        }
      : {}),
    ...(node.content ? { content: restoreEscapedAnchorLiterals(node.content) } : {})
  }));
}

function linkAttrs(
  href: string,
  title: string | null,
  findings: RichImportFinding[]
): Record<string, unknown> {
  const literalHref = restoreProtectedInlineLiterals(href);
  const canonicalHref = canonicalizeRichHref(literalHref);
  if (!canonicalHref) {
    addFinding(findings, 'unsafe_url_scheme_removed', 'Link destination is invalid or unsafe', {
      href
    });
  }
  const safeHref = canonicalHref ?? literalHref;
  if (safeHref.startsWith('rich-doc:')) {
    const target = safeHref.slice('rich-doc:'.length);
    const [targetDocumentId, targetAnchor] = target.split('#', 2);
    return {
      href: safeHref,
      targetDocumentId,
      ...(targetAnchor ? { targetAnchor } : {}),
      ...(title ? { title: restoreProtectedInlineLiterals(title) } : {})
    };
  }
  return { href: safeHref, ...(title ? { title: restoreProtectedInlineLiterals(title) } : {}) };
}

function inlinePlainText(node: MdNode): string {
  if (typeof node.value === 'string') return node.value;
  return (node.children ?? []).map(inlinePlainText).join('');
}

function singleSpecialLink(
  node: MdNode,
  findings: RichImportFinding[],
  options: RichMarkdownImportOptions
): EditorNode | null {
  if (node.type !== 'paragraph' || node.children?.length !== 1) return null;
  const link = node.children[0];
  if (link.type !== 'link' || typeof link.url !== 'string') return null;
  const label = restoreProtectedInlineLiterals(inlinePlainText(link));
  const url = link.url;
  if (url.startsWith('rich-resource:') && label.startsWith('Resource: ')) {
    const resourceId = url.slice('rich-resource:'.length);
    const resource = options.referenceManifest?.resources?.find(
      (candidate) => candidate.resourceId === resourceId
    );
    if (!resource) {
      addFinding(
        findings,
        'reference_metadata_loss',
        'Resource card metadata requires its reference manifest for exact reconstruction',
        { resourceId }
      );
    }
    return {
      type: 'resourceCard',
      attrs: {
        resourceId,
        title: resource?.title ?? label.slice('Resource: '.length),
        description: resource?.description ?? null,
        kind: resource?.kind ?? 'file',
        selector: resource?.selector ?? 'latest-approved'
      }
    };
  }
  if (url.startsWith('rich-task:') && label.startsWith('Task: ')) {
    const taskId = url.slice('rich-task:'.length);
    const task = options.referenceManifest?.tasks?.find((candidate) => candidate.taskId === taskId);
    return {
      type: 'taskReference',
      attrs: {
        taskId,
        fallbackTitle: task?.fallbackTitle ?? label.slice('Task: '.length)
      }
    };
  }
  return null;
}

/**
 * Whether a paragraph child carries no meaning around a lone image: a hard break, or text that is
 * only whitespace and backslash escapes.
 */
function isImageSpacerNode(node: MdNode): boolean {
  if (node.type === 'break') return true;
  // Some exporters leave a literal `\n` (backslash and the letter n). Match runs of it with
  // whitespace and backslashes; a lone `n` is still real text.
  if (node.type === 'text') return /^(?:\\n|[\s\\])*$/.test(node.value ?? '');
  return false;
}

function stripImageSpacerEdges(children: MdNode[]): MdNode[] {
  let start = 0;
  let end = children.length;
  while (start < end && isImageSpacerNode(children[start])) start += 1;
  while (end > start && isImageSpacerNode(children[end - 1])) end -= 1;
  return children.slice(start, end);
}

const IMAGE_DISPLAY_TEXT_FALLBACK = 'Imported image';

/**
 * Removes control characters and collapses whitespace so the result passes the schema's non-empty,
 * single-line check.
 */
function sanitizeImageDisplayText(value: string | null | undefined): string {
  const raw = value ?? '';
  // oxlint's no-control-regex rule forbids matching control characters via a
  // regex character class, so walk code points instead (same approach as
  // containsControlCharacter above, which this reuses to skip the walk when
  // there's nothing to strip).
  const withoutControlCharacters = containsControlCharacter(raw)
    ? Array.from(raw)
        .map((character) => {
          const codePoint = character.codePointAt(0) ?? 0;
          return codePoint <= 31 || codePoint === 127 ? ' ' : character;
        })
        .join('')
    : raw;
  return withoutControlCharacters.replace(/\s+/g, ' ').trim();
}

/**
 * Canonical non-empty title/alt fallback shared by every code path that
 * emits an `image` node. Returns the first candidate that survives
 * sanitization, falling back to a fixed non-empty placeholder so the
 * canonical schema's `requiredString` validator (title/alt must be
 * non-empty, single-line, control-character-free) never rejects an emitted
 * image node.
 */
function resolveImageDisplayText(candidates: Array<string | null | undefined>): string {
  for (const candidate of candidates) {
    const sanitized = sanitizeImageDisplayText(candidate);
    if (sanitized.length > 0) return sanitized;
  }
  return IMAGE_DISPLAY_TEXT_FALLBACK;
}

/** Like `resolveImageDisplayText`, for the optional `description`: an empty result is `null`. */
function sanitizeOptionalImageCaption(value: string | null | undefined): string | null {
  const sanitized = sanitizeImageDisplayText(value);
  return sanitized.length > 0 ? sanitized : null;
}

/**
 * Strips a ` =WIDTHxHEIGHT` suffix from an image title so it cannot become a caption. Any remaining
 * text is kept.
 */
const IMAGE_WIDTH_MIN = 16;
const IMAGE_WIDTH_MAX = 4096;

/**
 * Parses an image title into `width` (px) and caption text. Accepts ` =WIDTHxHEIGHT` and the
 * canonical ` =WIDTH`. An out-of-range width becomes null.
 */
function parseImageSizeTitle(title: string | null): {
  width: number | null;
  caption: string | null;
} {
  if (title === null) return { width: null, caption: null };
  const match = title.match(/\s*=(\d+)(?:x\d+)?\s*$/);
  let width: number | null = null;
  if (match) {
    const parsed = Number.parseInt(match[1], 10);
    if (Number.isFinite(parsed) && parsed >= IMAGE_WIDTH_MIN) {
      width = Math.min(IMAGE_WIDTH_MAX, parsed);
    }
  }
  const caption = (match ? title.slice(0, match.index) : title).trim();
  return { width, caption: caption.length > 0 ? caption : null };
}

function imageBlock(
  node: MdNode,
  findings: RichImportFinding[],
  options: RichMarkdownImportOptions
): EditorNode | null {
  if (node.type !== 'paragraph' || !node.children?.length) return null;
  const meaningfulChildren = stripImageSpacerEdges(node.children);
  if (meaningfulChildren.length !== 1) return null;
  const image = meaningfulChildren[0];
  if (image.type !== 'image' || typeof image.url !== 'string') return null;
  const alt = restoreProtectedInlineLiterals(image.alt ?? '');
  const source = image.url;
  const isPortableRoundTrip = source.startsWith('rich-resource:');
  // The title holds the width (` =W` or ` =WxH`) and, in canonical form, the `description`.
  const { width, caption: titleCaption } = parseImageSizeTitle(
    image.title ? restoreProtectedInlineLiterals(image.title) : null
  );
  const description = isPortableRoundTrip
    ? titleCaption
    : (titleCaption ?? sanitizeOptionalImageCaption(alt));
  let resolved: RichImageResourceResolution;
  if (isPortableRoundTrip) {
    const resourceId = source.slice('rich-resource:'.length);
    const resource = options.referenceManifest?.resources?.find(
      (candidate) => candidate.resourceId === resourceId
    );
    if (!resource) {
      addFinding(
        findings,
        'reference_metadata_loss',
        'Image metadata requires its reference manifest for exact reconstruction',
        { resourceId }
      );
    }
    resolved = {
      resourceId,
      title: resource?.title ?? alt,
      description: resource?.description ?? description
    };
  } else {
    resolved = options.resolveImageResource?.({ source: image.url, alt, description }) ?? {
      resourceId: null
    };
  }
  if (resolved.resourceId === null) {
    addFinding(
      findings,
      'unresolved_image_resource',
      'Image must resolve to a typed resource before import can commit',
      { source: image.url, ...(resolved.reason ? { reason: resolved.reason } : {}) }
    );
    return {
      type: 'paragraph',
      content: [{ type: 'text', text: alt || 'Unresolved image' }]
    };
  }
  return {
    type: 'image',
    attrs: {
      resourceId: resolved.resourceId,
      // Images may have no alt text, or a caption with stray control characters. Each candidate is
      // sanitized before falling back to the resource title.
      title: resolveImageDisplayText([resolved.title, alt]),
      alt: resolveImageDisplayText([alt, resolved.title]),
      description: resolved.description ?? description,
      // Persist the recovered display width; null keeps the
      // intrinsic size.
      ...(width ? { width } : {})
    }
  };
}

function githubAlert(
  node: MdNode,
  findings: RichImportFinding[],
  options: RichMarkdownImportOptions
): EditorNode | null {
  if (node.type !== 'blockquote' || !node.children?.length) return null;
  const first = node.children[0];
  if (first.type !== 'paragraph' || !first.children?.length) return null;
  const firstInline = first.children[0];
  if (firstInline.type !== 'text') return null;
  const [headerLine, ...bodyLines] = (firstInline.value ?? '').split('\n');
  const match = headerLine.match(/^\[!([A-Za-z]+)\](?:\s+(.*))?$/);
  if (!match) return null;
  const kind = canonicalCalloutKind(match[1], findings);
  if (!kind) return null;

  const title = restoreProtectedInlineLiterals(match[2] ?? '').trim() || null;
  const remainingFirstChildren: MdNode[] = [
    ...(bodyLines.length > 0 && bodyLines.join('\n').length > 0
      ? [{ type: 'text', value: bodyLines.join('\n') }]
      : []),
    ...first.children.slice(1)
  ];
  const remainingFirst: MdNode = { ...first, children: remainingFirstChildren };
  const bodySource = [
    ...(remainingFirst.children?.length ? [remainingFirst] : []),
    ...node.children.slice(1)
  ];
  const content = bodySource.flatMap((child) => convertBlock(child, findings, options));
  return {
    type: 'callout',
    attrs: { kind, title },
    content: content.length ? content : [{ type: 'paragraph' }]
  };
}

function directiveContainerTitle(node: MdNode): {
  title: string | null;
  bodyChildren: MdNode[];
} {
  const bodyChildren = [...(node.children ?? [])];
  const label = bodyChildren[0]?.data?.directiveLabel ? bodyChildren.shift() : null;
  const title = label
    ? restoreProtectedInlineLiterals(inlinePlainText(label)).trim() || null
    : null;
  return { title, bodyChildren };
}

function directiveCallout(
  node: MdNode,
  findings: RichImportFinding[],
  options: RichMarkdownImportOptions
): EditorNode | null {
  if (node.type !== 'containerDirective' || !node.name) return null;
  const kind = canonicalCalloutKind(node.name, findings);
  if (!kind) return null;
  const { title, bodyChildren } = directiveContainerTitle(node);
  // Optional `{color=…}` override. Unknown colors drop to the
  // kind-derived default rather than failing the import.
  const rawColor = node.attributes?.color;
  const color =
    typeof rawColor === 'string' && (RICH_CALLOUT_COLORS as readonly string[]).includes(rawColor)
      ? rawColor
      : null;
  const content = bodyChildren.flatMap((child) => convertBlock(child, findings, options));
  return {
    type: 'callout',
    attrs: { kind, title, ...(color ? { color } : {}) },
    content: content.length ? content : [{ type: 'paragraph' }]
  };
}

function directiveDetails(
  node: MdNode,
  findings: RichImportFinding[],
  options: RichMarkdownImportOptions
): EditorNode | null {
  if (node.type !== 'containerDirective' || node.name !== 'details') return null;
  const { title, bodyChildren } = directiveContainerTitle(node);
  const body = bodyChildren.flatMap((child) => convertBlock(child, findings, options));
  return {
    type: 'details',
    attrs: { open: false },
    content: [
      {
        type: 'detailsSummary',
        content: [{ type: 'text', text: title ?? 'Details' }]
      },
      {
        type: 'detailsContent',
        content: body.length ? body : [{ type: 'paragraph' }]
      }
    ]
  };
}

function directiveTree(node: MdNode): EditorNode | null {
  if (node.type !== 'containerDirective' || node.name !== 'tree') return null;
  return { type: 'childrenIndex', attrs: {} };
}

function convertListItem(
  node: MdNode,
  findings: RichImportFinding[],
  options: RichMarkdownImportOptions,
  task: boolean
): EditorNode {
  return {
    type: task ? 'taskItem' : 'listItem',
    ...(task ? { attrs: { checked: node.checked === true, authority: 'document_local' } } : {}),
    content: leadWithParagraph(
      (node.children ?? []).flatMap((child) => convertBlock(child, findings, options))
    )
  };
}

/** List items must open with a paragraph; Markdown allows `- # heading` and `-`. */
function leadWithParagraph(blocks: EditorNode[]): EditorNode[] {
  return blocks[0]?.type === 'paragraph' ? blocks : [{ type: 'paragraph' }, ...blocks];
}

function orParagraph(blocks: EditorNode[]): EditorNode[] {
  return blocks.length > 0 ? blocks : [{ type: 'paragraph' }];
}

function convertBlock(
  node: MdNode,
  findings: RichImportFinding[],
  options: RichMarkdownImportOptions
): EditorNode[] {
  // `:::details` and `:::tree` must match before `directiveCallout`, which would report them as
  // unsupported callouts.
  const details = directiveDetails(node, findings, options);
  if (details) return [details];
  const tree = directiveTree(node);
  if (tree) return [tree];

  const callout = directiveCallout(node, findings, options) ?? githubAlert(node, findings, options);
  if (callout) return [callout];

  switch (node.type) {
    case 'paragraph': {
      const special =
        singleSpecialLink(node, findings, options) ?? imageBlock(node, findings, options);
      if (special) return [special];
      return [
        {
          type: 'paragraph',
          content: recoverRichCustomEmoji(
            restoreEscapedAnchorLiterals(convertInlineChildren(node, findings))
          )
        }
      ];
    }
    case 'heading': {
      const content = convertInlineChildren(node, findings);
      let anchorId: string | undefined;
      const last = content.at(-1);
      if (last?.type === 'text' && typeof last.text === 'string') {
        const anchor = last.text.match(/\s+\{#([A-Za-z][A-Za-z0-9_-]*)\}$/);
        if (anchor) {
          anchorId = anchor[1];
          last.text = last.text.slice(0, -anchor[0].length);
        }
      }
      const restoredContent = recoverRichCustomEmoji(restoreEscapedAnchorLiterals(content));
      return [
        {
          type: 'heading',
          attrs: { level: node.depth ?? 1, ...(anchorId ? { anchorId } : {}) },
          content: restoredContent
        }
      ];
    }
    case 'list': {
      const items = node.children ?? [];
      if (node.ordered) {
        return [
          {
            type: 'orderedList',
            attrs: { start: Math.max(1, node.start ?? 1) },
            content: items.map((item) => convertListItem(item, findings, options, false))
          }
        ];
      }

      const groups: Array<{ task: boolean; items: MdNode[] }> = [];
      for (const item of items) {
        const task = typeof item.checked === 'boolean';
        const current = groups.at(-1);
        if (!current || current.task !== task) groups.push({ task, items: [item] });
        else current.items.push(item);
      }
      return groups.map((group) => ({
        type: group.task ? 'taskList' : 'bulletList',
        content: group.items.map((item) => convertListItem(item, findings, options, group.task))
      }));
    }
    case 'blockquote':
      return [
        {
          type: 'blockquote',
          content: orParagraph(
            (node.children ?? []).flatMap((child) => convertBlock(child, findings, options))
          )
        }
      ];
    case 'thematicBreak':
      return [{ type: 'horizontalRule' }];
    case 'code':
      // A ```math fence round-trips a block math node (serializer.ts's
      // `blockMath` case); everything else is a plain code block.
      if ((node.lang ?? '').toLowerCase() === 'math') {
        return [{ type: 'blockMath', attrs: { latex: restoreProtectedInlineLiterals(node.value ?? '', true).trim() } }];
      }
      return [
        {
          type: 'codeBlock',
          attrs: { language: node.lang ?? null },
          ...(node.value
            ? { content: [{ type: 'text', text: restoreProtectedInlineLiterals(node.value, true) }] }
            : {})
        }
      ];
    case 'leafDirective':
      return [
        {
          type: 'paragraph',
          content: restoreEscapedAnchorLiterals([{ type: 'text', text: directiveSource(node) }])
        }
      ];
    case 'table':
      if (node.align?.some((alignment) => alignment !== null)) {
        addFinding(
          findings,
          'unsupported_table_alignment',
          'GFM table alignment is not represented by the canonical table schema',
          { alignment: node.align.map((value) => value ?? 'none').join(',') }
        );
      }
      return [
        {
          type: 'table',
          content: (node.children ?? []).map((row, rowIndex) => ({
            type: 'tableRow',
            content: (row.children ?? []).map((cell) => ({
              type: rowIndex === 0 ? 'tableHeader' : 'tableCell',
              content: [
                {
                  type: 'paragraph',
                  content: recoverRichCustomEmoji(
                    restoreEscapedAnchorLiterals(convertInlineChildren(cell, findings))
                  )
                }
              ]
            }))
          }))
        }
      ];
    case 'html':
      addFinding(
        findings,
        'unsupported_editor_node',
        'Raw HTML requires sanitized structural review before it can become canonical content',
        { nodeType: 'html' }
      );
      return [
        {
          type: 'paragraph',
          content: [{ type: 'text', text: node.value ?? '' }]
        }
      ];
    case 'containerDirective':
      return [
        {
          type: 'blockquote',
          content: orParagraph(
            (node.children ?? []).flatMap((child) => convertBlock(child, findings, options))
          )
        }
      ];
    default:
      addFinding(findings, 'unsupported_editor_node', `Unsupported Markdown node: ${node.type}`, {
        nodeType: node.type
      });
      return [];
  }
}

function parseMarkdown(source: string): Root & MdNode {
  return (
    unified()
      .use(remarkParse)
      // A single-tilde pair is our subscript form, so it must survive parsing as
      // text instead of GFM's optional single-tilde strikethrough.
      .use(remarkGfm, { singleTilde: false })
      .use(remarkDirective)
      .parse(source) as Root & MdNode
  );
}

/**
 * Parses one line of inline Markdown, or returns `null` when it is not exactly
 * one paragraph. The serializer uses it to check its own emphasis output.
 */
export function parseInlineMarkdown(markdown: string): EditorNode[] | null {
  currentMathRuns = [];
  const source = markdown.split('\n').map(protectInlineLiterals).join('\n');
  const tree = parseMarkdown(source);
  const [only] = tree.children as MdNode[];
  if (tree.children.length !== 1 || only?.type !== 'paragraph') return null;
  currentSource = source;
  try {
    return recoverRichCustomEmoji(restoreEscapedAnchorLiterals(convertInlineChildren(only, [])));
  } finally {
    currentSource = '';
    currentMathRuns = [];
  }
}

export function importMarkdown(
  markdown: string,
  options: RichMarkdownImportOptions = {}
): RichImportResult {
  const findings: RichImportFinding[] = [];
  currentMathRuns = [];
  const inspected = inspectOutlineContainers(markdown, findings);
  const tree = parseMarkdown(inspected);
  // See `currentImportOptions`'s doc comment — synchronous conversion, so the
  // module-scope set/clear can never interleave across calls.
  currentImportOptions = options;
  currentSource = inspected;
  let document: EditorDocument;
  try {
    document = normalizeEmptyEditorDocument({
      type: 'doc',
      content: (tree.children as MdNode[]).flatMap((node) => convertBlock(node, findings, options))
    }) as EditorDocument;
  } finally {
    currentImportOptions = {};
    currentSource = '';
    currentMathRuns = [];
  }
  const validation = validateEditorDocument(document);
  findings.push(...validation.findings);
  return {
    schemaVersion: EDITOR_SCHEMA_VERSION,
    document,
    findings,
    canCommit: findings.length === 0
  };
}
