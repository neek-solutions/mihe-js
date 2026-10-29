/**
 * What a confirmation card says (amendment 99), worked out once per proposal
 * and drawn by every card Mihe has: the web component's and the React SDK's.
 *
 * Two sources, both trusted, neither the model:
 *
 * 1. **The app's own description.** `describeProposal` (an option) is handed
 *    the proposal, exactly the input that will run, and returns the lines to
 *    show: before and after, money in the store's currency, thumbnails. It is
 *    the app's code over the app's data, so it can say what a generic card
 *    can't. It must describe the input it was given, never anything else.
 * 2. **The registry's display hints**, for an app that doesn't describe a
 *    card. They live in the action's input schema as annotations: a summary
 *    template at the root (`x-mihe-summary`), and on each field a `title`,
 *    `x-mihe-format` (`money`, `yesno`, `date`) and `x-mihe-hidden`. Fields
 *    are shown in the schema's order. Hide only an opaque id that has a
 *    readable name beside it which the app checks: everything else that will
 *    run must be on the card.
 *
 * With neither, the card is what it always was: every field, by its key.
 */

import type { ProposalPayload } from "./client";
import { formatValue, humanizeKey } from "./widget/format";

/** One line of a card. */
export interface CardLine {
  /** What the line is about: "Price", "Amber Soy Candle". */
  label?: string;
  /** The value, or what it becomes. */
  text?: string;
  /** What it was before, shown struck through ahead of `text`. */
  before?: string;
  /** A list, each entry on its own line so each can be checked. */
  items?: string[];
  /** Pictures of what the line is about, small. http(s), blob: and data:image only. */
  images?: { src: string; alt?: string }[];
}

/** What `describeProposal` returns. */
export interface ProposalDescription {
  /** One line saying what will happen: "Change Linen Shirt's price". */
  summary?: string;
  lines: CardLine[];
  /** A short note under the lines: "All start as drafts." */
  note?: string;
  /** The confirm button's words: "Make 3 products". Defaults to "Confirm". */
  confirmLabel?: string;
}

/**
 * Describes a proposal for its card, from the app's own data. Return null (or
 * throw) to fall back to the registry's hints. Called once per proposal; the
 * card waits for it, with Confirm disabled, for up to four seconds.
 */
export type DescribeProposal = (proposal: ProposalPayload) => ProposalDescription | null | undefined | Promise<ProposalDescription | null | undefined>;

/** A card ready to draw. */
export interface CardView extends ProposalDescription {
  /** Where it came from: the app, the registry's hints, or neither. */
  source: "app" | "hints" | "plain";
}

type Schema = { title?: unknown; properties?: Record<string, Schema>; items?: Schema; "x-mihe-summary"?: unknown; "x-mihe-format"?: unknown; "x-mihe-hidden"?: unknown };
const asSchema = (v: unknown): Schema => (v && typeof v === "object" ? (v as Schema) : {});
const hidden = (s: Schema) => s["x-mihe-hidden"] === true;
const title = (key: string, s: Schema) => (typeof s.title === "string" && s.title.trim() ? s.title : humanizeKey(key));

/** One value, as its field's hints say to show it. */
export function formatField(value: unknown, schema: unknown): string {
  const s = asSchema(schema);
  const fmt = s["x-mihe-format"];
  if (fmt === "yesno" && typeof value === "boolean") return value ? "Yes" : "No";
  if (fmt === "money" && typeof value === "number") return value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (fmt === "date" && typeof value === "string" && !Number.isNaN(Date.parse(value))) return new Date(value).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
  if (Array.isArray(value)) return value.map((v) => formatField(v, s.items)).join(", ") || "—";
  if (value && typeof value === "object") {
    const props = s.properties ?? {};
    const keys = [...Object.keys(props).filter((k) => k in (value as object)), ...Object.keys(value as object).filter((k) => !(k in props))];
    const visible = keys.filter((k) => !hidden(asSchema(props[k])));
    // With hints, an object reads as its fields in order, labelled by their titles ("Amber Candle · Price 18").
    if (Object.keys(props).length) return visible.map((k) => (k === visible[0] && typeof (value as any)[k] === "string" ? String((value as any)[k]) : `${title(k, asSchema(props[k]))} ${formatField((value as any)[k], props[k])}`)).join(" · ");
    return formatValue(value);
  }
  return formatValue(value);
}

/** `x-mihe-summary`, filled from the input: "Change {productName}" → "Change Linen Shirt". Null if a field it names is missing. */
export function fillSummary(template: unknown, input: Record<string, unknown>, schema: Schema): string | null {
  if (typeof template !== "string" || !template.trim()) return null;
  let missing = false;
  const out = template.replace(/\{([A-Za-z0-9_]+)\}/g, (_, key: string) => {
    const v = input[key];
    if (v === undefined || v === null || v === "") { missing = true; return ""; }
    return Array.isArray(v) ? String(v.length) : formatField(v, schema.properties?.[key]);
  });
  return missing ? null : out;
}

/** The card from the registry's hints (or, with none, every field by its key). */
export function hintedView(proposal: ProposalPayload): CardView {
  const schema = asSchema(proposal.inputSchema);
  const props = schema.properties ?? {};
  const input = proposal.input ?? {};
  const hinted = !!schema["x-mihe-summary"] || Object.values(props).some((p) => { const s = asSchema(p); return typeof s.title === "string" || hidden(s) || s["x-mihe-format"] !== undefined; });
  const keys = [...Object.keys(props).filter((k) => k in input), ...Object.keys(input).filter((k) => !(k in props))];
  const lines: CardLine[] = keys.filter((k) => !hidden(asSchema(props[k]))).map((k) => {
    const v = input[k];
    const label = hinted ? title(k, asSchema(props[k])) : humanizeKey(k);
    return Array.isArray(v) && v.length > 0 ? { label, items: v.map((x) => formatField(x, asSchema(props[k]).items)) } : { label, text: formatField(v, props[k]) };
  });
  const summary = fillSummary(schema["x-mihe-summary"], input, schema) ?? undefined;
  return { source: hinted ? "hints" : "plain", ...(summary ? { summary } : {}), lines };
}

const SAFE_SRC = /^(https?:|blob:|data:image\/)/i;

/** The app's description, made safe to draw (only plain strings, only picture addresses that can't run anything). */
export function appView(d: ProposalDescription): CardView {
  const str = (v: unknown) => (typeof v === "string" ? v : v === undefined || v === null ? undefined : String(v));
  return {
    source: "app",
    ...(str(d.summary) ? { summary: str(d.summary) } : {}),
    ...(str(d.note) ? { note: str(d.note) } : {}),
    ...(str(d.confirmLabel) ? { confirmLabel: str(d.confirmLabel) } : {}),
    lines: (Array.isArray(d.lines) ? d.lines : []).map((l) => ({
      ...(str(l.label) ? { label: str(l.label) } : {}),
      ...(str(l.text) !== undefined ? { text: str(l.text) } : {}),
      ...(str(l.before) !== undefined ? { before: str(l.before) } : {}),
      ...(Array.isArray(l.items) ? { items: l.items.map((x) => String(x)) } : {}),
      ...(Array.isArray(l.images) ? { images: l.images.filter((im) => im && typeof im.src === "string" && SAFE_SRC.test(im.src)).slice(0, 12).map((im) => ({ src: im.src, ...(str(im.alt) ? { alt: str(im.alt) } : {}) })) } : {}),
    })),
  };
}

/** How long a card waits for the app's description before drawing from the hints. */
export const DESCRIBE_TIMEOUT_MS = 4000;
