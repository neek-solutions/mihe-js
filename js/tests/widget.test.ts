/**
 * `<mihe-assistant>` (doc 08, phase 2).
 *
 * The React widget's behaviour, pinned again for the web component: the
 * same card from the same payload, the orb's menu and gestures, the
 * dashboard's settings and the launcher icon. Plus what only the plain DOM
 * version can get wrong, such as rebuilding a button a finger is holding.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ASSISTANT_PANEL_ID, createMihe, mountWidget } from "../src/index";
import type { Mihe, MountedWidget, WidgetOptions } from "../src/index";

class LiveSocket {
  static last: LiveSocket | null = null;

  onopen: ((event: unknown) => void) | null = null;
  onclose: ((event: unknown) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  sent: { type: string; data: Record<string, unknown> }[] = [];

  constructor() {
    LiveSocket.last = this;
  }

  send(data: string) {
    this.sent.push(JSON.parse(data));
  }

  close() {}

  open(extra: Record<string, unknown> = {}) {
    this.onopen?.({});
    this.receive({
      type: "auth_ok",
      data: {
        sessionId: "sess_1",
        conversationId: "conv_1",
        heartbeatIntervalMs: 30000,
        registryStatus: "unknown",
        voiceAvailable: false,
        ...extra,
      },
    });
  }

  receive(frame: unknown) {
    this.onmessage?.({ data: JSON.stringify(frame) });
  }
}

let mihe: Mihe;
let mounted: MountedWidget;
let socket: LiveSocket;

/** The widget, mounted and connected, with the handshake not yet answered. */
async function start(options: WidgetOptions & { container?: Element } = {}) {
  mihe = createMihe({
    url: "ws://runtime.test/v1/ws",
    publicKey: "pk_test_0123456789abcdef",
    getUserToken: () => Promise.resolve("jwt"),
  });
  mounted = mountWidget(mihe, options);
  await vi.waitFor(() => expect(LiveSocket.last).not.toBeNull());
  socket = LiveSocket.last!;
}

/** Started and handshaken: voice on or off, and the app's widget settings. */
async function connected(
  options: WidgetOptions & { container?: Element } = {},
  voiceAvailable = false,
  widget?: Record<string, unknown>,
) {
  await start(options);
  socket.open({ voiceAvailable, ...(widget ? { widget } : {}) });
}

const shadow = () => mounted.element.shadowRoot!;
const query = <T extends Element = HTMLElement>(selector: string) => shadow().querySelector<T>(selector);
const visible = (element: Element | null) => element !== null && !(element as HTMLElement).closest("[hidden]");
const panel = () => shadow().getElementById(ASSISTANT_PANEL_ID);
const panelShown = () => visible(panel());

/** A tap as a finger makes one: down and up in the same place. */
function tap(element: Element) {
  element.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0, clientX: 10, clientY: 10 }));
  element.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, button: 0, clientX: 10, clientY: 10 }));
}

const orb = () => query<HTMLButtonElement>("button.orb")!;
const launcher = () => query<HTMLButtonElement>("button.launcher")!;
const menuItems = () =>
  Array.from(shadow().querySelectorAll("[role='menuitem']"))
    .filter(visible)
    .map((item) => item.textContent);

const proposal = {
  turnId: "t1",
  proposalId: "prop_1",
  actionName: "refund_order",
  label: "Refund order",
  description: "Refund to the original payment method.",
  risk: "high",
  input: { orderId: "1042" },
  inputSchema: { type: "object" },
  expiresAt: new Date(Date.now() + 60_000).toISOString(),
  uiConfirmationRequired: true,
};

beforeEach(() => {
  LiveSocket.last = null;
  window.localStorage.clear();
  vi.stubGlobal(
    "WebSocket",
    class {
      constructor() {
        return new LiveSocket() as never;
      }
    },
  );
});

