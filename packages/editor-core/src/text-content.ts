import type { DocumentContent, JsonValue } from "./json.ts";

/**
 * A small, dependency-free Markdown dialect for short notes written by programs.
 *
 * - blocks: paragraphs (every newline is a hard break), ATX headings, bullet/ordered/task lists
 *   nested by indentation (2 or 4 spaces), fenced code, GitHub tables, block quotes and horizontal
 *   rules;
 * - inline: `**bold**`, `*italic*`/`_italic_`, `~~strike~~`, backtick code, `[text](url)` and
 *   `<url>` links (http, https, mailto, `/path` and `#anchor` only) and backslash escapes.
 *
 * `documentToText` is the inverse: parsing its output returns the same document for every construct
 * above.
 */

type Node = { [key: string]: JsonValue };
type Mark = { type: string; attrs?: { [key: string]: JsonValue } };

/** Nesting bound for lists, quotes and inline marks; deeper input stays text. */
const MAX_DEPTH = 24;
/** Longest link destination or title considered; longer ones stay literal text. */
const DESTINATION_LIMIT = 2048;

// ---------------------------------------------------------------------------
// Inline parsing
// ---------------------------------------------------------------------------

const ASCII_PUNCTUATION = /[!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~]/;

function isSpace(char: string | undefined): boolean {
  return char === undefined || /\s/.test(char);
}

function isPunctuation(char: string | undefined): boolean {
  return char !== undefined && /[\p{P}\p{S}]/u.test(char);
}

function leftFlanking(previous: string | undefined, next: string | undefined): boolean {
  return !isSpace(next) && (!isPunctuation(next) || isSpace(previous) || isPunctuation(previous));
}

function rightFlanking(previous: string | undefined, next: string | undefined): boolean {
  return !isSpace(previous) && (!isPunctuation(previous) || isSpace(next) || isPunctuation(next));
}

function canOpen(char: string, previous: string | undefined, next: string | undefined): boolean {
  const left = leftFlanking(previous, next);
  if (char !== "_") return left;
  return left && (!rightFlanking(previous, next) || isPunctuation(previous));
}

function canClose(char: string, previous: string | undefined, next: string | undefined): boolean {
  const right = rightFlanking(previous, next);
  if (char !== "_") return right;
  return right && (!leftFlanking(previous, next) || isPunctuation(next));
}

function runLength(text: string, start: number, char: string): number {
  let end = start;
  while (text[end] === char) end += 1;
  return end - start;
}

function firstAtLeast(list: readonly number[] | undefined, value: number): number {
  if (!list) return -1;
  let low = 0;
  let high = list.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (list[middle]! < value) low = middle + 1;
    else high = middle;
  }
  return low < list.length ? list[low]! : -1;
}

/**
 * Positions computed once per inline run so that every opener finds its closer
 * by lookup: hostile input (thousands of unmatched `*`, `[` or backticks)
 * stays near-linear instead of rescanning the text for each opener.
 */
interface InlineIndex {
  /** Backtick run length → start positions (raw; escapes do not apply inside code). */
  backticks: Map<number, number[]>;
  /** `[` position → its matching `]`, outside escapes and code spans. */
  brackets: Map<number, number>;
  /** `<char><run length>` → positions of delimiter runs that can close emphasis. */
  closers: Map<string, number[]>;
}

function codeSpanClose(index: InlineIndex, from: number, length: number): number {
  return firstAtLeast(index.backticks.get(length), from);
}

function buildInlineIndex(text: string): InlineIndex {
  const backticks = new Map<number, number[]>();
  for (let position = 0; position < text.length; ) {
    if (text[position] !== "`") {
      position += 1;
      continue;
    }
    const run = runLength(text, position, "`");
    const list = backticks.get(run) ?? [];
    list.push(position);
    backticks.set(run, list);
    position += run;
  }
  const index: InlineIndex = { backticks, brackets: new Map(), closers: new Map() };
  const open: number[] = [];
  let position = 0;
  while (position < text.length) {
    const char = text[position]!;
    if (char === "\\" && position + 1 < text.length && ASCII_PUNCTUATION.test(text[position + 1]!)) {
      position += 2;
    } else if (char === "`") {
      const run = runLength(text, position, "`");
      const close = codeSpanClose(index, position + run, run);
      position = close >= 0 ? close + run : position + run;
    } else if (char === "[") {
      open.push(position);
      position += 1;
    } else if (char === "]") {
      const start = open.pop();
      if (start !== undefined) index.brackets.set(start, position);
      position += 1;
    } else if (char === "*" || char === "_" || char === "~") {
      const run = runLength(text, position, char);
      if (canClose(char, text[position - 1], text[position + run])) {
        const key = `${char}${run}`;
        const list = index.closers.get(key) ?? [];
        list.push(position);
        index.closers.set(key, list);
      }
      position += run;
    } else {
      position += 1;
    }
  }
  return index;
}

