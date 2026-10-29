/**
 * mountCall (amendment 107): the call on its own, anywhere on the page, drawn
 * by the same view as the classic panel's call.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createMihe, mountCall, type Mihe } from "../src/index";

class LiveSocket {
  static last: LiveSocket | null = null;
  onopen: ((e: unknown) => void) | null = null;
  onclose: ((e: unknown) => void) | null = null;
  onerror: ((e: unknown) => void) | null = null;
  onmessage: ((e: { data: unknown }) => void) | null = null;
  constructor() { LiveSocket.last = this; }
  send() {}
  close() {}
  open() {
    this.onopen?.({});
    this.onmessage?.({ data: JSON.stringify({ type: "auth_ok", data: { sessionId: "s", conversationId: "c", heartbeatIntervalMs: 30000, registryStatus: "unknown", voiceAvailable: true } }) });
  }
}

let mihe: Mihe;
const setVoice = (patch: object) => (mihe as unknown as { setVoice: (p: object) => void }).setVoice(patch);
const setState = (patch: object) => (mihe as unknown as { setState: (p: object) => void }).setState(patch);

beforeEach(async () => {
  LiveSocket.last = null;
  vi.stubGlobal("WebSocket", class { constructor() { return new LiveSocket() as never; } });
  mihe = createMihe({ url: "ws://runtime.test/v1/ws", publicKey: "pk_test_0123456789abcdef", getUserToken: () => Promise.resolve("jwt") });
  await vi.waitFor(() => expect(LiveSocket.last).not.toBeNull());
  LiveSocket.last!.open();
});
afterEach(() => { mihe.destroy(); vi.unstubAllGlobals(); document.body.innerHTML = ""; });

describe("mountCall", () => {
  it("shows nothing while there's no call, and the call while there is", () => {
    const call = mountCall(mihe);
    expect(call.element.parentElement).toBe(document.body);
    expect(call.element.style.display).toBe("none");
    setVoice({ state: "speaking", handsFree: true, caption: "I've moved the button under the headline" });
    expect(call.element.style.display).toBe("");
    const root = call.element.shadowRoot!;
    expect(root.querySelector(".call-host-floating")).not.toBeNull();
    expect(root.querySelector(".call-line")?.textContent).toBe("I've moved the button under the headline");
    setVoice({ state: "idle", caption: "" });
    expect(call.element.style.display).toBe("none");
  });

  it("holds the last line, shows why a request failed, and ends the call", () => {
    const call = mountCall(mihe);
    const root = call.element.shadowRoot!;
    setVoice({ state: "speaking", handsFree: true, caption: "That couldn't be done just now." });
    setVoice({ state: "listening", caption: "" });
    expect(root.querySelector(".call-line")?.textContent).toBe("That couldn't be done just now.");
    setState({ lastError: "The model didn't answer in time." });
    expect(root.querySelector<HTMLElement>(".call-failed")?.hidden).toBe(false);
    const stop = vi.spyOn(mihe.voice, "stop");
    root.querySelector<HTMLButtonElement>(".call-end")!.click();
    expect(stop).toHaveBeenCalled();
  });

  it("offers hold to talk when the call isn't hands-free", () => {
    const call = mountCall(mihe);
    setVoice({ state: "listening", handsFree: false });
    const hold = call.element.shadowRoot!.querySelector<HTMLButtonElement>(".call-hold")!;
    expect(hold.hidden).toBe(false);
    expect(hold.textContent).toBe("Hold to talk");
  });

  it("goes inside an element of the page's, and leaves cleanly", () => {
    const slot = document.createElement("div");
    document.body.appendChild(slot);
    const call = mountCall(mihe, { layout: "inline", container: slot });
    expect(call.element.parentElement).toBe(slot);
    expect(call.element.shadowRoot!.querySelector(".call-host-inline")).not.toBeNull();
    call.unmount();
    expect(slot.children).toHaveLength(0);
    // No longer listening: a later call changes nothing it drew.
    setVoice({ state: "speaking", handsFree: true, caption: "hello" });
    expect(call.element.style.display).toBe("none");
  });
});
