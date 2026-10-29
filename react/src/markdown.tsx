/**
 * Draws a reply's Markdown tree (from `@mihe-dev/js`) as React elements.
 * Text is only ever a child string, so React escapes it.
 */
import type { CSSProperties, ReactNode } from "react";
import { parseMarkdown, type MarkdownInline } from "@mihe-dev/js";

const styles = {
  root: { whiteSpace: "normal" },
  block: { margin: 0 },
  gap: { margin: "6px 0 0" },
  // Set outright: a host's CSS reset (Tailwind's, for one) takes list markers off every list on the page.
  list: { margin: 0, paddingLeft: 18 },
  listGap: { margin: "6px 0 0", paddingLeft: 18 },
  bullets: { listStyleType: "disc" },
  numbers: { listStyleType: "decimal" },
  code: { fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontSize: "0.92em", background: "rgba(15,23,42,0.06)", padding: "0 3px", borderRadius: 3 },
  link: { color: "inherit", textDecoration: "underline" },
} satisfies Record<string, CSSProperties>;

function inline(parts: MarkdownInline[]): ReactNode[] {
  return parts.map((part, i) => {
    if (part.kind === "code") return <code key={i} style={styles.code}>{part.text}</code>;
    if (part.kind === "link") return <a key={i} href={part.href} target="_blank" rel="noreferrer" style={styles.link}>{part.text}</a>;
    let node: ReactNode = part.text;
    if (part.italic) node = <em>{node}</em>;
    if (part.bold) node = <strong>{node}</strong>;
    return <span key={i}>{node}</span>;
  });
}

export function Markdown({ text }: { text: string }) {
  return (
    <div style={styles.root}>
      {parseMarkdown(text).map((block, i) => {
        if (block.kind === "heading") return <p key={i} style={i ? styles.gap : styles.block}><strong>{inline(block.inline)}</strong></p>;
        if (block.kind === "list") {
          const items = block.items.map((item, j) => <li key={j}>{inline(item)}</li>);
          const style = i ? styles.listGap : styles.list;
          return block.ordered
            ? <ol key={i} start={block.start === 1 ? undefined : block.start} style={{ ...style, ...styles.numbers }}>{items}</ol>
            : <ul key={i} style={{ ...style, ...styles.bullets }}>{items}</ul>;
        }
        return (
          <p key={i} style={i ? styles.gap : styles.block}>
            {block.lines.map((line, j) => <span key={j}>{j > 0 && <br />}{inline(line)}</span>)}
          </p>
        );
      })}
    </div>
  );
}