/**
 * The canonical form of a link destination the editor accepts (http, https,
 * mailto, a site-relative `/path` or a `#anchor`), or null for anything else.
 */
export function canonicalLinkHref(raw: string): string | null {
  const href = raw.trim();
  const control = [...href].some((char) => char.charCodeAt(0) < 0x20 || char.charCodeAt(0) === 0x7f);
  if (href.length === 0 || control || /\s/.test(href)) return null;
  if (href.startsWith("#")) return /^#[A-Za-z][A-Za-z0-9_-]*$/.test(href) ? href : null;
  if (href.startsWith("//") || href.includes("\\")) return null;
  if (href.startsWith("/")) {
    try {
      const parsed = new URL(href, "https://document.invalid");
      return `${parsed.pathname}${parsed.search}${parsed.hash}`;
    } catch {
      return null;
    }
  }
  try {
    const parsed = new URL(href);
    return ["http:", "https:", "mailto:"].includes(parsed.protocol) ? parsed.toString() : null;
  } catch {
    return null;
  }
}

interface ParsedLink {
  label: string;
  href: string;
  title: string | null;
  end: number;
}

function parseLink(text: string, start: number, index: InlineIndex): ParsedLink | null {
  const labelEnd = index.brackets.get(start) ?? -1;
  const limit = Math.min(text.length, labelEnd + 2 + DESTINATION_LIMIT);
  if (labelEnd < 0 || text[labelEnd + 1] !== "(") return null;
  let cursor = labelEnd + 2;
  while (text[cursor] === " ") cursor += 1;
  let destination: string;
  if (text[cursor] === "<") {
    const close = text.indexOf(">", cursor + 1);
    if (close < 0 || close > limit) return null;
    destination = text.slice(cursor + 1, close);
    cursor = close + 1;
  } else {
    let parens = 0;
    const begin = cursor;
    while (cursor < limit) {
      const char = text[cursor]!;
      if (/\s/.test(char)) break;
      if (char === "(") parens += 1;
      if (char === ")") {
        if (parens === 0) break;
        parens -= 1;
      }
      cursor += 1;
    }
    destination = text.slice(begin, cursor);
  }
  while (text[cursor] === " ") cursor += 1;
  let title: string | null = null;
  const quote = text[cursor];
  if (quote === '"' || quote === "'") {
    let close = cursor + 1;
    while (close < limit && text[close] !== quote) close += text[close] === "\\" ? 2 : 1;
    if (close >= limit) return null;
    title = text.slice(cursor + 1, close).replace(/\\(.)/g, "$1");
    cursor = close + 1;
    while (text[cursor] === " ") cursor += 1;
  }
  if (text[cursor] !== ")") return null;
  const href = canonicalLinkHref(destination);
  if (!href) return null;
  return { label: text.slice(start + 1, labelEnd), href, title, end: cursor + 1 };
}

interface ParsedEmphasis {
  inner: string;
  marks: Mark[];
  end: number;
}

function emphasisMarks(char: string, run: number): Mark[] {
  if (char === "~") return [{ type: "strike" }];
  if (run === 1) return [{ type: "italic" }];
  if (run === 2) return [{ type: "bold" }];
  return [{ type: "bold" }, { type: "italic" }];
}

function parseEmphasis(
  text: string,
  start: number,
  char: string,
  run: number,
  index: InlineIndex,
): ParsedEmphasis | null {
  if (char === "~" ? run !== 2 : run > 3) return null;
  if (!canOpen(char, text[start - 1], text[start + run])) return null;
  // Runs are maximal, so the next closer of the same length leaves a non-empty inner text.
  const close = firstAtLeast(index.closers.get(`${char}${run}`), start + run + 1);
  if (close < 0) return null;
  return { inner: text.slice(start + run, close), marks: emphasisMarks(char, run), end: close + run };
}

function sameMarks(a: readonly Mark[], b: readonly Mark[]): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

const PARSED_MARK_ORDER = ["link", "bold", "italic", "strike", "code"];

function pushText(out: Node[], text: string, unordered: readonly Mark[]): void {
  if (text.length === 0) return;
  // One canonical mark order, however the delimiters were nested.
  const marks = [...unordered].sort(
    (a, b) => PARSED_MARK_ORDER.indexOf(a.type) - PARSED_MARK_ORDER.indexOf(b.type),
  );
  const last = out[out.length - 1];
  const lastMarks = (last?.marks as Mark[] | undefined) ?? [];
  if (last?.type === "text" && sameMarks(lastMarks, marks)) {
    last.text = `${last.text as string}${text}`;
    return;
  }
  out.push(marks.length > 0 ? { type: "text", text, marks } : { type: "text", text });
}

