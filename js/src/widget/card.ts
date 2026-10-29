/**
 * The approval surface for a proposed action, shared by the panel and the orb.
 *
 * What it says comes from the card's view (amendment 99): the app's own
 * description of the input that will run, or the registry's display hints,
 * or, with neither, every field of the input by its key. Never the
 * assistant's prose, so text smuggled into a product name or a document
 * cannot change what a user is shown they are about to approve. Everything is
 * added as text, so markup in it is shown rather than run.
 *
 * High-risk actions require this tap — the runtime refuses a spoken or typed
 * "yes" for them — so this is a security boundary, not decoration.
 */

import { hintedView, type CardLine, type CardView } from "../card-view";
import type { ProposalPayload } from "../client";
import { h } from "./dom";

export function confirmationCard(
  proposal: ProposalPayload,
  onRespond: (proposalId: string, confirmed: boolean) => void,
  view: CardView | "pending" = hintedView(proposal),
): HTMLElement {
  const high = proposal.risk === "high";
  const pending = view === "pending";
  const v = pending ? null : view;
  const description = v && v.source !== "plain"
    ? h("details", { class: "card-more" }, h("summary", {}, "More about this"), h("p", { class: "card-description" }, proposal.description))
    : h("p", { class: "card-description" }, proposal.description);

  return h(
    "div",
    { class: "card", attrs: { role: "group", "aria-label": `Confirm: ${proposal.label}`, "aria-busy": pending ? "true" : undefined } },
    h(
      "div",
      { class: "card-header" },
      h("strong", {}, proposal.label),
      h("span", { class: high ? "risk risk-high" : "risk" }, high ? "Needs care" : "Confirm"),
    ),
    pending && h("p", { class: "card-description" }, "Checking the details…"),
    v?.summary && h("p", { class: "card-summary" }, v.summary),
    v && v.source === "plain" && description,
    v && v.lines.length > 0 && h("dl", { class: "card-input" }, ...v.lines.map(cardLine)),
    v?.note && h("p", { class: "card-note" }, v.note),
    v && v.source !== "plain" && description,
    h(
      "div",
      { class: "card-actions" },
      h(
        "button",
        { class: "button-secondary", attrs: { type: "button" }, on: { click: () => onRespond(proposal.proposalId, false) } },
        "Cancel",
      ),
      h(
        "button",
        { class: high ? "button-primary button-danger" : "button-primary", attrs: { type: "button", disabled: pending ? "" : undefined }, on: { click: () => { if (!pending) onRespond(proposal.proposalId, true); } } },
        v?.confirmLabel ?? "Confirm",
      ),
    ),
  );
}

/** One line: its label, then pictures, what it was and what it becomes, and any list (each entry checkable on its own). */
function cardLine(line: CardLine): HTMLElement {
  // With pictures: the pictures on the left, what they are beside them, so rows line up whatever the names.
  if (line.images?.length) {
    return h(
      "div",
      { class: "card-media-row" },
      h("span", { class: "card-images" }, ...line.images.map((im) => h("img", { attrs: { src: im.src, alt: im.alt ?? "", loading: "lazy", referrerpolicy: "no-referrer" } }))),
      h("span", { class: "card-media-text" }, line.label && h("dt", { class: "card-media-label" }, line.label), h("dd", { class: line.label ? "card-media-value" : "card-media-value card-media-strong" }, ...lineValue(line))),
    );
  }
  const value = h(
    "dd",
    { class: line.label ? "card-value" : "card-value card-value-wide" },
    ...lineValue(line),
  );
  return h("div", { class: "card-row" }, line.label && h("dt", { class: "card-key" }, line.label), value);
}

/** What a line says: what it was, what it becomes, and any list. */
function lineValue(line: CardLine) {
  return [
    line.before !== undefined && h("s", { class: "card-before" }, line.before),
    line.before !== undefined && h("span", { class: "card-arrow", attrs: { "aria-label": "becomes" } }, " → "),
    line.text !== undefined && h("span", { class: "input-text" }, line.text),
    !!line.items?.length && h("ol", { class: "input-list" }, ...line.items.map((item) => h("li", {}, h("span", { class: "input-text" }, item)))),
  ];
}
