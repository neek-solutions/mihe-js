import { beforeEach, describe, expect, it } from "vitest";

import { COMPONENT_ATTRIBUTE, HighlightEngine } from "../src/highlight";

const OVERLAY = "mihe-highlight";

function mount(componentKey: string, tag = "input"): HTMLElement {
  const element = document.createElement(tag);
  element.setAttribute(COMPONENT_ATTRIBUTE, componentKey);
  document.body.appendChild(element);
  return element;
}

function overlay(): HTMLElement | null {
  return document.getElementById(OVERLAY);
}

/** MutationObserver callbacks are microtasks; the reposition is a frame. */
async function settle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
  await new Promise((resolve) => setTimeout(resolve, 0));
}

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("dismissing a highlight", () => {
  it("clears itself when its target leaves the page", async () => {
    // The reported bug: the assistant focused a field in a form, the form
    // closed on submit, and the overlay stayed — dimming the whole page,
    // anchored to an element that no longer existed. `position` did check for
    // this, but only ran on scroll and resize, so a page that sat still kept
    // the overlay forever.
    const engine = new HighlightEngine();
    const field = mount("productForm.name");

    engine.highlight("productForm.name", "Enter the product name here");
    expect(overlay()).not.toBeNull();

    field.remove();
    await settle();

    expect(overlay()).toBeNull();
  });

  it("clears on Escape", () => {
    const engine = new HighlightEngine();
    mount("productForm.name");
    engine.highlight("productForm.name");

    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));

    expect(overlay()).toBeNull();
  });

  it("clears when the user clicks somewhere else", () => {
    // The overlay dims the page like a modal but passes clicks through, so a
    // user who clicks away gets an app that responds and a dim that does not.
    const engine = new HighlightEngine();
    mount("productForm.name");
    const elsewhere = document.createElement("button");
    document.body.appendChild(elsewhere);

    engine.highlight("productForm.name");
    elsewhere.dispatchEvent(new Event("pointerdown", { bubbles: true }));

    expect(overlay()).toBeNull();
  });

  it("survives a click into an input it is pointing at", () => {
    // This once said the same of a button, reasoning that "tearing the caption
    // away before the button's own handler runs would be its own bug." The
    // concern does not materialise — the overlay is `pointerEvents: none`, so
    // it never receives the event and removing it cannot stop the button's
    // handler — and the behaviour it protected turned out to be the visible
    // one: the assistant highlighted "Receive Stock", the user clicked, the
    // dialog opened, and the ring stayed behind it pointing at nothing.
    //
    // An input is the case the exception was really for. Being asked to fill a
    // field and losing the marker the moment you click into it undoes the
    // pointing, so that one still survives.
    const engine = new HighlightEngine();
    const target = mount("productForm.name", "input");

    engine.highlight("productForm.name", "Type the name here.");
    target.dispatchEvent(new Event("pointerdown", { bubbles: true }));

    expect(overlay()).not.toBeNull();
    engine.clear();
  });

  it("stops listening once cleared, so a stale target cannot resurrect it", async () => {
    const engine = new HighlightEngine();
    const field = mount("productForm.name");
    engine.highlight("productForm.name");
    engine.clear();

    field.remove();
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    await settle();

    expect(overlay()).toBeNull();
  });
});

describe("a highlight that has served its purpose", () => {
  it("clears when the button it points at is clicked", () => {
    // The bug this pins, seen in a real integration: the assistant highlighted
    // "Receive Stock", the user clicked, the dialog opened — and the outline
    // stayed behind the modal, ringing a button nobody needed any more.
    const engine = new HighlightEngine();
    const button = mount("inventory.receiveStockButton", "button");

    expect(engine.highlight("inventory.receiveStockButton")).toBe(true);
    expect(overlay()).not.toBeNull();

    button.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    expect(overlay(), "clicking the button is the action; the ring is spent").toBeNull();
  });

  it("still clears when the click lands somewhere else entirely", () => {
    const engine = new HighlightEngine();
    mount("inventory.receive.quantity", "input");
    engine.highlight("inventory.receive.quantity");

    document.body.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    expect(overlay()).toBeNull();
  });
});
