/**
 * A small, dependency-free XML reader sufficient for Namecheap API answers.
 *
 * Supports elements, attributes (double- or single-quoted), text, CDATA,
 * self-closing tags, the XML declaration and other processing instructions
 * (skipped), comments (skipped) and the five predefined entities plus
 * numeric character references.
 *
 * Deliberately refuses any `<!DOCTYPE …>` / `<!ENTITY …>` declaration, so no
 * external or recursive entity can be expanded (XXE / billion laughs), and
 * bounds input size and element depth. Namespaces are not resolved: element
 * and attribute names are kept as written.
 */

export class XmlParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "XmlParseError";
  }
}

export interface XmlElement {
  name: string;
  attributes: Record<string, string>;
  children: XmlElement[];
  /** Concatenated direct text content (entities decoded, not trimmed). */
  text: string;
}

export interface XmlParseOptions {
  maxDepth?: number;
  maxBytes?: number;
}

const NAME = /[A-Za-z_:][\w.:-]*/y;
const PREDEFINED: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

export function decodeEntities(value: string): string {
  return value.replace(/&([^;&\s]{0,12});?/g, (match, body: string) => {
    if (!match.endsWith(";")) throw new XmlParseError("unterminated entity reference");
    if (body in PREDEFINED) return PREDEFINED[body]!;
    let code: number;
    if (/^#x[0-9a-fA-F]{1,6}$/.test(body)) code = Number.parseInt(body.slice(2), 16);
    else if (/^#\d{1,7}$/.test(body)) code = Number.parseInt(body.slice(1), 10);
    else throw new XmlParseError(`unknown entity &${body.slice(0, 12)};`);
    const valid =
      code === 0x9 ||
      code === 0xa ||
      code === 0xd ||
      (code >= 0x20 && code <= 0xd7ff) ||
      (code >= 0xe000 && code <= 0xfffd) ||
      (code >= 0x10000 && code <= 0x10ffff);
    if (!valid) throw new XmlParseError("invalid character reference");
    return String.fromCodePoint(code);
  });
}

/** Parse a document and return its root element. Throws {@link XmlParseError}. */
export function parseXml(input: string, options: XmlParseOptions = {}): XmlElement {
  const maxDepth = options.maxDepth ?? 64;
  const maxBytes = options.maxBytes ?? 1_000_000;
  if (input.length > maxBytes) throw new XmlParseError("the XML document is too large");
  let pos = input.charCodeAt(0) === 0xfeff ? 1 : 0;

  const fail = (message: string): never => {
    throw new XmlParseError(`${message} at offset ${pos}`);
  };

  const skipWhitespace = () => {
    while (pos < input.length && /\s/.test(input[pos]!)) pos += 1;
  };

  const skipUntil = (terminator: string, what: string) => {
    const end = input.indexOf(terminator, pos);
    if (end === -1) fail(`unterminated ${what}`);
    pos = end + terminator.length;
  };

  /** Skips comments/PIs; refuses declarations. Returns true when it consumed something. */
  const skipMisc = (): boolean => {
    if (input.startsWith("<!--", pos)) {
      pos += 4;
      skipUntil("-->", "comment");
      return true;
    }
    if (input.startsWith("<?", pos)) {
      pos += 2;
      skipUntil("?>", "processing instruction");
      return true;
    }
    if (input.startsWith("<!", pos) && !input.startsWith("<![CDATA[", pos)) {
      fail("DOCTYPE and other declarations are not allowed");
    }
    return false;
  };

  const readName = (): string => {
    NAME.lastIndex = pos;
    const match = NAME.exec(input);
    if (!match) return fail("expected a name");
    pos += match[0].length;
    return match[0];
  };

  const readElement = (depth: number): XmlElement => {
    if (depth > maxDepth) fail("the XML document is nested too deeply");
    if (input[pos] !== "<") fail("expected an element");
    pos += 1;
    const name = readName();
    const attributes: Record<string, string> = Object.create(null) as Record<string, string>;
    for (;;) {
      const before = pos;
      skipWhitespace();
      if (input.startsWith("/>", pos)) {
        pos += 2;
        return { name, attributes, children: [], text: "" };
      }
      if (input[pos] === ">") {
        pos += 1;
        break;
      }
      if (pos === before) fail("expected whitespace before an attribute");
      const attr = readName();
      skipWhitespace();
      if (input[pos] !== "=") fail("expected = after an attribute name");
      pos += 1;
      skipWhitespace();
      const quote = input[pos];
      if (quote !== '"' && quote !== "'") return fail("expected a quoted attribute value");
      const end = input.indexOf(quote, pos + 1);
      if (end === -1) fail("unterminated attribute value");
      const raw = input.slice(pos + 1, end);
      if (raw.includes("<")) fail("< is not allowed in an attribute value");
      if (attr in attributes) fail("duplicate attribute");
      attributes[attr] = decodeEntities(raw);
      pos = end + 1;
    }
    const children: XmlElement[] = [];
    let text = "";
    for (;;) {
      if (pos >= input.length) fail(`unterminated element <${name}>`);
      if (input.startsWith("</", pos)) {
        pos += 2;
        const closing = readName();
        if (closing !== name) fail(`mismatched closing tag </${closing}> for <${name}>`);
        skipWhitespace();
        if (input[pos] !== ">") fail("expected > after a closing tag");
        pos += 1;
        return { name, attributes, children, text };
      }
      if (input.startsWith("<![CDATA[", pos)) {
        const end = input.indexOf("]]>", pos + 9);
        if (end === -1) fail("unterminated CDATA section");
        text += input.slice(pos + 9, end);
        pos = end + 3;
        continue;
      }
      if (skipMisc()) continue;
      if (input[pos] === "<") {
        children.push(readElement(depth + 1));
        continue;
      }
      const next = input.indexOf("<", pos);
      const end = next === -1 ? input.length : next;
      text += decodeEntities(input.slice(pos, end));
      pos = end;
    }
  };

  for (;;) {
    skipWhitespace();
    if (!skipMisc()) break;
  }
  if (pos >= input.length) fail("the XML document has no root element");
  const root = readElement(1);
  for (;;) {
    skipWhitespace();
    if (pos >= input.length) break;
    if (!skipMisc()) fail("content after the root element");
  }
  return root;
}

/** The first direct child with this name (case-insensitive). */
export function childElement(
  element: XmlElement | null | undefined,
  name: string,
): XmlElement | null {
  const lower = name.toLowerCase();
  return element?.children.find((c) => c.name.toLowerCase() === lower) ?? null;
}

/** Every direct child with this name (case-insensitive). */
export function childElements(element: XmlElement | null | undefined, name: string): XmlElement[] {
  const lower = name.toLowerCase();
  return element?.children.filter((c) => c.name.toLowerCase() === lower) ?? [];
}

/** An attribute by name (case-insensitive), or null. */
export function attribute(element: XmlElement | null | undefined, name: string): string | null {
  if (!element) return null;
  const lower = name.toLowerCase();
  for (const [key, value] of Object.entries(element.attributes)) {
    if (key.toLowerCase() === lower) return value;
  }
  return null;
}
