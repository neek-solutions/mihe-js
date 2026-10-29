/**
 * The little Markdown a model writes in a chat reply, read into a tree that
 * each widget draws with its own elements.
 *
 * Models write `**bold**`, lists and the odd `code` whatever the prompt says,
 * and a reply full of asterisks reads as broken. This reads that subset and
 * nothing more: paragraphs, bullet and numbered lists, headings (drawn as bold
 * lines), bold, italic, inline code and links. Never HTML: the tree holds only
 * strings, every renderer puts them in as text, and a link keeps only an
 * http(s) or mailto address. A reply is still model prose, so it gets no more
 * power than plain text had.
 *
 * Safe on a reply that is still streaming: an unclosed `**` stays as written
 * until its pair arrives.
 */

export type Inline =
  | { kind: "text"; text: string; bold?: boolean; italic?: boolean }
  | { kind: "code"; text: string }
  | { kind: "link"; text: string; href: string };

export type Block =
  | { kind: "paragraph"; lines: Inline[][] }
  | { kind: "heading"; inline: Inline[] }
  | { kind: "list"; ordered: boolean; start: number; items: Inline[][] };

const BULLET = /^\s*[-*•]\s+(.*)$/;
const NUMBERED = /^\s*(\d{1,3})[.)]\s+(.*)$/;
const HEADING = /^\s{0,3}#{1,6}\s+(.*?)\s*#*\s*$/;

export function parseMarkdown(text: string): Block[] {
  const blocks: Block[] = [];
  let paragraph: string[] = [];
  let list: { ordered: boolean; start: number; items: string[] } | null = null;

  const flush = () => {
    if (paragraph.length) blocks.push({ kind: "paragraph", lines: paragraph.map(parseInline) });
    if (list) blocks.push({ kind: "list", ordered: list.ordered, start: list.start, items: list.items.map(parseInline) });
    paragraph = [];
    list = null;
  };

  for (const raw of text.replace(/\r\n?/g, "\n").split("\n")) {
    const line = raw.trimEnd();
    if (line.trim() === "") { flush(); continue; }
    const heading = HEADING.exec(line);
    if (heading) { flush(); blocks.push({ kind: "heading", inline: parseInline(heading[1] ?? "") }); continue; }
    const bullet = BULLET.exec(line);
    const numbered = bullet ? null : NUMBERED.exec(line);
    if (bullet || numbered) {
      const ordered = !!numbered;
      if (paragraph.length || (list && list.ordered !== ordered)) flush();
      if (!list) list = { ordered, start: numbered ? Number(numbered[1]) : 1, items: [] };
      list.items.push((bullet ? bullet[1] : numbered![2]) ?? "");
      continue;
    }
    // A line indented under a list item carries on that item.
    if (list && /^\s+/.test(raw)) { list.items[list.items.length - 1] += ` ${line.trim()}`; continue; }
    if (list) flush();
    paragraph.push(line);
  }
  flush();
  return blocks;
}

/** Only addresses that open a page or a mail: never `javascript:` or `data:`. */
export function safeHref(href: string): string | null {
  const trimmed = href.trim();
  return /^(https?:\/\/|mailto:)/i.test(trimmed) ? trimmed : null;
}

const INLINE = /`([^`\n]+)`|\[([^\]\n]+)\]\(([^)\s]+)\)|\*\*(?=\S)([^*\n]*?\S)\*\*|__(?=\S)([^_\n]*?\S)__|(?<![\w*])\*(?=[^\s*])([^*\n]*?[^\s*])\*(?![\w*])|(?<![\w_])_(?=[^\s_])([^_\n]*?[^\s_])_(?![\w_])/g;

export function parseInline(text: string): Inline[] {
  const out: Inline[] = [];
  const push = (part: Inline) => {
    const last = out[out.length - 1];
    if (part.kind === "text" && last?.kind === "text" && !last.bold === !part.bold && !last.italic === !part.italic) last.text += part.text;
    else out.push(part);
  };
  let at = 0;
  for (const m of text.matchAll(INLINE)) {
    const index = m.index ?? 0;
    if (index > at) push({ kind: "text", text: text.slice(at, index) });
    const [whole, code, linkText, href, bold1, bold2, italic1, italic2] = m;
    if (code !== undefined) push({ kind: "code", text: code });
    else if (linkText !== undefined) {
      const safe = safeHref(href ?? "");
      push(safe ? { kind: "link", text: linkText, href: safe } : { kind: "text", text: linkText });
    } else if (bold1 !== undefined || bold2 !== undefined) {
      // Italic inside bold is common enough (`**an _important_ note**`).
      for (const part of parseInline(bold1 ?? bold2 ?? "")) push(part.kind === "text" ? { ...part, bold: true } : part);
    } else if (italic1 !== undefined || italic2 !== undefined) push({ kind: "text", text: italic1 ?? italic2 ?? "", italic: true });
    else push({ kind: "text", text: whole });
    at = index + whole.length;
  }
  if (at < text.length) push({ kind: "text", text: text.slice(at) });
  return out;
}
