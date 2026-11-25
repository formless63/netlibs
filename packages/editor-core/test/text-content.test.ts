import { describe, expect, it } from 'bun:test';
import { documentToText, documentPlainText, textToDocument } from '../src/text-content.ts';
import type { JsonValue } from '../src/json.ts';

type Json = { [key: string]: unknown };

const blocks = (markdown: string) => (textToDocument(markdown).content ?? []) as Json[];
const inline = (markdown: string) => (blocks(markdown)[0]!.content ?? []) as Json[];
const text = (value: string, ...marks: Json[]) =>
  marks.length > 0 ? { type: "text", text: value, marks } : { type: "text", text: value };

/** Markdown → document → Markdown → document must be stable, and the second Markdown must equal the first. */
function expectRoundTrip(markdown: string, rendered = markdown) {
  const document = textToDocument(markdown);
  const output = documentToText(document);
  expect(output).toBe(rendered);
  expect(textToDocument(output)).toEqual(document);
  return document;
}

describe("inline marks", () => {
  it("parses bold, italic, strike, code and links", () => {
    expect(inline("a **b** *c* _d_ ~~e~~ `f` [g](https://example.com/h)")).toEqual([
      text("a "),
      text("b", { type: "bold" }),
      text(" "),
      text("c", { type: "italic" }),
      text(" "),
      text("d", { type: "italic" }),
      text(" "),
      text("e", { type: "strike" }),
      text(" "),
      text("f", { type: "code" }),
      text(" "),
      text("g", { type: "link", attrs: { href: "https://example.com/h" } }),
    ]);
  });

  it("round-trips each mark", () => {
    expectRoundTrip("plain **bold** text");
    expectRoundTrip("plain *italic* text");
    expectRoundTrip("plain ~~struck~~ text");
    expectRoundTrip("plain `inline code` text");
    expectRoundTrip("see [the docs](https://example.com/docs?a=1#top) now");
    expectRoundTrip("see [titled](https://example.com/ \"A title\")");
    expectRoundTrip("site [path](/library/work) and [anchor](#setup)");
    expectRoundTrip("mail [me](mailto:someone@example.com)");
    expectRoundTrip("_under_", "*under*");
  });

  it("nests and combines marks", () => {
    expect(inline("***both***")).toEqual([text("both", { type: "bold" }, { type: "italic" })]);
    expect(inline("**bold *and italic* bold**")).toEqual([
      text("bold ", { type: "bold" }),
      text("and italic", { type: "bold" }, { type: "italic" }),
      text(" bold", { type: "bold" }),
    ]);
    expect(inline("[**strong link**](https://example.com/)")).toEqual([
      text("strong link", { type: "link", attrs: { href: "https://example.com/" } }, { type: "bold" }),
    ]);
    expectRoundTrip("***both***");
    expectRoundTrip("**bold *and italic* bold**");
    expectRoundTrip("[**strong link**](https://example.com/) and ~~**gone**~~", "[**strong link**](https://example.com/) and **~~gone~~**");
  });

  it("keeps code spans literal and exclusive", () => {
    expect(inline("`**not bold** [x](https://example.com/)`")).toEqual([
      text("**not bold** [x](https://example.com/)", { type: "code" }),
    ]);
    expect(inline("``a ` b``")).toEqual([text("a ` b", { type: "code" })]);
    expectRoundTrip("``a ` b``");
    expectRoundTrip("`` `tick` ``");
    expectRoundTrip("**bold `code` bold**");
  });

  it("parses autolinks and canonicalizes link destinations", () => {
    expect(inline("<https://example.com>")).toEqual([
      text("https://example.com", { type: "link", attrs: { href: "https://example.com/" } }),
    ]);
    expectRoundTrip("[x](https://example.com)", "[x](https://example.com/)");
  });

  it("leaves unsafe or relative links as literal text", () => {
    for (const source of ["[x](javascript:alert(1))", "[x](./relative.md)", "[x](//evil.example)", "[x](data:text/html,hi)"]) {
      expect(inline(source)).toEqual([text(source)]);
    }
  });

  it("does not treat ordinary punctuation as emphasis", () => {
    for (const source of [
      "snake_case_name and file_name.txt",
      "2 * 3 * 4",
      "~/work/infra and a~b",
      "a ** b",
      "rm *.log",
      "unclosed **bold",
      "half `code",
    ]) {
      expect(inline(source)).toEqual([text(source)]);
      expectRoundTrip(source, documentToText(textToDocument(source)));
    }
    expect(documentToText(textToDocument("snake_case_name"))).toBe("snake_case_name");
  });

  it("honours backslash escapes and renders literal markup back escaped", () => {
    expect(inline("\\*not italic\\* and \\`no code\\`")).toEqual([text("*not italic* and `no code`")]);
    const literal = { type: "doc", content: [{ type: "paragraph", content: [text("**literal** `x` [y](https://example.com/)")] }] };
    const output = documentToText(literal);
    expect(output).toBe("\\*\\*literal\\*\\* \\`x\\` \\[y\\](https://example.com/)");
    expect(textToDocument(output)).toEqual(literal as never);
  });

  it("renders editor-made marks the parser cannot see adjacent", () => {
    const document = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [text("bold", { type: "bold" }), text("italic", { type: "italic" }), text(" tail ")],
        },
      ],
    };
    const output = documentToText(document);
    expect(output).toBe("**bold**_italic_ tail");
    expect(inline(output)).toEqual([text("bold", { type: "bold" }), text("italic", { type: "italic" }), text(" tail")]);
  });

  it("moves whitespace outside delimiters", () => {
    const document = { type: "doc", content: [{ type: "paragraph", content: [text("a"), text(" bold ", { type: "bold" }), text("b")] }] };
    expect(documentToText(document)).toBe("a **bold** b");
  });
});