function addMarks(marks: readonly Mark[], extra: readonly Mark[]): Mark[] {
  const result = [...marks];
  for (const mark of extra) if (!result.some((existing) => existing.type === mark.type)) result.push(mark);
  return result;
}

interface InlineOptions {
  /** Table cells: `<br>` is a hard break and `\|` a literal pipe inside code. */
  cell: boolean;
}

function parseInlineInto(text: string, marks: readonly Mark[], out: Node[], options: InlineOptions, depth: number): void {
  let buffer = "";
  const flush = () => {
    pushText(out, buffer, marks);
    buffer = "";
  };
  const inlineIndex = buildInlineIndex(text);
  let index = 0;
  while (index < text.length) {
    const char = text[index]!;
    if (char === "\\" && index + 1 < text.length && ASCII_PUNCTUATION.test(text[index + 1]!)) {
      buffer += text[index + 1];
      index += 2;
      continue;
    }
    if (char === "\n") {
      flush();
      out.push({ type: "hardBreak" });
      index += 1;
      continue;
    }
    if (char === "`") {
      const run = runLength(text, index, "`");
      const close = codeSpanClose(inlineIndex, index + run, run);
      if (close < 0) {
        buffer += text.slice(index, index + run);
        index += run;
        continue;
      }
      flush();
      let code = text.slice(index + run, close).replace(/\n/g, " ");
      if (options.cell) code = code.replace(/\\\|/g, "|");
      if (code.length >= 2 && code.startsWith(" ") && code.endsWith(" ") && code.trim() !== "") {
        code = code.slice(1, -1);
      }
      // The editor's code mark excludes every other mark.
      pushText(out, code, [{ type: "code" }]);
      index = close + run;
      continue;
    }
    if (char === "<") {
      const rest = text.slice(index, index + 2048);
      const lineBreak = options.cell ? /^<br\s*\/?>/i.exec(rest) : null;
      if (lineBreak) {
        flush();
        out.push({ type: "hardBreak" });
        index += lineBreak[0].length;
        continue;
      }
      const autolink = /^<((?:https?:\/\/|mailto:)[^\s<>]+)>/i.exec(rest);
      const href = autolink ? canonicalLinkHref(autolink[1]!) : null;
      if (autolink && href && !marks.some((mark) => mark.type === "link")) {
        flush();
        pushText(out, autolink[1]!, addMarks(marks, [{ type: "link", attrs: { href } }]));
        index += autolink[0].length;
        continue;
      }
    }
    if (char === "[" && depth < MAX_DEPTH && !marks.some((mark) => mark.type === "link")) {
      const link = parseLink(text, index, inlineIndex);
      if (link) {
        flush();
        const attrs: { [key: string]: JsonValue } = { href: link.href };
        if (link.title) attrs.title = link.title;
        parseInlineInto(link.label, addMarks(marks, [{ type: "link", attrs }]), out, options, depth + 1);
        index = link.end;
        continue;
      }
    }
    if ((char === "*" || char === "_" || char === "~") && depth < MAX_DEPTH) {
      const run = runLength(text, index, char);
      const emphasis = parseEmphasis(text, index, char, run, inlineIndex);
      if (emphasis) {
        flush();
        parseInlineInto(emphasis.inner, addMarks(marks, emphasis.marks), out, options, depth + 1);
        index = emphasis.end;
        continue;
      }
      buffer += text.slice(index, index + run);
      index += run;
      continue;
    }
    buffer += char;
    index += 1;
  }
  flush();
}

function parseInline(text: string, options: InlineOptions = { cell: false }): Node[] {
  const out: Node[] = [];
  parseInlineInto(text, [], out, options, 0);
  return out;
}

// ---------------------------------------------------------------------------
// Block parsing
// ---------------------------------------------------------------------------

