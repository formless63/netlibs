import type { RichCalloutKind, EditorDocument, EditorNode } from './types.ts';
import { assertEditorDocument } from './validation.ts';

const CALLOUT_LABELS: Record<RichCalloutKind, string> = {
  note: 'Note',
  tip: 'Tip',
  important: 'Important',
  warning: 'Warning',
  caution: 'Caution'
};

function visibleNodeText(node: EditorNode): string[] {
  if (node.type === 'text') return node.text ? [node.text] : [];
  const values: string[] = [];
  const attrs = node.attrs ?? {};

  if (node.type === 'callout') {
    const kind = attrs.kind as RichCalloutKind;
    if (CALLOUT_LABELS[kind]) values.push(CALLOUT_LABELS[kind]);
    if (typeof attrs.title === 'string') values.push(attrs.title);
  }
  if (node.type === 'image') {
    if (typeof attrs.alt === 'string') values.push(attrs.alt);
    if (typeof attrs.title === 'string') values.push(attrs.title);
    if (typeof attrs.description === 'string') values.push(attrs.description);
  }
  if (node.type === 'resourceCard') {
    if (typeof attrs.title === 'string') values.push(attrs.title);
    if (typeof attrs.description === 'string') values.push(attrs.description);
  }
  // A chip is indexed by its title, like a card.
  if (node.type === 'resourceChip' && typeof attrs.title === 'string') {
    values.push(attrs.title);
  }
  if (node.type === 'taskReference' && typeof attrs.fallbackTitle === 'string') {
    values.push(attrs.fallbackTitle);
  }
  // A custom emoji is indexed by its shortcode.
  if (node.type === 'customEmoji' && typeof attrs.name === 'string') {
    values.push(`:${attrs.name}:`);
  }

  for (const child of node.content ?? []) values.push(...visibleNodeText(child));
  return values;
}

export function normalizeRichSearchText(value: string): string {
  return value.normalize('NFKC').replace(/\s+/g, ' ').trim();
}

export function extractRichSearchText(value: unknown, documentTitle?: string): string {
  assertEditorDocument(value);
  const parts = documentTitle ? [documentTitle] : [];
  for (const child of (value as EditorDocument).content ?? []) {
    parts.push(...visibleNodeText(child));
  }
  return normalizeRichSearchText(parts.join(' '));
}
