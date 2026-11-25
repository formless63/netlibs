import { getSchema } from '@tiptap/core';

import { RICH_BLOCK_ID_PATTERN, RICH_BLOCK_IDENTITY_NODE_TYPES } from './block-identity.ts';
import { createEditorExtensions } from './schema.ts';
import {
  canonicalizeRichHref,
  RICH_RESOURCE_SCHEME,
  RICH_STABLE_LINK_SCHEME,
  containsControlCharacter,
  SAFE_ANCHOR_PATTERN
} from './stable-link.ts';
import {
  isRichCustomEmojiName,
  RICH_CALLOUT_COLORS,
  RICH_CALLOUT_KINDS,
  RICH_CUSTOM_EMOJI_NAMES,
  RICH_IMAGE_ALIGNMENTS,
  RICH_IMAGE_WIDTH_MAX,
  RICH_IMAGE_WIDTH_MIN,
  RICH_PREVIEW_HEIGHT_MAX,
  RICH_PREVIEW_HEIGHT_MIN,
  RICH_RESOURCE_CARD_PRESENTATIONS,
  RICH_TABLE_COLWIDTH_MAX,
  RICH_TABLE_COLWIDTH_MIN,
  type EditorDocument,
  type EditorMark,
  type EditorNode,
  type RichImportFinding
} from './types.ts';

const BLOCK_NODE_TYPES = new Set([
  'paragraph',
  'heading',
  'orderedList',
  'bulletList',
  'taskList',
  'blockquote',
  'horizontalRule',
  'table',
  'codeBlock',
  'callout',
  'details',
  'blockMath',
  'childrenIndex',
  'image',
  'resourceCard',
  'taskReference'
]);

const STRUCTURAL_NODE_TYPES = new Set([
  'doc',
  'text',
  'listItem',
  'taskItem',
  'tableRow',
  'tableHeader',
  'tableCell',
  'detailsSummary',
  'detailsContent',
  'inlineMath',
  // Custom emoji atom.
  'customEmoji',
  // Inline reference chip atom.
  'resourceChip',
  'hardBreak'
]);

const MARK_TYPES = new Set([
  'bold',
  'italic',
  'strike',
  'code',
  'link',
  'comment',
  // Superscript and subscript.
  'superscript',
  'subscript'
]);

// `attrs` is added to every node type in `RICH_BLOCK_IDENTITY_NODE_TYPES`
// below the literal table, and `blockId` is added to
// each of those types' allowed attr keys — see the loop after both tables.
const NODE_OBJECT_KEYS: Record<string, ReadonlySet<string>> = {
  doc: new Set(['type', 'content']),
  paragraph: new Set(['type', 'content']),
  heading: new Set(['type', 'attrs', 'content']),
  orderedList: new Set(['type', 'attrs', 'content']),
  bulletList: new Set(['type', 'content']),
  taskList: new Set(['type', 'content']),
  blockquote: new Set(['type', 'content']),
  horizontalRule: new Set(['type']),
  table: new Set(['type', 'content']),
  codeBlock: new Set(['type', 'attrs', 'content']),
  callout: new Set(['type', 'attrs', 'content']),
  details: new Set(['type', 'attrs', 'content']),
  detailsSummary: new Set(['type', 'content']),
  detailsContent: new Set(['type', 'content']),
  blockMath: new Set(['type', 'attrs']),
  inlineMath: new Set(['type', 'attrs']),
  // No `marks` key: custom emojis never carry marks.
  customEmoji: new Set(['type', 'attrs']),
  childrenIndex: new Set(['type', 'attrs']),
  image: new Set(['type', 'attrs']),
  resourceCard: new Set(['type', 'attrs']),
  // No `marks` key: chips never carry marks.
  resourceChip: new Set(['type', 'attrs']),
  taskReference: new Set(['type', 'attrs']),
  text: new Set(['type', 'text', 'marks']),
  listItem: new Set(['type', 'content']),
  taskItem: new Set(['type', 'attrs', 'content']),
  tableRow: new Set(['type', 'content']),
  tableHeader: new Set(['type', 'attrs', 'content']),
  tableCell: new Set(['type', 'attrs', 'content']),
  hardBreak: new Set(['type'])
};
const NODE_ATTR_KEYS: Record<string, ReadonlySet<string>> = {
  heading: new Set(['level', 'anchorId']),
  orderedList: new Set(['start', 'type']),
  codeBlock: new Set(['language']),
  callout: new Set(['kind', 'title', 'color']),
  details: new Set(['open']),
  blockMath: new Set(['latex']),
  inlineMath: new Set(['latex']),
  customEmoji: new Set(['name']),
  childrenIndex: new Set([]),
  image: new Set(['src', 'alt', 'title', 'width', 'height', 'align', 'resourceId', 'description']),
  // Optional presentation attrs.
  resourceCard: new Set([
    'resourceId',
    'title',
    'description',
    'kind',
    'selector',
    'width',
    // Optional pinned preview height (px).
    'height',
    'align',
    'caption',
    'presentation'
  ]),
  // The chip carries the reference identity only.
  resourceChip: new Set(['resourceId', 'title', 'kind', 'selector']),
  taskReference: new Set(['taskId', 'fallbackTitle']),
  taskItem: new Set(['checked', 'authority']),
  tableHeader: new Set(['colspan', 'rowspan', 'colwidth', 'align']),
  tableCell: new Set(['colspan', 'rowspan', 'colwidth', 'align'])
};

