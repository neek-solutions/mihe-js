/**
 * The approval surface for a proposed action, shared by the panel and the orb.
 *
 * It renders `label`, `description` and `input` from the proposal payload,
 * which the runtime copies from its registry, never from the assistant's
 * prose. Text smuggled into a product name or a document therefore cannot
 * change what a user is shown they are about to approve, and it is added as
 * text, so markup in it is shown rather than run.
 *
 * High-risk actions require this tap — the runtime refuses a spoken or typed
 * "yes" for them — so this is a security boundary, not decoration.
 */

import type { ProposalPayload } from "../client";
import { h } from "./dom";
import { formatValue, humanizeKey } from "./format";

export function confirmationCard(
  proposal: ProposalPayload,
  onRespond: (proposalId: string, confirmed: boolean) => void,
): HTMLElement {
  const entries = Object.entries(proposal.input ?? {});
  const high = proposal.risk === "high";

  return h(
    "div",
    { class: "card", attrs: { role: "group", "aria-label": `Confirm: ${proposal.label}` } },
    h(
      "div",
      { class: "card-header" },
      h("strong", {}, proposal.label),
      h("span", { class: high ? "risk risk-high" : "risk" }, high ? "Needs care" : "Confirm"),
    ),
    h("p", { class: "card-description" }, proposal.description),
    entries.length > 0 &&
      h(
        "dl",
        { class: "card-input" },
        ...entries.map(([key, value]) =>
          h(
            "div",
            { class: "card-row" },
            h("dt", { class: "card-key" }, humanizeKey(key)),
            h("dd", { class: "card-value" }, inputValue(value)),
          ),
        ),
      ),
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
        { class: "button-primary", attrs: { type: "button" }, on: { click: () => onRespond(proposal.proposalId, true) } },
        "Confirm",
      ),
    ),
  );
}

/** Lists stay separate so a user can check each line before approving. */
function inputValue(value: unknown): HTMLElement {
  if (Array.isArray(value) && value.length > 0) {
    return h("ol", { class: "input-list" }, ...value.map((item) => h("li", {}, inputValue(item))));
  }
  return h("span", { class: "input-text" }, formatValue(value));
}
