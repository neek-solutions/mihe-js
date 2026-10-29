import { describe, expect, it } from "vitest";

import { parseInline, parseMarkdown } from "../src/markdown";
import { renderMarkdown } from "../src/widget/markdown";

describe("reading a reply's Markdown", () => {
  it("turns **bold** into bold instead of showing the asterisks", () => {
    expect(parseInline("Price is **$12** now")).toEqual([
      { kind: "text", text: "Price is " },
      { kind: "text", text: "$12", bold: true },
      { kind: "text", text: " now" },
    ]);
  });

  it("reads italic, code and links", () => {
    expect(parseInline("an *idea*, `code` and [docs](https://example.com)")).toEqual([
      { kind: "text", text: "an " },
      { kind: "text", text: "idea", italic: true },
      { kind: "text", text: ", " },
      { kind: "code", text: "code" },
      { kind: "text", text: " and " },
      { kind: "link", text: "docs", href: "https://example.com" },
    ]);
  });

  it("leaves an unclosed marker as written, so a streaming reply never flickers into the wrong style", () => {
    expect(parseInline("Done: **the hero")).toEqual([{ kind: "text", text: "Done: **the hero" }]);
  });

  it("does not read asterisks in arithmetic or snake_case as emphasis", () => {
    expect(parseInline("2 * 3 * 4 and my_var_name")).toEqual([{ kind: "text", text: "2 * 3 * 4 and my_var_name" }]);
  });

  it("keeps a link's words but drops an address that could run script", () => {
    expect(parseInline("[click](javascript:alert`1`)")).toEqual([{ kind: "text", text: "click" }]);
    expect(parseInline("[x](data:text/html,hi)")).toEqual([{ kind: "text", text: "x" }]);
  });

  it("groups lines into paragraphs, lists and headings", () => {
    const blocks = parseMarkdown("## Done\nI changed:\n- the **title**\n- the price\n\n1. first\n2. second\n\nThat's all.");
    expect(blocks.map((b) => b.kind)).toEqual(["heading", "paragraph", "list", "list", "paragraph"]);
    expect(blocks[2]).toMatchObject({ ordered: false, items: [[{ text: "the " }, { text: "title", bold: true }], [{ text: "the price" }]] });
    expect(blocks[3]).toMatchObject({ ordered: true, start: 1 });
  });

  it("draws HTML in a reply as text, never as elements", () => {
    const el = renderMarkdown('**<img src=x onerror="alert(1)">** and <b>hi</b>');
    expect(el.querySelector("img")).toBeNull();
    expect(el.querySelector("b")).toBeNull();
    expect(el.querySelector("strong")?.textContent).toBe('<img src=x onerror="alert(1)">');
  });
});