const TABLE_DIVIDER = /^\s*\|?\s*:?-{1,}:?\s*(\|\s*:?-{1,}:?\s*)*\|?\s*$/;
const LIST_ITEM = /^( *)(?:([-*+])|(\d{1,9})([.)]))(?:( +)(.*))?$/;
const HEADING = /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?(?:[ \t]+#+)?[ \t]*$/;
const FENCE_OPEN = /^( *)(`{3,}|~{3,})(.*)$/;
const RULE = /^\s*([-*_])(\s*\1){2,}\s*$/;
const TASK_BOX = /^\[( |x|X)\](?: +(.*)|$)/;

interface ListMarker {
  indent: number;
  ordered: boolean;
  start: number;
  /** Column where the item's content begins. */
  content: number;
  rest: string;
}

function listMarker(line: string): ListMarker | null {
  if (RULE.test(line)) return null;
  const match = LIST_ITEM.exec(line);
  if (!match) return null;
  const ordered = match[3] !== undefined;
  const spaces = match[5]?.length ?? 0;
  // An ordered marker needs a following space; a lone bullet ("-") is an empty item.
  if (ordered && spaces === 0) return null;
  const indent = match[1]!.length;
  const markerWidth = ordered ? match[3]!.length + 1 : 1;
  return {
    indent,
    ordered,
    start: ordered ? Math.max(1, Number(match[3])) : 1,
    content: indent + markerWidth + Math.min(Math.max(spaces, 1), 4),
    rest: match[6] ?? "",
  };
}

interface Fence {
  char: string;
  length: number;
  indent: number;
  language: string | null;
}

function fenceOpen(line: string): Fence | null {
  const match = FENCE_OPEN.exec(line);
  if (!match) return null;
  const marker = match[2]!;
  const info = match[3]!.trim();
  if (marker[0] === "`" && info.includes("`")) return null;
  const language = info.split(/\s+/)[0] ?? "";
  return { char: marker[0]!, length: marker.length, indent: match[1]!.length, language: language || null };
}

function closesFence(line: string, fence: Fence): boolean {
  const trimmed = line.trim();
  return trimmed.length >= fence.length && runLength(trimmed, 0, fence.char) === trimmed.length;
}

function indentOf(line: string): number {
  return line.length - line.trimStart().length;
}

function stripIndent(line: string, columns: number): string {
  let index = 0;
  while (index < columns && line[index] === " ") index += 1;
  return line.slice(index);
}

function expandLeadingTabs(line: string): string {
  const match = /^[ \t]+/.exec(line);
  if (!match || !match[0].includes("\t")) return line;
  let width = 0;
  for (const char of match[0]) width = char === "\t" ? width + 4 - (width % 4) : width + 1;
  return " ".repeat(width) + line.slice(match[0].length);
}

function paragraphNode(text: string, options?: InlineOptions): Node {
  const normalized = text
    .split("\n")
    .map((line) => line.trim())
    .join("\n");
  const content = parseInline(normalized, options);
  return content.length > 0 ? { type: "paragraph", content } : { type: "paragraph" };
}

function splitTableRow(line: string): string[] {
  let value = line.trim();
  if (value.startsWith("|")) value = value.slice(1);
  if (value.endsWith("|") && !value.endsWith("\\|")) value = value.slice(0, -1);
  const cells: string[] = [];
  let current = "";
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index]!;
    if (char === "\\" && value[index + 1] === "|") {
      current += "\\|";
      index += 1;
    } else if (char === "|") {
      cells.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }
  cells.push(current.trim());
  return cells;
}

function cell(type: "tableHeader" | "tableCell", text: string): Node {
  return { type, content: [paragraphNode(text, { cell: true })] };
}

function startsBlock(line: string): boolean {
  return fenceOpen(line) !== null || HEADING.test(line) || listMarker(line) !== null;
}

function parseList(lines: string[], start: number, depth: number): { node: Node; next: number } {
  const first = listMarker(lines[start]!)!;
  const items: string[][] = [];
  let index = start;
  while (index < lines.length) {
    const marker = listMarker(lines[index]!);
    if (!marker || marker.ordered !== first.ordered) break;
    const itemLines = [marker.rest];
    let fence = fenceOpen(marker.rest);
    index += 1;
    while (index < lines.length) {
      const line = lines[index]!;
      const stripped = stripIndent(line, marker.content);
      if (fence) {
        // Everything up to the closing fence belongs to the item, whatever its indentation.
        itemLines.push(stripped);
        if (closesFence(stripped, fence)) fence = null;
        index += 1;
        continue;
      }
      if (line.trim() === "") {
        let next = index;
        while (next < lines.length && lines[next]!.trim() === "") next += 1;
        if (next >= lines.length || indentOf(lines[next]!) <= marker.indent) break;
        for (let blank = index; blank < next; blank += 1) itemLines.push("");
        index = next;
        continue;
      }
      // Any line indented past the marker continues the item (nested list, fence or text).
      if (indentOf(line) <= marker.indent) break;
      itemLines.push(stripped);
      fence = fenceOpen(stripped);
      index += 1;
    }
    items.push(itemLines);
    // A loose list ("1. a", blank line, "2. b") stays one list, so its numbering continues.
    let next = index;
    while (next < lines.length && lines[next]!.trim() === "") next += 1;
    const resumed = next < lines.length ? listMarker(lines[next]!) : null;
    if (next > index && resumed && resumed.ordered === first.ordered) index = next;
  }
  const task = !first.ordered && items.every((item) => TASK_BOX.test(item[0]!.trim()));
  const content = items.map((itemLines): JsonValue => {
    let checked = false;
    if (task) {
      const box = TASK_BOX.exec(itemLines[0]!.trim())!;
      checked = box[1] !== " ";
      itemLines[0] = box[2] ?? "";
    }
    const blocks =
      depth + 1 >= MAX_DEPTH ? [paragraphNode(itemLines.join("\n"))] : parseBlocks(itemLines, depth + 1);
    // The editor's list items start with a paragraph.
    if ((blocks[0] as Node | undefined)?.type !== "paragraph") blocks.unshift({ type: "paragraph" });
    return task ? { type: "taskItem", attrs: { checked }, content: blocks } : { type: "listItem", content: blocks };
  });
  const node: Node = task
    ? { type: "taskList", content }
    : first.ordered
      ? { type: "orderedList", attrs: { start: first.start }, content }
      : { type: "bulletList", content };
  return { node, next: index };
}

function parseBlocks(lines: string[], depth: number): JsonValue[] {
  const blocks: JsonValue[] = [];
  let index = 0;
  while (index < lines.length) {
    const line = lines[index]!;
    if (line.trim() === "") {
      index += 1;
      continue;
    }
    const fence = fenceOpen(line);
    if (fence) {
      const body: string[] = [];
      index += 1;
      while (index < lines.length && !closesFence(lines[index]!, fence)) {
        body.push(stripIndent(lines[index]!, fence.indent));
        index += 1;
      }
      index += 1;
      const code = body.join("\n");
      blocks.push({
        type: "codeBlock",
        attrs: { language: fence.language },
        ...(code ? { content: [{ type: "text", text: code }] } : {}),
      });
      continue;
    }
    const heading = HEADING.exec(line);
    if (heading) {
      const title = parseInline(heading[2] ?? "");
      blocks.push({
        type: "heading",
        attrs: { level: heading[1]!.length },
        ...(title.length > 0 ? { content: title } : {}),
      });
      index += 1;
      continue;
    }
    if (RULE.test(line)) {
      blocks.push({ type: "horizontalRule" });
      index += 1;
      continue;
    }
    if (line.includes("|") && index + 1 < lines.length && TABLE_DIVIDER.test(lines[index + 1]!)) {
      const header = splitTableRow(line);
      const rows: string[][] = [];
      index += 2;
      while (index < lines.length && lines[index]!.includes("|") && lines[index]!.trim() !== "") {
        rows.push(splitTableRow(lines[index]!));
        index += 1;
      }
      const width = header.length;
      blocks.push({
        type: "table",
        content: [
          { type: "tableRow", content: header.map((value) => cell("tableHeader", value)) },
          ...rows.map((row) => ({
            type: "tableRow",
            content: Array.from({ length: width }, (_, column) => cell("tableCell", row[column] ?? "")),
          })),
        ],
      });
      continue;
    }
    if (listMarker(line)) {
      const list = parseList(lines, index, depth);
      blocks.push(list.node);
      index = list.next;
      continue;
    }
    if (line.trimStart().startsWith(">")) {
      const quoted: string[] = [];
      while (index < lines.length && lines[index]!.trimStart().startsWith(">")) {
        quoted.push(lines[index]!.trimStart().replace(/^>\s?/, ""));
        index += 1;
      }
      const inner = depth + 1 >= MAX_DEPTH ? [paragraphNode(quoted.join("\n"))] : parseBlocks(quoted, depth + 1);
      blocks.push({ type: "blockquote", content: inner.length > 0 ? inner : [{ type: "paragraph" }] });
      continue;
    }
    const paragraphLines = [line];
    index += 1;
    while (index < lines.length && lines[index]!.trim() !== "" && !startsBlock(lines[index]!)) {
      paragraphLines.push(lines[index]!);
      index += 1;
    }
    blocks.push(paragraphNode(paragraphLines.join("\n")));
  }
  return blocks;
}

export function textToDocument(input: string): DocumentContent {
  const lines = input.replace(/\r\n?/g, "\n").split("\n").map(expandLeadingTabs);
  const blocks = parseBlocks(lines, 0);
  return { type: "doc", content: blocks.length > 0 ? blocks : [{ type: "paragraph" }] };
}

// ---------------------------------------------------------------------------
// Markdown rendering (the inverse of textToDocument)
// ---------------------------------------------------------------------------

type JsonNode = Record<string, unknown>;

function asNode(value: unknown): JsonNode | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as JsonNode) : null;
}

function childrenOf(node: JsonNode): JsonNode[] {
  if (!Array.isArray(node.content)) return [];
  return node.content.map(asNode).filter((child): child is JsonNode => child !== null);
}

const MARK_RANK: Record<string, number> = { link: 0, bold: 1, italic: 2, strike: 3 };

interface Segment {
  kind: "text" | "break" | "atom";
  text: string;
  /** Non-code marks, outermost first. */
  marks: Mark[];
  code: boolean;
}

function markKey(mark: Mark): string {
  return mark.type === "link" ? `link:${String(mark.attrs?.href)}:${String(mark.attrs?.title ?? "")}` : mark.type;
}

function atomText(node: JsonNode): string {
  const attrs = asNode(node.attrs) ?? {};
  if (node.type === "inlineMath" && typeof attrs.latex === "string") return `$${attrs.latex}$`;
  if (node.type === "customEmoji" && typeof attrs.name === "string") return `:${attrs.name}:`;
  for (const key of ["label", "title", "name", "alt", "text"]) {
    const value = attrs[key];
    if (typeof value === "string" && value) return value;
  }
  return documentPlainText(node);
}

function segmentMarks(node: JsonNode): { marks: Mark[]; code: boolean; exact: boolean } {
  const raw = Array.isArray(node.marks) ? node.marks.map(asNode).filter((mark): mark is JsonNode => mark !== null) : [];
  const marks: Mark[] = [];
  let code = false;
  let exact = true;
  for (const mark of raw) {
    const type = String(mark.type);
    if (type === "code") {
      code = true;
    } else if (type === "link") {
      const attrs = asNode(mark.attrs) ?? {};
      const href = typeof attrs.href === "string" ? canonicalLinkHref(attrs.href) : null;
      if (!href || href !== attrs.href) {
        // Internal `rich-doc:` links and anything unsafe render as their text.
        exact = false;
        continue;
      }
      const title = typeof attrs.title === "string" && attrs.title ? attrs.title : null;
      marks.push({ type, attrs: title ? { href, title } : { href } });
    } else if (type in MARK_RANK) {
      marks.push({ type });
    } else {
      exact = false;
    }
  }
  marks.sort((a, b) => MARK_RANK[a.type]! - MARK_RANK[b.type]!);
  return { marks, code, exact };
}

function inlineSegments(nodes: JsonNode[]): { segments: Segment[]; exact: boolean } {
  const segments: Segment[] = [];
  let exact = true;
  for (const node of nodes) {
    if (node.type === "hardBreak") {
      segments.push({ kind: "break", text: "\n", marks: [], code: false });
    } else if (node.type === "text" && typeof node.text === "string") {
      const marks = segmentMarks(node);
      exact &&= marks.exact;
      segments.push({ kind: "text", text: node.text, marks: marks.marks, code: marks.code });
    } else {
      exact = false;
      segments.push({ kind: "atom", text: atomText(node), marks: [], code: false });
    }
  }
  // A delimiter cannot sit next to whitespace, so boundary whitespace moves
  // outside any mark that opens or closes there.
  const result: Segment[] = [];
  segments.forEach((segment, index) => {
    if (segment.kind !== "text" || segment.code || segment.marks.length === 0) {
      result.push(segment);
      return;
    }
    const shared = (other: Segment | undefined) =>
      // A bare code span renders inside the open marks, so they continue across it.
      other?.kind === "text" && other.code && other.marks.length === 0
        ? segment.marks
        : segment.marks.filter(
        (mark) => other?.kind === "text" && other.marks.some((candidate) => markKey(candidate) === markKey(mark)),
      );
    const lead = /^\s+/.exec(segment.text)?.[0] ?? "";
    const core = segment.text.slice(lead.length);
    const trail = /\s+$/.exec(core)?.[0] ?? "";
    const middle = core.slice(0, core.length - trail.length);
    if (lead) result.push({ ...segment, text: lead, marks: shared(segments[index - 1]) });
    if (middle) result.push({ ...segment, text: middle });
    if (trail) result.push({ ...segment, text: trail, marks: shared(segments[index + 1]) });
  });
  return { segments: result, exact };
}

function codeSpan(text: string): string {
  const runs = new Set((text.match(/`+/g) ?? []).map((run) => run.length));
  let fence = 1;
  while (runs.has(fence)) fence += 1;
  const ticks = "`".repeat(fence);
  const pad =
    text.startsWith("`") || text.endsWith("`") || (text.startsWith(" ") && text.endsWith(" ") && text.trim() !== "")
      ? " "
      : "";
  return `${ticks}${pad}${text}${pad}${ticks}`;
}