// Every identity node accepts an optional `blockId`.
for (const nodeType of RICH_BLOCK_IDENTITY_NODE_TYPES) {
  const objectKeys = new Set(NODE_OBJECT_KEYS[nodeType] ?? ['type']);
  objectKeys.add('attrs');
  NODE_OBJECT_KEYS[nodeType] = objectKeys;

  const attrKeys = new Set(NODE_ATTR_KEYS[nodeType] ?? []);
  attrKeys.add('blockId');
  NODE_ATTR_KEYS[nodeType] = attrKeys;
}
const MARK_OBJECT_KEYS: Record<string, ReadonlySet<string>> = {
  bold: new Set(['type']),
  italic: new Set(['type']),
  strike: new Set(['type']),
  code: new Set(['type']),
  link: new Set(['type', 'attrs']),
  comment: new Set(['type', 'attrs']),
  superscript: new Set(['type']),
  subscript: new Set(['type'])
};
const COMMENT_ATTR_KEYS = new Set(['commentId']);
const LINK_ATTR_KEYS = new Set([
  'href',
  'target',
  'rel',
  'class',
  'title',
  'targetDocumentId',
  'targetAnchor'
]);
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}(?:\.[a-z0-9]+)?$/i;
// The exact grammar the validator uses, exported so other codecs can share it.
export const richProseMirrorSchema = getSchema(createEditorExtensions());

export class EditorContractError extends TypeError {
  readonly findings: RichImportFinding[];

