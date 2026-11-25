/** The local XML reader: structure, entities, and the refusals that keep it safe. */
import { describe, expect, it } from "bun:test";
import {
  XmlParseError,
  attribute,
  childElement,
  childElements,
  decodeEntities,
  parseXml,
} from "../src/xml.ts";

describe("parseXml", () => {
  it("reads elements, attributes, text and self-closing tags", () => {
    const root = parseXml(
      `<?xml version="1.0" encoding="utf-8"?>\n<!-- lead -->\n<A x="1" y='two'><B/><C k = "v">hi <D>there</D> you</C></A>\n<!-- tail -->\n`,
    );
    expect(root.name).toBe("A");
    expect(root.attributes).toEqual({ x: "1", y: "two" });
    expect(root.children.map((c) => c.name)).toEqual(["B", "C"]);
    const c = childElement(root, "c");
    expect(attribute(c, "K")).toBe("v");
    expect(c?.text).toBe("hi  you");
    expect(childElement(c, "D")?.text).toBe("there");
    expect(childElements(root, "B")).toHaveLength(1);
    expect(attribute(null, "x")).toBeNull();
  });

  it("decodes predefined and numeric entities in text and attributes", () => {
    const root = parseXml(
      `<a t="&quot;q&quot; &amp; &apos;s&apos;">&lt;b&gt; &#65;&#x42;&#x1F600;</a>`,
    );
    expect(root.attributes["t"]).toBe(`"q" & 's'`);
    expect(root.text).toBe("<b> AB😀");
  });

  it("keeps CDATA verbatim and skips a byte-order mark", () => {
    expect(parseXml(`${String.fromCharCode(0xfeff)}<a><![CDATA[<raw> & ]]></a>`).text).toBe(
      "<raw> & ",
    );
  });

  it("refuses DOCTYPE and ENTITY declarations (XXE)", () => {
    const xxe = `<?xml version="1.0"?><!DOCTYPE a [<!ENTITY x SYSTEM "file:///etc/passwd">]><a>&x;</a>`;
    expect(() => parseXml(xxe)).toThrow(/DOCTYPE/);
    expect(() => parseXml(`<a><!ENTITY x "y"></a>`)).toThrow(XmlParseError);
  });

  it("refuses unknown, unterminated and invalid entities", () => {
    expect(() => parseXml("<a>&x;</a>")).toThrow(/unknown entity/);
    expect(() => parseXml("<a>fish & chips</a>")).toThrow(/unterminated entity/);
    expect(() => parseXml("<a>&#0;</a>")).toThrow(/invalid character/);
    expect(() => decodeEntities("&#xD800;")).toThrow(XmlParseError);
  });

  it("refuses malformed documents", () => {
    for (const bad of [
      "",
      "text",
      "<a>",
      "<a></b>",
      "<a x=1/>",
      '<a x="1"y="2"/>',
      '<a x="1" x="2"/>',
      '<a x="<"/>',
      "<a/><b/>",
      "<a><!-- open</a>",
      "<a><![CDATA[x</a>",
      "<?xml version='1.0'",
    ]) {
      expect(() => parseXml(bad), bad).toThrow(XmlParseError);
    }
  });

  it("bounds depth and size", () => {
    const deep = (n: number) => `${"<a>".repeat(n)}${"</a>".repeat(n)}`;
    expect(() => parseXml(deep(64))).not.toThrow();
    expect(() => parseXml(deep(65))).toThrow(/too deeply/);
    expect(() => parseXml(deep(3), { maxDepth: 2 })).toThrow(/too deeply/);
    expect(() => parseXml(`<a>${"x".repeat(100)}</a>`, { maxBytes: 50 })).toThrow(/too large/);
  });

  it("does not let attribute names reach the prototype", () => {
    const root = parseXml(`<a __proto__="x" constructor="y"/>`);
    expect(root.attributes["__proto__"]).toBe("x");
    expect(({} as Record<string, unknown>)["x"]).toBeUndefined();
  });
});