interface RenderVariant {
  escape: boolean;
  underscoreItalic: boolean;
  cell: boolean;
}

function escapeText(text: string, variant: RenderVariant): string {
  const value = variant.escape ? text.replace(/[\\`*_~[\]<]/g, "\\$&") : text;
  return variant.cell ? value.replace(/\|/g, "\\|") : value;
}

function renderSegments(segments: Segment[], variant: RenderVariant): string {
  const opener = (mark: Mark) => {
    if (mark.type === "link") return "[";
    if (mark.type === "bold") return "**";
    if (mark.type === "italic") return variant.underscoreItalic ? "_" : "*";
    return "~~";
  };
  const closer = (mark: Mark) => {
    if (mark.type !== "link") return opener(mark);
    const href = String(mark.attrs?.href);
    const destination = /[\s()<>]/.test(href) ? `<${href}>` : href;
    const title = typeof mark.attrs?.title === "string" ? ` "${mark.attrs.title.replace(/["\\]/g, "\\$&")}"` : "";
    return `](${destination}${title})`;
  };
  const stack: Mark[] = [];
  let out = "";
  for (const segment of segments) {
    // A bare code span sits inside whatever is open, since code excludes other marks anyway.
    const keepOpen = segment.kind === "break" || (segment.kind === "text" && segment.code && segment.marks.length === 0);
    const target = keepOpen ? [...stack] : segment.kind === "text" ? segment.marks : [];
    let common = 0;
    while (common < stack.length && common < target.length && markKey(stack[common]!) === markKey(target[common]!)) {
      common += 1;
    }
    while (stack.length > common) out += closer(stack.pop()!);
    for (const mark of target.slice(common)) {
      out += opener(mark);
      stack.push(mark);
    }
    if (segment.kind === "break") out += variant.cell ? "<br>" : "\n";
    else if (segment.kind === "atom") out += escapeText(segment.text, { ...variant, escape: false });
    else if (segment.code) out += codeSpan(variant.cell ? segment.text.replace(/\|/g, "\\|") : segment.text);
    else out += escapeText(segment.text, variant);
  }
  while (stack.length > 0) out += closer(stack.pop()!);
  return out;
}

