import { RICH_CALLOUT_COLORS } from './types.ts';
import type { EditorDocument, EditorMark, EditorNode } from './types.ts';
import { parseInlineMarkdown } from './importer.ts';
import { RICH_INLINE_MATH_PATTERN } from './inline-math.ts';
import { assertEditorDocument } from './validation.ts';

const BLOCK_SEPARATOR = '\n\n';

function text(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

// `^` and `~` are escaped because the importer reads `^…^` and `~…~` as superscript and subscript.
function escapeInline(value: string): string {
  const escaped = value
    .replace(/([\\`*_[\]<>~^])/g, '\\$1')
    // `&` only matters where it would be read as a character reference.
    .replace(/&(?=#?[A-Za-z0-9]+;)/g, '\\&');
  // Only prose that would be read back as `$math$` needs its dollars escaped.
  return RICH_INLINE_MATH_PATTERN().test(value) ? escaped.replace(/\$/g, '\\$') : escaped;
}

function escapeParagraphBlockStarts(value: string): string {
  return value
    .split('\n')
    .map((line) => {
      if (/^ {4}/.test(line)) return `${line.slice(0, 3)}&#32;${line.slice(4)}`;
      if (line.startsWith('\t')) return `&#9;${line.slice(1)}`;

      const prefix = line.match(/^ {0,3}/)?.[0] ?? '';
      const body = line.slice(prefix.length);
      if (/^#{1,6}(?:\s|$)/.test(body)) return `${prefix}\\${body}`;
      if (/^[+-](?:\s|$)/.test(body)) return `${prefix}\\${body}`;
      if (/^\d{1,9}[.)](?:\s|$)/.test(body)) {
        return `${prefix}${body.replace(/^(\d{1,9})([.)])/, '$1\\$2')}`;
      }
      if (/^:{2,}/.test(body)) return `${prefix}\\${body}`;
      if (/^(?:-{3,}|={1,})\s*$/.test(body)) return `${prefix}\\${body}`;
      return line;
    })
    .join('\n');
}

function longestRun(value: string, character: '`' | '~'): number {
  let longest = 0;
  let current = 0;
  for (const candidate of value) {
    if (candidate === character) {
      current += 1;
      longest = Math.max(longest, current);
    } else {
      current = 0;
    }
  }
  return longest;
}

function inlineCode(value: string): string {
  const delimiter = '`'.repeat(Math.max(1, longestRun(value, '`') + 1));
  const needsPadding =
    !/^ *$/.test(value) &&
    (value.startsWith(' ') || value.endsWith(' ') || value.startsWith('`') || value.endsWith('`'));
  const padding = needsPadding ? ' ' : '';
  return `${delimiter}${padding}${value}${padding}${delimiter}`;
}

function fencedCode(value: string, language: string): string {
  const backtickLength = Math.max(3, longestRun(value, '`') + 1);
  const tildeLength = Math.max(3, longestRun(value, '~') + 1);
  const useBackticks = !language.includes('`') && backtickLength <= tildeLength;
  const delimiter = (useBackticks ? '`' : '~').repeat(useBackticks ? backtickLength : tildeLength);
  return `${delimiter}${language}\n${value}\n${delimiter}`;
}

function escapeLinkTitle(value: string): string {
  return value.replace(/(["\\])/g, '\\$1');
}

function markdownLinkDestination(value: string): string {
  return /^[A-Za-z][A-Za-z0-9+.-]*:[A-Za-z0-9._~!$&'*,;=:@/?%#-]+$/.test(value) ||
    /^[/#][A-Za-z0-9._~!$&'*,;=:@/?%#-]+$/.test(value)
    ? value
    : `<${value}>`;
}

function attrs(node: EditorNode): Record<string, unknown> {
  return node.attrs ?? {};
}

function children(node: EditorNode): EditorNode[] {
  return node.content ?? [];
}

/** Serialized outermost first. Code, superscript and subscript wrap a single text run. */
const NESTED_MARKS = ['link', 'strike', 'italic', 'bold'] as const;
const ATTENTION_MARKS = new Set(['bold', 'italic', 'strike']);

function nestedMarks(node: EditorNode): EditorMark[] {
  return NESTED_MARKS.flatMap((type) => node.marks?.find((mark) => mark.type === type) ?? []);
}

function hasAttention(node: EditorNode | undefined): boolean {
  return node?.marks?.some((mark) => ATTENTION_MARKS.has(mark.type)) ?? false;
}

function markKey(mark: EditorMark): string {
  return mark.type === 'link'
    ? `link:${text(mark.attrs?.href)}:${text(mark.attrs?.title)}`
    : mark.type;
}

/** Text with its run-level marks. `comment` marks are annotations and leave no trace. */
function serializeTextRun(node: EditorNode): string {
  const types = new Set((node.marks ?? []).map((mark) => mark.type));
  const value = text(node.text);
  let output = types.has('code') ? inlineCode(value) : escapeInline(value);
  // Pandoc-style; the importer recovers these with a conservative text scan.
  if (types.has('superscript')) output = `^${output}^`;
  if (types.has('subscript')) output = `~${output}~`;
  return output;
}

function isWordCharacter(value: string | undefined): boolean {
  return value !== undefined && !/[\s\p{P}\p{S}]/u.test(value);
}

function characterReference(value: string): string {
  return `&#x${value.codePointAt(0)!.toString(16).toUpperCase()};`;
}

/**
 * Moves leading/trailing whitespace out of emphasis that opens or closes there
 * (`**bold **` is not bold in CommonMark) and merges runs with equal marks.
 */
function normalizeRuns(nodes: readonly EditorNode[]): EditorNode[] {
  const merged: EditorNode[] = [];
  const push = (node: EditorNode): void => {
    const previous = merged.at(-1);
    const marks = (candidate: EditorNode): string =>
      (candidate.marks ?? []).map(markKey).toSorted().join('|');
    if (previous?.type === 'text' && node.type === 'text' && marks(previous) === marks(node)) {
      merged[merged.length - 1] = { ...previous, text: text(previous.text) + text(node.text) };
    } else merged.push(node);
  };
  nodes.forEach((node, index) => {
    if (node.type !== 'text' || !hasAttention(node)) {
      push(node);
      return;
    }
    const value = text(node.text);
    const lead = /^\s*/.exec(value)![0];
    const core = value.slice(lead.length).trimEnd();
    const trail = value.slice(lead.length + core.length);
    const shared = (neighbour: EditorNode | undefined): EditorMark[] =>
      (node.marks ?? []).filter(
        (mark) =>
          !ATTENTION_MARKS.has(mark.type) ||
          neighbour?.marks?.some((other) => other.type === mark.type)
      );
    if (lead) push({ type: 'text', text: lead, marks: shared(nodes[index - 1]) });
    if (core) push({ ...node, text: core });
    if (trail) push({ type: 'text', text: trail, marks: shared(nodes[index + 1]) });
  });
  return merged;
}

interface InlineVariant {
  /** Use `_` for italic, so it never merges with a neighbouring `*` run. */
  underscore: boolean;
  /** Write word characters touching a delimiter as references, to satisfy flanking rules. */
  references: boolean;
}

function renderInline(nodes: readonly EditorNode[], variant: InlineVariant): string {
  const opener = (mark: EditorMark): string => {
    if (mark.type === 'link') return '[';
    if (mark.type === 'bold') return '**';
    if (mark.type === 'italic') return variant.underscore ? '_' : '*';
    return '~~';
  };
  const closer = (mark: EditorMark): string => {
    if (mark.type !== 'link') return opener(mark);
    const title = text(mark.attrs?.title);
    return `](${markdownLinkDestination(text(mark.attrs?.href))}${
      title ? ` "${escapeLinkTitle(title)}"` : ''
    })`;
  };
  const stack: EditorMark[] = [];
  let output = '';
  nodes.forEach((node, index) => {
    const target = node.type === 'text' ? nestedMarks(node) : [];
    let common = 0;
    while (
      common < stack.length &&
      common < target.length &&
      markKey(stack[common]!) === markKey(target[common]!)
    ) {
      common += 1;
    }
    while (stack.length > common) output += closer(stack.pop()!);
    for (const mark of target.slice(common)) {
      output += opener(mark);
      stack.push(mark);
    }
    if (node.type !== 'text') {
      output += serializeInlineNode(node);
      return;
    }
    let run = serializeTextRun(node);
    if (variant.references && !node.marks?.length) {
      const characters = [...text(node.text)];
      const first = characters[0];
      const last = characters.at(-1);
      if (hasAttention(nodes[index + 1]) && isWordCharacter(last) && run.endsWith(last!)) {
        run = run.slice(0, -last!.length) + characterReference(last!);
      }
      if (hasAttention(nodes[index - 1]) && isWordCharacter(first) && run.startsWith(first!)) {
        run = characterReference(first!) + run.slice(first!.length);
      }
    }
    output += run;
  });
  while (stack.length > 0) output += closer(stack.pop()!);
  return output;
}

/** Comparable form of inline content: runs keyed by their Markdown-visible marks. */
function projectInline(nodes: readonly EditorNode[]): string {
  const parts: string[] = [];
  let lastKey: string | null = null;
  for (const node of nodes) {
    if (node.type !== 'text') {
      parts.push(`<${node.type}>`);
      lastKey = null;
      continue;
    }
    const key = (node.marks ?? [])
      .filter((mark) => mark.type !== 'comment')
      .map((mark) => mark.type)
      .toSorted()
      .join('+');
    if (key === lastKey) parts[parts.length - 1] += text(node.text);
    else parts.push(`${key}\u0000${text(node.text)}`);
    lastKey = key;
  }
  return parts.join('\u0001');
}

/** True where delimiters touch something that can change how they are read. */
function needsVerification(nodes: readonly EditorNode[]): boolean {
  return nodes.some((node, index) => {
    if (!hasAttention(node)) return false;
    const previous = nodes[index - 1];
    const next = nodes[index + 1];
    return (
      hasAttention(previous) ||
      hasAttention(next) ||
      isWordCharacter([...text(previous?.text)].at(-1)) ||
      isWordCharacter([...text(next?.text)][0])
    );
  });
}

const INLINE_VARIANTS: readonly InlineVariant[] = [
  { underscore: false, references: false },
  { underscore: true, references: false },
  { underscore: false, references: true },
  { underscore: true, references: true }
];

/** Renders inline content in the plainest form that reads back as the same runs. */
function serializeInline(node: EditorNode): string {
  const nodes = normalizeRuns(children(node));
  const plainest = renderInline(nodes, INLINE_VARIANTS[0]!);
  if (!needsVerification(nodes)) return plainest;
  const expected = projectInline(nodes);
  for (const variant of INLINE_VARIANTS) {
    const rendered = renderInline(nodes, variant);
    const reparsed = parseInlineMarkdown(escapeParagraphBlockStarts(rendered));
    if (reparsed && projectInline(reparsed) === expected) return rendered;
  }
  // No delimiter spelling works: keep the text exactly, give up the emphasis.
  return renderInline(
    nodes.map((run) =>
      run.marks
        ? { ...run, marks: run.marks.filter((mark) => !ATTENTION_MARKS.has(mark.type)) }
        : run
    ),
    INLINE_VARIANTS[0]!
  );
}

function serializeInlineNode(node: EditorNode): string {
  if (node.type === 'text') return serializeTextRun(node);
  if (node.type === 'hardBreak') return '  \n';
  // Inline math round-trips as `$latex$` (documented convention). The importer
  // recovers it with a conservative `$…$` scan over text nodes.
  if (node.type === 'inlineMath') return `$${text(attrs(node).latex)}$`;
  // Round-trips as `:shortcode:`; names are `[a-z0-9]+`, so no escaping is needed.
  if (node.type === 'customEmoji') return `:${text(attrs(node).name)}:`;
  // Round-trips as `[title](rich-resource:id)`; kind and selector come from the reference manifest.
  if (node.type === 'resourceChip') {
    const nodeAttrs = attrs(node);
    return `[${escapeInline(text(nodeAttrs.title))}](rich-resource:${text(nodeAttrs.resourceId)})`;
  }
  return children(node).map(serializeInlineNode).join('');
}

function serializeListItem(node: EditorNode, marker: string, contentColumn: number): string {
  const blocks = children(node);
  // An item that opens with an empty paragraph puts its next block on the
  // marker line (`- - nested`); the importer restores the paragraph.
  const leadEmpty =
    blocks.length > 1 && blocks[0]!.type === 'paragraph' && children(blocks[0]!).length === 0;
  const body = serializeBlocks(leadEmpty ? blocks.slice(1) : blocks);
  // Continuation lines align with the item's content column, so nesting stays
  // nesting at any depth and for any marker width.
  const indent = ' '.repeat(contentColumn);
  return body
    .split('\n')
    .map((line, index) => (index === 0 ? `${marker}${line}`.trimEnd() : line && indent + line))
    .join('\n');
}

const LIST_TYPES = new Set(['bulletList', 'orderedList', 'taskList']);

function serializeList(node: EditorNode, alternate: boolean): string {
  const bullet = alternate ? '*' : '-';
  const start = Number(attrs(node).start ?? 1);
  return children(node)
    .map((child, index) => {
      if (node.type === 'orderedList') {
        const marker = `${start + index}${alternate ? ')' : '.'} `;
        return serializeListItem(child, marker, marker.length);
      }
      const box =
        node.type === 'taskList' ? (attrs(child).checked === true ? '[x] ' : '[ ] ') : '';
      return serializeListItem(child, `${bullet} ${box}`, 2);
    })
    .join('\n');
}

/** Joins sibling blocks, alternating list markers so adjacent lists stay separate lists. */
function serializeBlocks(nodes: readonly EditorNode[]): string {
  let alternate = false;
  return nodes
    .map((node, index) => {
      alternate = LIST_TYPES.has(node.type) && nodes[index - 1]?.type === node.type && !alternate;
      return LIST_TYPES.has(node.type) ? serializeList(node, alternate) : serializeBlock(node);
    })
    .join(BLOCK_SEPARATOR);
}

function serializeTable(node: EditorNode): string {
  const rows = children(node).map((row) =>
    children(row).map((cell) =>
      children(cell)
        .map((block) => serializeBlock(block))
        .join('<br>')
        .replace(/ {2}\n/g, '<br>')
        .replace(/\s+/g, ' ')
        .trim()
        .replace(/\|/g, '\\|')
    )
  );
  if (rows.length === 0) return '';
  const width = Math.max(...rows.map((row) => row.length));
  const normalized = rows.map((row) => [
    ...row,
    ...Array.from({ length: width - row.length }, () => '')
  ]);
  return [
    `| ${normalized[0].join(' | ')} |`,
    `| ${Array.from({ length: width }, () => '---').join(' | ')} |`,
    ...normalized.slice(1).map((row) => `| ${row.join(' | ')} |`)
  ].join('\n');
}

function serializeCalloutBody(node: EditorNode): string {
  return serializeBlocks(children(node)).trimEnd();
}

function serializeCallout(node: EditorNode): string {
  const rawColor = text(attrs(node).color);
  const color = (RICH_CALLOUT_COLORS as readonly string[]).includes(rawColor) ? rawColor : '';
  const kind = text(attrs(node).kind);
  const title = text(attrs(node).title).trim();
  const body = serializeCalloutBody(node);

  // GitHub alerts carry no color, so a colored callout becomes a `:::kind[Title]{color=X}`
  // container. An uncolored one stays a GitHub alert.
  if (color) {
    const label = title ? `[${title.replace(/\]/g, '\\]')}]` : '';
    const header = `:::${kind}${label}{color=${color}}`;
    return body ? `${header}\n\n${body}\n\n:::` : `${header}\n\n:::`;
  }

  const header = `> [!${kind.toUpperCase()}]${title ? ` ${escapeInline(title)}` : ''}`;
  if (!body) return header;
  // `> [!TIP]` directly above `> ---` would be a setext heading, above a list or
  // fence a lazy continuation; only a paragraph may follow without a break.
  const separator = children(node)[0]?.type === 'paragraph' && body.trimStart() === body ? '' : '>\n';
  const quoted = body
    .split('\n')
    .map((line) => (line.length > 0 ? `> ${line}` : '>'))
    .join('\n');
  return `${header}\n${separator}${quoted}`;
}

function serializeDetails(node: EditorNode): string {
  const summaryNode = children(node).find((child) => child.type === 'detailsSummary');
  const contentNode = children(node).find((child) => child.type === 'detailsContent');
  const summary = summaryNode ? serializeInline(summaryNode).trim() : '';
  const label = summary ? `[${summary.replace(/\]/g, '\\]')}]` : '';
  const body = contentNode
    ? serializeBlocks(children(contentNode)).trimEnd()
    : '';
  // Toggles export as a `:::details[Summary]` container.
  return body ? `:::details${label}\n\n${body}\n\n:::` : `:::details${label}\n\n:::`;
}

function serializeBlock(node: EditorNode): string {
  switch (node.type) {
    case 'paragraph':
      return escapeParagraphBlockStarts(serializeInline(node));
    case 'heading': {
      const level = Math.min(6, Math.max(1, Number(attrs(node).level ?? 1)));
      const anchor = text(attrs(node).anchorId);
      // A heading is one line, and a trailing ` #` run would read as its closing sequence.
      const inline = serializeInline(node)
        .replace(/ {2}\n/g, ' ')
        .replace(/(^| )(#+)$/, '$1\\$2');
      const unambiguousInline = anchor
        ? inline
        : inline.replace(/ \{#([A-Za-z][A-Za-z0-9_-]*)\}$/, ' \\{#$1}');
      return `${'#'.repeat(level)} ${unambiguousInline}${anchor ? ` {#${anchor}}` : ''}`;
    }
    case 'orderedList':
    case 'bulletList':
    case 'taskList':
      return serializeList(node, false);
    case 'blockquote': {
      const body = serializeBlocks(children(node)).trimEnd();
      return body
        .split('\n')
        .map((line) => (line ? `> ${line}` : '>'))
        .join('\n');
    }
    case 'horizontalRule':
      return '---';
    case 'table':
      return serializeTable(node);
    case 'codeBlock': {
      const language = text(attrs(node).language);
      const source = children(node)
        .map((child) => text(child.text))
        .join('');
      return fencedCode(source, language);
    }
    case 'callout':
      return serializeCallout(node);
    case 'image': {
      const nodeAttrs = attrs(node);
      const alt = text(nodeAttrs.alt).replace(/[[\]]/g, '');
      const resourceId = text(nodeAttrs.resourceId);
      const description = text(nodeAttrs.description);
      // Width is a trailing ` =WIDTH` in the title. Height follows the ratio and is not stored.
      const width = typeof nodeAttrs.width === 'number' ? nodeAttrs.width : null;
      const titleSlot = [description ? escapeLinkTitle(description) : '', width ? `=${width}` : '']
        .filter(Boolean)
        .join(' ');
      return `![${alt}](rich-resource:${resourceId}${titleSlot ? ` "${titleSlot}"` : ''})`;
    }
    case 'details':
      return serializeDetails(node);
    case 'blockMath':
      // Block math exports as a fenced ```math code block so it round-trips
      // through the existing remark pipeline with no extra parser (documented
      // convention). Inline math uses `$…$` (see serializeInlineNode).
      return fencedCode(text(attrs(node).latex), 'math');
    case 'childrenIndex':
      // `/tree` marker — exports as a `:::tree` directive container so it
      // round-trips; renders the live child listing only on the published view.
      return ':::tree\n\n:::';
    case 'resourceCard': {
      const nodeAttrs = attrs(node);
      return `[Resource: ${escapeInline(text(nodeAttrs.title))}](rich-resource:${text(
        nodeAttrs.resourceId
      )})`;
    }
    case 'taskReference': {
      const nodeAttrs = attrs(node);
      return `[Task: ${escapeInline(text(nodeAttrs.fallbackTitle))}](rich-task:${text(
        nodeAttrs.taskId
      )})`;
    }
    default:
      return serializeBlocks(children(node));
  }
}

export function serializeMarkdown(value: unknown): string {
  assertEditorDocument(value);
  const body = serializeBlocks((value as EditorDocument).content ?? []).trimEnd();
  return `${body}\n`;
}