describe("block structure", () => {
  it("keeps paragraphs, soft breaks and headings", () => {
    expect(blocks("one\ntwo")[0]).toEqual({ type: "paragraph", content: [text("one"), { type: "hardBreak" }, text("two")] });
    expect(blocks("## Learn C#")[0]).toEqual({ type: "heading", attrs: { level: 2 }, content: [text("Learn C#")] });
    expect(blocks("# Closed ##")[0]).toEqual({ type: "heading", attrs: { level: 1 }, content: [text("Closed")] });
    expectRoundTrip("# Title with **bold**\n\nBody line\nsecond line");
  });

  it("nests bullet lists by two-space indentation", () => {
    const document = expectRoundTrip("- one\n  - one.a\n    - one.a.i\n  - one.b\n- two");
    const list = document.content![0] as Json;
    expect(list.type).toBe("bulletList");
    const items = list.content as Json[];
    expect(items).toHaveLength(2);
    const nested = (items[0]!.content as Json[])[1]!;
    expect(nested.type).toBe("bulletList");
    expect(nested.content as Json[]).toHaveLength(2);
    expect(((nested.content as Json[])[0]!.content as Json[])[1]!.type).toBe("bulletList");
  });

  it("nests by four-space indentation and mixes list kinds", () => {
    const document = textToDocument("1. first\n    - detail\n        1. step\n2. second");
    expect(documentToText(document)).toBe("1. first\n   - detail\n     1. step\n2. second");
    const ordered = document.content![0] as Json;
    expect(ordered).toMatchObject({ type: "orderedList", attrs: { start: 1 } });
    const items = ordered.content as Json[];
    expect(items).toHaveLength(2);
    const detail = (items[0]!.content as Json[])[1]!;
    expect(detail.type).toBe("bulletList");
    expect((((detail.content as Json[])[0]!.content as Json[])[1] as Json).type).toBe("orderedList");
    expect(textToDocument(documentToText(document))).toEqual(document);
  });

  it("keeps inline marks inside list items", () => {
    const document = expectRoundTrip("- **bold** item with `code`\n  - nested [link](https://example.com/)");
    const paragraph = (((document.content![0] as Json).content as Json[])[0]!.content as Json[])[0]!;
    expect(paragraph.content).toEqual([text("bold", { type: "bold" }), text(" item with "), text("code", { type: "code" })]);
  });

  it("accepts code fences inside list items", () => {
    const document = textToDocument("1. Run:\n   ```bash\n   docker ps\n\n   echo done\n   ```\n2. Then check");
    const items = (document.content![0] as Json).content as Json[];
    expect(items).toHaveLength(2);
    expect((items[0]!.content as Json[])[1]).toEqual({
      type: "codeBlock",
      attrs: { language: "bash" },
      content: [text("docker ps\n\necho done")],
    });
    expect(documentToText(document)).toBe("1. Run:\n   ```bash\n   docker ps\n\n   echo done\n   ```\n2. Then check");
    expect(textToDocument(documentToText(document))).toEqual(document);
  });

  it("accepts a fence that starts an item and fences nested two levels deep", () => {
    const document = expectRoundTrip("- \n  ```\n  code\n  ```\n- outer\n  - inner\n    ```sql\n    select 1;\n    ```");
    const items = (document.content![0] as Json).content as Json[];
    expect((items[0]!.content as Json[]).map((node) => node.type)).toEqual(["paragraph", "codeBlock"]);
  });

  it("indents fence bodies relative to the fence and lengthens fences around backticks", () => {
    expect(blocks("  ```\n    indented\n  ```")[0]).toEqual({
      type: "codeBlock",
      attrs: { language: null },
      content: [text("  indented")],
    });
    expectRoundTrip("````md\n```\ninner\n```\n````");
    expectRoundTrip("```mermaid\ngraph TD; a-->b\n```");
  });

  it("parses task lists", () => {
    const document = expectRoundTrip("- [ ] todo **soon**\n- [x] done\n  - [ ] child");
    const list = document.content![0] as Json;
    expect(list.type).toBe("taskList");
    expect((list.content as Json[]).map((item) => (item.attrs as Json).checked)).toEqual([false, true]);
  });

  it("keeps tables, with inline marks and escaped pipes in cells", () => {
    const document = expectRoundTrip("| Name | Notes |\n| --- | --- |\n| **a** | `x \\| y` and a\\|b |\n| c | line<br>two |");
    const table = document.content![0] as Json;
    expect(table.type).toBe("table");
    const cellParagraph = (row: number, column: number) =>
      ((((table.content as Json[])[row]!.content as Json[])[column]!.content as Json[])[0] as Json).content;
    expect(cellParagraph(1, 0)).toEqual([text("a", { type: "bold" })]);
    expect(cellParagraph(1, 1)).toEqual([text("x | y", { type: "code" }), text(" and a|b")]);
    expect(cellParagraph(2, 1)).toEqual([text("line"), { type: "hardBreak" }, text("two")]);
  });

  it("parses block quotes recursively and rules", () => {
    const document = expectRoundTrip("> quoted **q**\n>\n> - in a quote\n\n---\n\nafter");
    expect((document.content![0] as Json).content).toHaveLength(2);
    expect((document.content![1] as Json).type).toBe("horizontalRule");
  });

  it("escapes paragraph lines that would read as block markers", () => {
    const literal = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [text("# not a heading"), { type: "hardBreak" }, text("- not a bullet"), { type: "hardBreak" }, text("1. not ordered")],
        },
      ],
    };
    const output = documentToText(literal);
    expect(output).toBe("\\# not a heading\n\\- not a bullet\n1\\. not ordered");
    expect(textToDocument(output)).toEqual(literal as never);
  });

  it("bounds nesting depth and stays linear on hostile input", () => {
    const deep = Array.from({ length: 200 }, (_, level) => `${"  ".repeat(level)}- level ${level}`).join("\n");
    expect(() => documentToText(textToDocument(deep))).not.toThrow();
    const started = performance.now();
    textToDocument("*a ".repeat(40_000) + "\n" + "[".repeat(20_000) + "`".repeat(5_000));
    expect(performance.now() - started).toBeLessThan(5_000);
  });
});