afterEach(() => {
  mounted?.unmount();
  mihe?.destroy();
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

describe("the element", () => {
  it("draws inside a shadow root, so the host page's CSS cannot reach it", async () => {
    // Measured uses Tailwind, whose base styles reset every button on the
    // page. In the light DOM the widget would inherit that.
    await connected();
    expect(mounted.element.tagName).toBe("MIHE-ASSISTANT");
    expect(mounted.element.shadowRoot).not.toBeNull();
    expect(document.querySelector("button.orb")).toBeNull();
    expect(query("style")!.textContent).toContain(":host");
  });

  it("stops drawing when removed, and the assistant stays connected", async () => {
    await connected();
    mounted.unmount();
    mihe.open();
    expect(mihe.getState().connection).toBe("open");
    expect(mounted.element.isConnected).toBe(false);
  });
});

describe("the confirmation card", () => {
  it("shows each line and its fields as escaped text before confirming", async () => {
    await connected({ form: "classic", defaultOpen: true });
    socket.receive({
      type: "action_proposal",
      data: {
        ...proposal,
        label: "Create order",
        input: {
          items: [
            { productName: "<img src=x onerror=alert(1)>", quantity: 2, unitPrice: 1500, totalPrice: 3000 },
            { productName: "Baguette", quantity: 1, unitPrice: 0, totalPrice: 0 },
          ],
          currency: "EUR",
          deliveryFee: 500,
        },
      },
    });
    const card = query("[aria-label='Confirm: Create order']")!;
    expect(card.querySelectorAll("ol > li")).toHaveLength(2);
    expect(card.textContent).toContain("Unit price: 1500; Total price: 3000");
    expect(card.textContent).toContain("<img src=x onerror=alert(1)>");
    expect(card.querySelector("img")).toBeNull();

    card.querySelectorAll("button")[1]!.click();
    expect(socket.sent.find((frame) => frame.type === "action_confirm")?.data).toMatchObject({
      proposalId: "prop_1",
      confirmed: true,
    });
  });
});

describe("the launcher icon", () => {
  it("is the Mihe mark until the app says otherwise", async () => {
    await start({ form: "classic" });
    expect(launcher().querySelector("svg")).not.toBeNull();
    socket.open();
    expect(launcher().querySelector("img")).toBeNull();
  });

  it("is the icon uploaded in the dashboard, delivered with the handshake", async () => {
    await start({ form: "classic" });
    socket.open({ launcherIconUrl: "https://cdn.test/launcher-icons/app_1/ab12.png" });
    const img = launcher().querySelector("img")!;
    expect(img.getAttribute("src")).toBe("https://cdn.test/launcher-icons/app_1/ab12.png");
    expect(img.getAttribute("alt")).toBe("");
  });

  it("falls back to the mark when the image cannot load, rather than an empty circle", async () => {
    await start();
    socket.open({ launcherIconUrl: "https://cdn.test/blocked.png" });
    orb().querySelector("img")!.dispatchEvent(new Event("error"));
    expect(orb().querySelector("img")).toBeNull();
    expect(orb().querySelector("svg")).not.toBeNull();
  });

  it("is whatever the host app passes in code, over both", async () => {
    const own = document.createElement("span");
    own.dataset.own = "";
    await start({ launcherIcon: own });
    socket.open({ launcherIconUrl: "https://cdn.test/launcher-icons/app_1/ab12.png" });
    expect(orb().querySelector("[data-own]")).not.toBeNull();
    expect(orb().querySelector("img")).toBeNull();
  });
});

describe("the orb (amendment 61)", () => {
  it("is the default form, and opens chat directly when chat is the only mode", async () => {
    await connected();
    expect(orb().getAttribute("aria-label")).toBe("Open Assistant");
    tap(orb());
    expect(panelShown()).toBe(true);
    expect(menuItems()).toEqual([]);
  });

  it("shows no end-voice button when no voice session is running", async () => {
    await connected({}, false);
    expect(visible(query("button[aria-label='End voice']"))).toBe(false);
  });

  it("offers chat and each allowed voice mode when voice is on", async () => {
    await connected({}, true);
    tap(orb());
    expect(menuItems()).toEqual(["Chat", "Talk", "Hold to talk"]);
  });

  it("offers only the voice modes passed in code", async () => {
    await connected({ voiceModes: ["hold"] }, true);
    tap(orb());
    expect(menuItems()).toEqual(["Chat", "Hold to talk"]);
  });

  it("closes its menu on Escape and hands focus back to the orb", async () => {
    await connected({}, true);
    tap(orb());
    query("[role='menu']")!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(menuItems()).toEqual([]);
    expect(shadow().activeElement).toBe(orb());
  });

  it("opens the panel from the menu's Chat, in the orb's place, with no microphone", async () => {
    // Voice is the orb's; the panel it opens has no second way into it.
    await connected({}, true);
    tap(orb());
    query<HTMLButtonElement>("[role='menuitem']")!.click();
    expect(panelShown()).toBe(true);
    expect(visible(orb())).toBe(false);
    expect(visible(query("button[aria-label='Start voice']"))).toBe(false);
  });

  it("pops a proposal out of the orb as the same card, with the panel closed", async () => {
    await connected({}, true);
    socket.receive({ type: "action_proposal", data: proposal });
    expect(panelShown()).toBe(false);
    const card = Array.from(shadow().querySelectorAll("[aria-label='Confirm: Refund order']")).find(visible);
    expect(card?.textContent).toContain("Refund to the original payment method.");
  });

  it("snaps a dragged orb to the nearer side and remembers it, and a drag is not a tap", async () => {
    await connected({ draggable: true });
    const from = { clientX: window.innerWidth - 40, clientY: window.innerHeight - 40 };
    orb().dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0, ...from }));
    orb().dispatchEvent(new PointerEvent("pointermove", { bubbles: true, clientX: 60, clientY: 200 }));
    orb().dispatchEvent(new PointerEvent("pointerup", { bubbles: true, clientX: 60, clientY: 200 }));

    expect(panelShown()).toBe(false);
    expect(orb().style.left).toBe("20px");
    expect(JSON.parse(window.localStorage.getItem("mihe:orb-position")!).side).toBe("left");
  });

  it("sits where the offset puts it, clear of another widget in the corner, and so does its panel", async () => {
    // A page with its own support chat in the same corner: Mihe lifts above
    // it rather than stacking on it.
    await connected({ offset: { bottom: 96, side: 24 } });
    expect(orb().style.top).toBe(`${window.innerHeight - 96 - 56}px`);
    expect(orb().style.left).toBe(`${window.innerWidth - 24 - 56}px`);
    tap(orb());
    expect(panel()!.style.bottom).toBe("96px");
    expect(panel()!.style.right).toBe("24px");
  });

  it("does not move when it is not draggable", async () => {
    await connected();
    const before = orb().style.left;
    orb().dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0, clientX: 900, clientY: 700 }));
    orb().dispatchEvent(new PointerEvent("pointermove", { bubbles: true, clientX: 60, clientY: 200 }));
    expect(orb().style.left).toBe(before);
    expect(window.localStorage.getItem("mihe:orb-position")).toBeNull();
  });
});