/** A comparable form of inline content: text runs keyed by their marks. */
function projection(segments: Segment[]): string {
  const parts: string[] = [];
  let lastKey: string | null = null;
  for (const segment of segments) {
    if (segment.kind === "break") {
      parts.push("\u0000br");
      lastKey = null;
      continue;
    }
    if (segment.text.length === 0) continue;
    const key = segment.code ? "code" : segment.marks.map(markKey).join("+");
    if (key === lastKey) parts[parts.length - 1] += segment.text;
    else parts.push(`${key}\u0000${segment.text}`);
    lastKey = key;
  }
  return parts.join("\u0001");
}

/** Renders inline nodes in the plainest form that parses back to the same marks. */
function renderInline(nodes: JsonNode[], cell = false): string {
  const { segments, exact } = inlineSegments(nodes);
  const variants: RenderVariant[] = [
    { escape: false, underscoreItalic: false, cell },
    { escape: false, underscoreItalic: true, cell },
    { escape: true, underscoreItalic: false, cell },
    { escape: true, underscoreItalic: true, cell },
  ];
  const plainest = renderSegments(segments, variants[0]!);
  if (!exact) return plainest;
  const expected = projection(segments);
  for (const [index, variant] of variants.entries()) {
    const rendered = index === 0 ? plainest : renderSegments(segments, variant);
    const reparsed = inlineSegments(parseInline(rendered, { cell }) as JsonNode[]).segments;
    if (projection(reparsed) === expected) return rendered;
  }
  return plainest;
}