describe("regressions", () => {
  it("keeps one ordered list across blank lines and continuation lines", () => {
    const content = textToDocument("Steps:\n\n1. first\n   still first\n\n2. second\n3. third\n\nAfter.");
    const lists = (content.content ?? []).filter((node) => (node as Json).type === "orderedList") as Json[];
    expect(lists).toHaveLength(1);
    expect(lists[0]!.attrs).toEqual({ start: 1 });
    expect(lists[0]!.content).toHaveLength(3);
    expect(documentPlainText(content)).toContain("first\nstill first");
    expect(documentToText(content)).toBe("Steps:\n\n1. first\n   still first\n2. second\n3. third\n\nAfter.");
  });

  it("splits a list where the marker kind changes and keeps the start number", () => {
    const content = textToDocument("1. one\n- aside\n2. two");
    expect((content.content ?? []).map((node) => (node as Json).type)).toEqual(["orderedList", "bulletList", "orderedList"]);
    expect(((content.content ?? [])[2] as Json).attrs).toEqual({ start: 2 });
    expect(textToDocument(documentToText(content))).toEqual(content);
  });

  it("keeps the earlier shapes: headings, tables, mermaid, quotes, rules, empty input", () => {
    const document = textToDocument(
      ["# Heading", "", "Paragraph with", "a soft break.", "", "| a | b |", "| --- | --- |", "| 1 | 2 |", "", "```mermaid", "graph TD; a-->b", "```", "", "> quoted", "", "---"].join("\n"),
    );
    expect((document.content ?? []).map((node) => (node as Json).type)).toEqual([
      "heading",
      "paragraph",
      "table",
      "codeBlock",
      "blockquote",
      "horizontalRule",
    ]);
    expect(textToDocument("")).toEqual({ type: "doc", content: [{ type: "paragraph" }] });
    expect(documentToText(textToDocument(""))).toBe("");
    expect(textToDocument(documentToText(document))).toEqual(document);
  });

  it("plain text drops the markup", () => {
    expect(documentPlainText(textToDocument("**bold** and `code`\n\n- a\n  - b"))).toBe("bold and code\na\nb");
  });

  it("renders editor-only nodes as readable text", () => {
    const document = {
      type: "doc",
      content: [
        { type: "callout", content: [{ type: "paragraph", content: [text("careful")] }] },
        { type: "paragraph", content: [text("see "), { type: "resourceChip", attrs: { label: "Runbook" } }] },
        { type: "paragraph", content: [text("doc", { type: "link", attrs: { href: "rich-doc:abc" } })] },
      ] as JsonValue[],
    };
    expect(documentToText(document)).toBe("> careful\n\nsee Runbook\n\ndoc");
  });
});
