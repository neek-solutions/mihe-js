import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The call reads the assistant's state; here it is set by hand, as a call would.
let state: Record<string, unknown>;
vi.mock("../src/provider", () => ({ useAssistant: () => state }));
import { AssistantCall } from "../src/call";

const voice = (over: Record<string, unknown>) => ({
  available: true, state: "listening", handsFree: true, caption: "", notice: null,
  start: vi.fn(), stop: vi.fn(), press: vi.fn(), release: vi.fn(), confirm: vi.fn(), discard: vi.fn(), onLevel: () => () => {},
  ...over,
});

let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
const draw = () => act(() => root.render(<AssistantCall />));
beforeEach(() => { container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container); });
afterEach(() => { act(() => root.unmount()); container.remove(); });

describe("a voice call on its own (amendment 105)", () => {
  it("shows nothing when there's no call", () => {
    state = { voice: voice({ state: "idle" }), proposals: [], cardViews: {}, respondToProposal: vi.fn(), lastError: null };
    draw();
    expect(container.textContent).toBe("");
  });

  it("shows one line of what's said, and holds the last line until the next begins", () => {
    state = { voice: voice({ state: "speaking", caption: "I've changed the hero to a warmer sand colour" }), proposals: [], cardViews: {}, respondToProposal: vi.fn(), lastError: null };
    draw();
    expect(container.textContent).toContain("I've changed the hero to a warmer sand colour");
    state = { ...state, voice: voice({ state: "listening", caption: "" }) };
    draw();
    expect(container.textContent).toContain("I've changed the hero to a warmer sand colour");
  });

  it("ends the call, and offers hold to talk when the call isn't hands-free", () => {
    const v = voice({ state: "listening", handsFree: false });
    state = { voice: v, proposals: [], cardViews: {}, respondToProposal: vi.fn(), lastError: null };
    draw();
    const buttons = [...container.querySelectorAll("button")];
    expect(buttons.map((b) => b.textContent)).toEqual(["Hold to talk", "End"]);
    act(() => buttons[1]!.click());
    expect(v.stop).toHaveBeenCalled();
  });

  it("shows why a request failed on its own line, through what's said, until the next request starts (amendment 106)", () => {
    const base = { proposals: [], cardViews: {}, respondToProposal: vi.fn() };
    state = { ...base, voice: voice({ state: "listening" }), lastError: null };
    draw();
    state = { ...base, voice: voice({ state: "speaking", caption: "That couldn't be done just now." }), lastError: "The model didn't answer in time. Try again." };
    draw();
    expect(container.querySelector("[role='alert']")?.textContent).toBe("The model didn't answer in time. Try again.");
    expect(container.textContent).toContain("That couldn't be done just now.");
    state = { ...state, voice: voice({ state: "thinking" }) };
    draw();
    expect(container.querySelector("[role='alert']")).toBeNull();
  });
});