/** Keeps a paragraph line from being read back as a block marker. */
function escapeLineStart(line: string): string {
  const leading = /^ */.exec(line)![0];
  const rest = line.slice(leading.length);
  if (/^(#{1,6}(\s|$)|>|```|~~~|[-*+](\s|$))/.test(rest) || RULE.test(rest)) return `${leading}\\${rest}`;
  const ordered = /^(\d{1,9})([.)])(\s|$)/.exec(rest);
  if (ordered) return `${leading}${ordered[1]}\\${rest.slice(ordered[1]!.length)}`;
  return line;
}

const LIST_TYPES = new Set(["bulletList", "orderedList", "taskList"]);

function renderList(node: JsonNode, depth: number): string {
  const ordered = node.type === "orderedList";
  const start = ordered ? Math.max(1, Math.trunc(Number(asNode(node.attrs)?.start) || 1)) : 1;
  return childrenOf(node)
    .map((item, index) => {
      const bullet = ordered ? `${start + index}. ` : "- ";
      const box = item.type === "taskItem" ? (asNode(item.attrs)?.checked ? "[x] " : "[ ] ") : "";
      const pad = " ".repeat(bullet.length);
      const body = renderBlocks(childrenOf(item), depth + 1, true)
        .split("\n")
        .map((line, lineIndex) => (lineIndex === 0 || line === "" ? line : pad + line))
        .join("\n");
      return `${bullet}${box}${body}`;
    })
    .join("\n");
}

function renderTable(node: JsonNode): string {
  const rows = childrenOf(node).map((row) =>
    childrenOf(row).map((cellNode) =>
      childrenOf(cellNode)
        .map((block) =>
          block.type === "paragraph"
            ? renderInline(childrenOf(block), true)
            : documentPlainText(block).replace(/\n/g, "<br>").replace(/\|/g, "\\|"),
        )
        .join("<br>"),
    ),
  );
  if (rows.length === 0) return "";
  const width = Math.max(1, ...rows.map((row) => row.length));
  const line = (cells: string[]) => `| ${Array.from({ length: width }, (_, column) => cells[column] ?? "").join(" | ")} |`;
  const divider = `| ${Array.from({ length: width }, () => "---").join(" | ")} |`;
  return [line(rows[0]!), divider, ...rows.slice(1).map(line)].join("\n");
}

function renderTextLines(text: string): string {
  return text.split("\n").map(escapeLineStart).join("\n");
}

function renderBlock(node: JsonNode, depth: number): string {
  if (depth > MAX_DEPTH) return renderTextLines(documentPlainText(node));
  switch (node.type) {
    case "paragraph":
      return renderTextLines(renderInline(childrenOf(node)));
    case "heading": {
      const level = Math.min(Math.max(Math.trunc(Number(asNode(node.attrs)?.level) || 1), 1), 6);
      const title = renderInline(
        childrenOf(node).map((child) => (child.type === "hardBreak" ? { type: "text", text: " " } : child)),
      );
      return `${"#".repeat(level)} ${title}`.trimEnd();
    }
    case "codeBlock": {
      const code = childrenOf(node)
        .map((child) => (typeof child.text === "string" ? child.text : ""))
        .join("");
      const longest = Math.max(0, ...(code.match(/^ *`{3,}/gm) ?? []).map((run) => run.trim().length));
      const fence = "`".repeat(Math.max(3, longest + 1));
      const language = asNode(node.attrs)?.language;
      return `${fence}${typeof language === "string" ? language : ""}\n${code ? `${code}\n` : ""}${fence}`;
    }
    case "bulletList":
    case "orderedList":
    case "taskList":
      return renderList(node, depth);
    case "blockquote":
    case "callout":
      return renderBlocks(childrenOf(node), depth + 1)
        .split("\n")
        .map((line) => (line ? `> ${line}` : ">"))
        .join("\n");
    case "horizontalRule":
      return "---";
    case "table":
      return renderTable(node);
    default: {
      const children = childrenOf(node);
      if (children.length > 0 && children.every((child) => child.type !== "text" && child.type !== "hardBreak")) {
        return renderBlocks(children, depth + 1);
      }
      return renderTextLines(atomText(node));
    }
  }
}

function renderBlocks(nodes: JsonNode[], depth: number, listItem = false): string {
  const parts: string[] = [];
  nodes.forEach((node, index) => {
    if (index > 0) {
      // Inside an item, a paragraph and its nested list or fence stay tight ("- a\n  - b").
      const tight = listItem && nodes[index - 1]!.type === "paragraph" && (LIST_TYPES.has(String(node.type)) || node.type === "codeBlock");
      parts.push(tight ? "\n" : "\n\n");
    }
    parts.push(renderBlock(node, depth));
  });
  return parts.join("");
}

/**
 * The inverse of `textToDocument`. Editor-only nodes (images, callouts, chips, math) become
 * readable text.
 */
export function documentToText(content: unknown): string {
  const root = asNode(content);
  if (!root) return "";
  return renderBlocks(root.type === "doc" ? childrenOf(root) : [root], 0)
    .replace(/^\n+/, "")
    .trimEnd();
}

/** Plain-text projection for search and terse agent output. Never authoritative. */
export function documentPlainText(content: unknown, maximumLength = 200_000): string {
  const parts: string[] = [];
  let length = 0;
  function walk(value: unknown, depth: number): void {
    if (length > maximumLength || depth > 64 || value === null || typeof value !== "object") return;
    if (Array.isArray(value)) {
      for (const child of value) walk(child, depth + 1);
      return;
    }
    const node = value as Record<string, unknown>;
    if (node.type === "text" && typeof node.text === "string") {
      parts.push(node.text);
      length += node.text.length;
      return;
    }
    if (node.type === "hardBreak") {
      parts.push("\n");
      return;
    }
    const before = parts.length;
    if (Array.isArray(node.content)) walk(node.content, depth + 1);
    const blockTypes = new Set([
      "paragraph",
      "heading",
      "codeBlock",
      "listItem",
      "taskItem",
      "tableRow",
      "blockquote",
      "callout",
    ]);
    if (typeof node.type === "string" && blockTypes.has(node.type) && parts.length > before) {
      parts.push("\n");
    } else if (node.type === "tableCell" || node.type === "tableHeader") {
      parts.push(" | ");
    }
  }
  walk(content, 0);
  return parts
    .join("")
    .replace(/ \| \n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, maximumLength);
}