  constructor(findings: RichImportFinding[]) {
    super(findings.map((finding) => finding.message).join('; '));
    this.name = 'EditorContractError';
    this.findings = findings;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function rejectUnknownKeys(
  value: Record<string, unknown>,
  allowedKeys: ReadonlySet<string>,
  path: string,
  label: string,
  findings: RichImportFinding[]
): void {
  for (const key of Object.keys(value)) {
    if (!allowedKeys.has(key)) {
      finding(
        findings,
        'invalid_canonical_document',
        `${label} contains unsupported key: ${key}`,
        `${path}.${key}`
      );
    }
  }
}

function validateOptionalStructuralText(
  value: unknown,
  path: string,
  label: string,
  findings: RichImportFinding[]
): void {
  if (
    value !== undefined &&
    value !== null &&
    (typeof value !== 'string' || containsControlCharacter(value))
  ) {
    finding(
      findings,
      'invalid_canonical_document',
      `${label} must be single-line text or null`,
      path
    );
  }
}

function validateUnspecifiedImageDimension(
  value: unknown,
  path: string,
  findings: RichImportFinding[]
): void {
  if (value === undefined || value === null) return;
  finding(
    findings,
    'invalid_canonical_document',
    'Portable images persist width only; height is derived from the intrinsic aspect ratio',
    path
  );
}

function isBoundedInteger(value: unknown, min: number, max: number): boolean {
  return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max;
}

function validateImageWidth(value: unknown, path: string, findings: RichImportFinding[]): void {
  if (value === undefined || value === null) return;
  if (!isBoundedInteger(value, RICH_IMAGE_WIDTH_MIN, RICH_IMAGE_WIDTH_MAX)) {
    finding(
      findings,
      'invalid_image_width',
      `Image width must be null or an integer between ${RICH_IMAGE_WIDTH_MIN} and ${RICH_IMAGE_WIDTH_MAX} px`,
      path
    );
  }
}

function validateTableCellAttrs(
  attrs: Record<string, unknown>,
  path: string,
  findings: RichImportFinding[]
): void {
  for (const key of ['colspan', 'rowspan'] as const) {
    if (attrs[key] !== undefined && attrs[key] !== 1) {
      finding(
        findings,
        'invalid_canonical_document',
        `Portable tables require ${key} to remain 1`,
        `${path}.attrs.${key}`
      );
    }
  }
  if (attrs.colwidth !== undefined && attrs.colwidth !== null) {
    const colwidth = attrs.colwidth;
    const valid =
      Array.isArray(colwidth) &&
      colwidth.length > 0 &&
      colwidth.every((entry) =>
        isBoundedInteger(entry, RICH_TABLE_COLWIDTH_MIN, RICH_TABLE_COLWIDTH_MAX)
      );
    if (!valid) {
      finding(
        findings,
        'invalid_table_colwidth',
        `Table colwidth must be null or an array of integers between ${RICH_TABLE_COLWIDTH_MIN} and ${RICH_TABLE_COLWIDTH_MAX} px`,
        `${path}.attrs.colwidth`
      );
    }
  }
  if (attrs.align !== undefined && attrs.align !== null) {
    finding(
      findings,
      'invalid_canonical_document',
      'Portable tables cannot persist alignment overrides',
      `${path}.attrs.align`
    );
  }
}

function finding(
  findings: RichImportFinding[],
  code: RichImportFinding['code'],
  message: string,
  path: string,
  context?: RichImportFinding['context']
): void {
  findings.push({ code, severity: 'error', message, path, context });
}

function validateMark(
  value: unknown,
  path: string,
  findings: RichImportFinding[]
): value is EditorMark {
  if (!isRecord(value) || typeof value.type !== 'string' || !MARK_TYPES.has(value.type)) {
    finding(findings, 'unsupported_mark', 'Unsupported or malformed editor mark', path);
    return false;
  }

  rejectUnknownKeys(value, MARK_OBJECT_KEYS[value.type], path, 'Editor mark', findings);

  if (value.type === 'link') {
    if (!isRecord(value.attrs)) {
      finding(findings, 'invalid_canonical_document', 'Link marks require attrs', `${path}.attrs`);
      return false;
    }
    const markAttrs = value.attrs;
    rejectUnknownKeys(markAttrs, LINK_ATTR_KEYS, `${path}.attrs`, 'Link attrs', findings);
    const href = markAttrs.href;
    const canonicalHref = typeof href === 'string' ? canonicalizeRichHref(href) : null;
    if (typeof href !== 'string' || canonicalHref !== href) {
      finding(
        findings,
        'unsafe_url_scheme_removed',
        'Link uses an unsupported or unsafe URL scheme',
        path,
        { href: typeof href === 'string' ? href : null }
      );
      return false;
    }
    if (
      markAttrs.title !== undefined &&
      markAttrs.title !== null &&
      (typeof markAttrs.title !== 'string' || containsControlCharacter(markAttrs.title))
    ) {
      finding(findings, 'invalid_canonical_document', 'Link title contains invalid text', path);
      return false;
    }
    if (![undefined, null, '_blank'].includes(markAttrs.target as undefined | null | string)) {
      finding(
        findings,
        'invalid_canonical_document',
        'Link target must be _blank or null',
        `${path}.attrs.target`
      );
    }
    if (
      ![undefined, null, 'noopener noreferrer nofollow'].includes(
        markAttrs.rel as undefined | null | string
      )
    ) {
      finding(
        findings,
        'invalid_canonical_document',
        'Link rel must use the safe default or null',
        `${path}.attrs.rel`
      );
    }
    if (markAttrs.class !== undefined && markAttrs.class !== null) {
      finding(
        findings,
        'invalid_canonical_document',
        'Canonical links cannot persist CSS classes',
        `${path}.attrs.class`
      );
    }
    if (href.startsWith(RICH_STABLE_LINK_SCHEME)) {
      const target = href.slice(RICH_STABLE_LINK_SCHEME.length);
      const [targetDocumentId, targetAnchor] = target.split('#', 2);
      if (markAttrs.targetDocumentId !== targetDocumentId) {
        finding(
          findings,
          'invalid_canonical_document',
          'Internal link targetDocumentId must match its stable href',
          path
        );
      }
      if ((markAttrs.targetAnchor ?? undefined) !== targetAnchor) {
        finding(
          findings,
          'invalid_canonical_document',
          'Internal link targetAnchor must match its stable href',
          path
        );
      }
    } else if (
      (markAttrs.targetDocumentId !== undefined && markAttrs.targetDocumentId !== null) ||
      (markAttrs.targetAnchor !== undefined && markAttrs.targetAnchor !== null)
    ) {
      finding(
        findings,
        'invalid_canonical_document',
        'External links cannot persist internal document targets',
        path
      );
    }
  }

  if (value.type === 'comment') {
    // A comment mark only points at a host-owned thread. commentId must be a UUID; no other attrs
    // are allowed.
    if (!isRecord(value.attrs)) {
      finding(
        findings,
        'invalid_comment_id',
        'Comment marks require a commentId attr',
        `${path}.attrs`
      );
      return false;
    }
    rejectUnknownKeys(value.attrs, COMMENT_ATTR_KEYS, `${path}.attrs`, 'Comment attrs', findings);
    const commentId = value.attrs.commentId;
    if (typeof commentId !== 'string' || !UUID_PATTERN.test(commentId)) {
      finding(
        findings,
        'invalid_comment_id',
        'Comment mark commentId must be a UUID',
        `${path}.attrs.commentId`
      );
      return false;
    }
  }
  return true;
}

function requiredString(
  attrs: Record<string, unknown>,
  key: string,
  path: string,
  findings: RichImportFinding[]
): string | null {
  const value = attrs[key];
  if (typeof value !== 'string' || value.trim().length === 0 || containsControlCharacter(value)) {
    finding(
      findings,
      'invalid_canonical_document',
      `${key} must be a non-empty string`,
      `${path}.attrs.${key}`
    );
    return null;
  }
  return value;
}

function validateDisplayTitle(
  attrs: Record<string, unknown>,
  key: string,
  path: string,
  findings: RichImportFinding[]
): void {
  const value = requiredString(attrs, key, path, findings);
  if (value && UUID_PATTERN.test(value.trim())) {
    finding(
      findings,
      'uuid_display_title',
      'Internal UUIDs cannot be used as human-facing Rich titles',
      `${path}.attrs.${key}`
    );
  }
}

function validateNode(
  value: unknown,
  path: string,
  findings: RichImportFinding[],
  blockIds: Map<string, string>
): value is EditorNode {
  if (!isRecord(value) || typeof value.type !== 'string') {
    finding(findings, 'invalid_canonical_document', 'Malformed editor node', path);
    return false;
  }

  if (!BLOCK_NODE_TYPES.has(value.type) && !STRUCTURAL_NODE_TYPES.has(value.type)) {
    finding(findings, 'unsupported_editor_node', `Unsupported editor node: ${value.type}`, path, {
      nodeType: value.type
    });
    return false;
  }

  rejectUnknownKeys(
    value,
    NODE_OBJECT_KEYS[value.type],
    path,
    `Editor node ${value.type}`,
    findings
  );

  if (value.attrs !== undefined && !isRecord(value.attrs)) {
    finding(
      findings,
      'invalid_canonical_document',
      'Node attrs must be an object',
      `${path}.attrs`
    );
  }

  if (value.type === 'text' && typeof value.text !== 'string') {
    finding(findings, 'invalid_canonical_document', 'Text nodes require text', path);
  }
  if (value.text !== undefined && value.type !== 'text') {
    finding(findings, 'invalid_canonical_document', 'Only text nodes may contain text', path);
  }

  const attrs = isRecord(value.attrs) ? value.attrs : {};
  const allowedAttrKeys = NODE_ATTR_KEYS[value.type];
  if (allowedAttrKeys && isRecord(value.attrs)) {
    rejectUnknownKeys(
      value.attrs,
      allowedAttrKeys,
      `${path}.attrs`,
      `${value.type} attrs`,
      findings
    );
  }
  if (value.type === 'heading') {
    if (!Number.isInteger(attrs.level) || Number(attrs.level) < 1 || Number(attrs.level) > 6) {
      finding(findings, 'invalid_canonical_document', 'Heading level must be 1 through 6', path);
    }
    if (
      attrs.anchorId !== undefined &&
      attrs.anchorId !== null &&
      typeof attrs.anchorId !== 'string'
    ) {
      finding(findings, 'invalid_canonical_document', 'Heading anchorId must be a string', path);
    } else if (typeof attrs.anchorId === 'string' && !SAFE_ANCHOR_PATTERN.test(attrs.anchorId)) {
      finding(
        findings,
        'invalid_canonical_document',
        'Heading anchorId must begin with a letter and contain only letters, numbers, underscores, or hyphens',
        path
      );
    }
  }
  if (value.type === 'orderedList') {
    if (attrs.start !== undefined && (!Number.isInteger(attrs.start) || Number(attrs.start) < 1)) {
      finding(
        findings,
        'invalid_canonical_document',
        'Ordered-list start must be a positive integer',
        `${path}.attrs.start`
      );
    }
    if (attrs.type !== undefined && attrs.type !== null) {
      finding(
        findings,
        'invalid_canonical_document',
        'Portable ordered lists cannot persist alternate marker styles',
        `${path}.attrs.type`
      );
    }
  }
  if (value.type === 'codeBlock') {
    validateOptionalStructuralText(
      attrs.language,
      `${path}.attrs.language`,
      'Code-block language',
      findings
    );
  }
  if (value.type === 'callout') {
    const kind = attrs.kind;
    if (typeof kind !== 'string' || !(RICH_CALLOUT_KINDS as readonly string[]).includes(kind)) {
      finding(
        findings,
        'invalid_canonical_callout_kind',
        'Canonical callout kind must be note, tip, important, warning, or caution',
        `${path}.attrs.kind`,
        { kind: typeof kind === 'string' ? kind : null }
      );
    }
    validateOptionalStructuralText(attrs.title, `${path}.attrs.title`, 'Callout title', findings);
    if (
      attrs.color !== undefined &&
      attrs.color !== null &&
      !(RICH_CALLOUT_COLORS as readonly string[]).includes(attrs.color as string)
    ) {
      finding(
        findings,
        'invalid_callout_color',
        `Callout color must be null or one of: ${RICH_CALLOUT_COLORS.join(', ')}`,
        `${path}.attrs.color`,
        { color: typeof attrs.color === 'string' ? attrs.color : null }
      );
    }
    if (!Array.isArray(value.content) || value.content.length === 0) {
      finding(findings, 'invalid_canonical_document', 'Callouts require rich block content', path);
    }
  }
  if (value.type === 'details') {
    if (attrs.open !== undefined && typeof attrs.open !== 'boolean') {
      finding(
        findings,
        'invalid_canonical_document',
        'Details open attr must be a boolean',
        `${path}.attrs.open`
      );
    }
  }
  if (value.type === 'customEmoji') {
    // Only known names are allowed, so an unknown one fails here rather than rendering nothing.
    if (!isRichCustomEmojiName(attrs.name)) {
      finding(
        findings,
        'invalid_custom_emoji_name',
        `Custom emoji name must be one of: ${RICH_CUSTOM_EMOJI_NAMES.join(', ')}`,
        `${path}.attrs.name`,
        { name: typeof attrs.name === 'string' ? attrs.name : null }
      );
    }
  }
  if (value.type === 'blockMath' || value.type === 'inlineMath') {
    if (typeof attrs.latex !== 'string' || containsControlCharacter(attrs.latex)) {
      finding(
        findings,
        'invalid_math_expression',
        'Math node latex must be single-line text',
        `${path}.attrs.latex`
      );
    }
  }
  if (value.type === 'image') {
    const resourceId = requiredString(attrs, 'resourceId', path, findings);
    validateDisplayTitle(attrs, 'title', path, findings);
    requiredString(attrs, 'alt', path, findings);
    validateOptionalStructuralText(
      attrs.description,
      `${path}.attrs.description`,
      'Image description',
      findings
    );
    if (
      attrs.src !== undefined &&
      attrs.src !== null &&
      attrs.src !== `${RICH_RESOURCE_SCHEME}${resourceId ?? ''}`
    ) {
      finding(
        findings,
        'invalid_canonical_document',
        'Image src must match its typed resource or be null',
        `${path}.attrs.src`
      );
    }
    validateImageWidth(attrs.width, `${path}.attrs.width`, findings);
    validateUnspecifiedImageDimension(attrs.height, `${path}.attrs.height`, findings);
    // Optional alignment; null is the default placement.
    if (
      attrs.align !== undefined &&
      attrs.align !== null &&
      !(RICH_IMAGE_ALIGNMENTS as readonly string[]).includes(attrs.align as string)
    ) {
      finding(
        findings,
        'invalid_image_alignment',
        `Image align must be null or one of: ${RICH_IMAGE_ALIGNMENTS.join(', ')}`,
        `${path}.attrs.align`,
        { align: typeof attrs.align === 'string' ? attrs.align : null }
      );
    }
  }
  // Chips share the card's identity checks.
  if (value.type === 'resourceCard' || value.type === 'resourceChip') {
    requiredString(attrs, 'resourceId', path, findings);
    validateDisplayTitle(attrs, 'title', path, findings);
    requiredString(attrs, 'kind', path, findings);
    const selector = attrs.selector;
    if (
      typeof selector !== 'string' ||
      !['live', 'latest-approved', 'pinned', 'imported-copy'].includes(selector)
    ) {
      finding(findings, 'invalid_canonical_document', 'Invalid resource selector', path);
    }
  }
  if (value.type === 'resourceCard') {
    validateOptionalStructuralText(
      attrs.description,
      `${path}.attrs.description`,
      'Resource description',
      findings
    );
    // Optional presentation attrs: image bounds and values for width and align, single-line
    // caption, and the card/preview toggle.
    validateImageWidth(attrs.width, `${path}.attrs.width`, findings);
    // Optional pinned preview height; null derives it from the viewer.
    if (
      attrs.height !== undefined &&
      attrs.height !== null &&
      !isBoundedInteger(attrs.height, RICH_PREVIEW_HEIGHT_MIN, RICH_PREVIEW_HEIGHT_MAX)
    ) {
      finding(
        findings,
        'invalid_preview_height',
        `Resource card height must be null or an integer between ${RICH_PREVIEW_HEIGHT_MIN} and ${RICH_PREVIEW_HEIGHT_MAX} px`,
        `${path}.attrs.height`
      );
    }
    if (
      attrs.align !== undefined &&
      attrs.align !== null &&
      !(RICH_IMAGE_ALIGNMENTS as readonly string[]).includes(attrs.align as string)
    ) {
      finding(
        findings,
        'invalid_resource_card_presentation',
        `Resource card align must be null or one of: ${RICH_IMAGE_ALIGNMENTS.join(', ')}`,
        `${path}.attrs.align`,
        { align: typeof attrs.align === 'string' ? attrs.align : null }
      );
    }
    validateOptionalStructuralText(
      attrs.caption,
      `${path}.attrs.caption`,
      'Resource card caption',
      findings
    );
    if (
      attrs.presentation !== undefined &&
      attrs.presentation !== null &&
      !(RICH_RESOURCE_CARD_PRESENTATIONS as readonly string[]).includes(
        attrs.presentation as string
      )
    ) {
      finding(
        findings,
        'invalid_resource_card_presentation',
        `Resource card presentation must be one of: ${RICH_RESOURCE_CARD_PRESENTATIONS.join(', ')}`,
        `${path}.attrs.presentation`,
        { presentation: typeof attrs.presentation === 'string' ? attrs.presentation : null }
      );
    }
  }
  if (value.type === 'taskReference') {
    requiredString(attrs, 'taskId', path, findings);
    validateDisplayTitle(attrs, 'fallbackTitle', path, findings);
  }
  if (value.type === 'taskItem') {
    if (typeof attrs.checked !== 'boolean') {
      finding(findings, 'invalid_canonical_document', 'Task item checked must be boolean', path);
    }
    if (attrs.authority !== undefined && attrs.authority !== 'document_local') {
      finding(
        findings,
        'invalid_canonical_document',
        'Task items must remain document-local',
        path
      );
    }
  }
  if (value.type === 'tableHeader' || value.type === 'tableCell') {
    validateTableCellAttrs(attrs, path, findings);
  }

  // When present, a `blockId` must be well formed and unique in the document.
  if (attrs.blockId !== undefined && attrs.blockId !== null) {
    if (typeof attrs.blockId !== 'string' || !RICH_BLOCK_ID_PATTERN.test(attrs.blockId)) {
      finding(
        findings,
        'invalid_canonical_document',
        'blockId must be null or match b_<16 Crockford base32 characters>',
        `${path}.attrs.blockId`
      );
    } else {
      const existingPath = blockIds.get(attrs.blockId);
      if (existingPath !== undefined) {
        finding(
          findings,
          'duplicate_block_id',
          `Duplicate blockId also used at ${existingPath}`,
          path,
          { blockId: attrs.blockId }
        );
      } else {
        blockIds.set(attrs.blockId, path);
      }
    }
  }

  if (value.marks !== undefined) {
    if (!Array.isArray(value.marks)) {
      finding(findings, 'invalid_canonical_document', 'Node marks must be an array', path);
    } else {
      value.marks.forEach((mark, index) => validateMark(mark, `${path}.marks[${index}]`, findings));
    }
  }

  if (value.content !== undefined) {
    if (!Array.isArray(value.content)) {
      finding(findings, 'invalid_canonical_document', 'Node content must be an array', path);
    } else {
      value.content.forEach((child, index) =>
        validateNode(child, `${path}.content[${index}]`, findings, blockIds)
      );
    }
  }
  return findings.length === 0;
}

/**
 * The grammar requires at least one block (`doc` is `block+`), so a `doc`
 * root with no `content` or an empty `content` array (a title-only document)
 * is read as one empty paragraph. Anything else is returned unchanged for
 * {@link validateEditorDocument} to judge.
 */
export function normalizeEmptyEditorDocument(value: unknown): unknown {
  if (!isRecord(value) || value.type !== 'doc') return value;
  if (value.content === undefined || (Array.isArray(value.content) && value.content.length === 0)) {
    return { ...value, content: [{ type: 'paragraph' }] };
  }
  return value;
}

export function validateEditorDocument(value: unknown): {
  success: boolean;
  document: EditorDocument | null;
  findings: RichImportFinding[];
} {
  const findings: RichImportFinding[] = [];
  if (!isRecord(value) || value.type !== 'doc') {
    finding(
      findings,
      'invalid_canonical_document',
      'Rich editor content must have a doc root',
      '$'
    );
    return { success: false, document: null, findings };
  }
  validateNode(value, '$', findings, new Map());
  if (findings.length === 0) {
    try {
      const proseMirrorDocument = richProseMirrorSchema.nodeFromJSON(value);
      proseMirrorDocument.check();
    } catch (error) {
      finding(
        findings,
        'invalid_canonical_document',
        'Rich content violates the Tiptap document grammar',
        '$',
        { reason: error instanceof Error ? error.message : 'Unknown schema error' }
      );
    }
  }
  return {
    success: findings.length === 0,
    document: value as unknown as EditorDocument,
    findings
  };
}

export function assertEditorDocument(
  value: unknown
): asserts value is EditorDocument {
  const result = validateEditorDocument(value);
  if (!result.success) throw new EditorContractError(result.findings);
}