describe("settings from the dashboard", () => {
  const settings = (overrides: Record<string, unknown>) => ({
    form: "orb",
    draggable: false,
    corner: "bottom-right",
    voiceModes: ["hands-free", "hold"],
    ...overrides,
  });

  it("choose the form, with no deploy of the host app", async () => {
    await connected({}, true, settings({ form: "classic" }));
    launcher().click();
    expect(visible(query("button[aria-label='Start voice']"))).toBe(true);
  });

  it("are overridden in code", async () => {
    await connected({ form: "orb" }, true, settings({ form: "classic" }));
    expect(orb().getAttribute("aria-label")).toBe("Assistant: choose chat or voice");
  });

  it("can be narrowed in code, never widened", async () => {
    // The runtime refuses hands-free for this app, so offering it would be a
    // button that fails.
    await connected({ voiceModes: ["hands-free", "hold"] }, true, settings({ voiceModes: ["hold"] }));
    tap(orb());
    expect(menuItems()).toEqual(["Chat", "Hold to talk"]);
  });

  it("hide a mode the app does not allow from the classic panel too", async () => {
    await connected({ form: "classic", defaultOpen: true }, true, settings({ voiceModes: ["hold"] }));
    expect(visible(query("button[aria-label='Start voice']"))).toBe(true);
    expect(visible(query("button[aria-label='Start hands-free voice']"))).toBe(false);
  });

  it("can be written as attributes, for a widget placed in HTML", async () => {
    await connected({}, true);
    mounted.element.setAttribute("form", "classic");
    expect(visible(launcher())).toBe(true);
    expect(visible(orb())).toBe(false);
  });
});

