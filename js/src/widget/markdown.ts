/**
 * Draws a reply's Markdown tree (`../markdown.ts`) as DOM, through `h`, so
 * every piece of text goes in as a text node.
 */
import { parseMarkdown, type Inline } from "../markdown";
import { h } from "./dom";

function inline(parts: Inline[]): Node[] {
  return parts.map((part) => {
    if (part.kind === "code") return h("code", {}, part.text);
    if (part.kind === "link") return h("a", { attrs: { href: part.href, target: "_blank", rel: "noreferrer" } }, part.text);
    let node: Node = document.createTextNode(part.text);
    if (part.italic) node = h("em", {}, node);
    if (part.bold) node = h("strong", {}, node);
    return node;
  });
}

export function renderMarkdown(text: string): HTMLElement {
  return h(
    "div",
    { class: "md" },
    ...parseMarkdown(text).map((block) => {
      if (block.kind === "heading") return h("p", {}, h("strong", {}, ...inline(block.inline)));
      if (block.kind === "list") {
        const items = block.items.map((item) => h("li", {}, ...inline(item)));
        return block.ordered ? h("ol", { attrs: { start: block.start === 1 ? undefined : block.start } }, ...items) : h("ul", {}, ...items);
      }
      return h("p", {}, ...block.lines.flatMap((line, i) => (i ? [h("br"), ...inline(line)] : inline(line))));
    }),
  );
}