describe("the classic form", () => {
  it("opens from its launcher, and its panel has the microphone", async () => {
    await connected({ form: "classic" }, true);
    expect(launcher().getAttribute("aria-label")).toBe("Open Assistant");
    launcher().click();
    expect(panelShown()).toBe(true);
    expect(visible(launcher())).toBe(false);
    expect(visible(query("button[aria-label='Start voice']"))).toBe(true);
  });

  it("hides its launcher on request, so the user does not get two", async () => {
    await connected({ form: "classic", showLauncher: false });
    expect(visible(launcher())).toBe(false);
    mihe.open();
    expect(panelShown()).toBe(true);
  });

  it("honours defaultOpen once, without fighting a host trigger afterwards", async () => {
    await connected({ form: "classic", defaultOpen: true });
    expect(panelShown()).toBe(true);
    mihe.close();
    expect(panelShown()).toBe(false);
  });
});

describe("the panel", () => {
  it("sits inline in the host's container, with no launcher", async () => {
    const sidebar = document.createElement("aside");
    document.body.appendChild(sidebar);
    await connected({ layout: "inline", container: sidebar });
    expect(sidebar.contains(mounted.element)).toBe(true);
    expect(panelShown()).toBe(true);
    expect(panel()!.classList.contains("floating")).toBe(false);
    expect(visible(orb())).toBe(false);
  });

  it("sends what is typed, keeps it through redraws, and shows the reply", async () => {
    await connected({ layout: "inline" });
    const input = query<HTMLInputElement>("input")!;
    input.value = "How many orders are pending?";
    input.dispatchEvent(new Event("input"));
    // A redraw mid-typing must not wipe the draft.
    socket.receive({ type: "turn_start", data: { turnId: "t0" } });
    expect(input.value).toBe("How many orders are pending?");

    query("form")!.dispatchEvent(new Event("submit", { cancelable: true }));
    expect(socket.sent.find((frame) => frame.type === "message")?.data.text).toBe("How many orders are pending?");
    expect(input.value).toBe("");
    expect(panel()!.textContent).toContain("How many orders are pending?");
  });

  it("takes its title from the app's settings, and code still overrides it", async () => {
    await connected({ layout: "inline" }, false);
    socket.open({ assistantName: "Ada" });
    expect(query(".header-title")!.textContent).toBe("Ada");
    mounted.element.options = { layout: "inline", title: "Help" };
    expect(query(".header-title")!.textContent).toBe("Help");
  });

  it("keeps the same push-to-talk button through every state, so a held press is never lost", async () => {
    // A button replaced mid-press loses its pointer capture: the release
    // lands on something else and the microphone stays open.
    await connected({ form: "classic", defaultOpen: true }, true);
    const button = query<HTMLButtonElement>("button[aria-label='Start voice']")!;
    for (const state of ["recording", "thinking", "speaking", "listening"]) {
      (mihe as unknown as { setVoice: (patch: object) => void }).setVoice({ state });
      expect(query("button.mic")).toBe(button);
    }
    expect(button.getAttribute("aria-label")).toBe("Hold to speak");
  });
});
