/**
 * The host app owns the UI.
 *
 * A customer should be able to trigger the assistant from a button, a div, a
 * command palette, or a keyboard shortcut — and to replace the widget
 * entirely. These tests pin that down, because it is easy to regress by
 * quietly moving state back inside the widget.
 */

import { StrictMode, act, useState } from "react";
import { createRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  AssistantPanel,
  AssistantProvider,
  AssistantWidget,
  useAssistant,
  useAssistantPrompt,
  useAssistantTrigger,
  useAssistantScreen,
  useAssistantTabs,
  useAssistantTable,
  useAssistantChart,
} from "../src/index";
import { ASSISTANT_PANEL_ID } from "../src/provider";

/** A socket that connects but never completes the handshake. */
class SilentSocket {
  onopen: ((event: unknown) => void) | null = null;
  onclose: ((event: unknown) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  sent: string[] = [];
  send(data: string) {
    this.sent.push(data);
  }
  close() {}
}

/**
 * A socket that completes the handshake, so frames the runtime only sends to
 * an open session can be tested.
 */
class LiveSocket {
  static last: LiveSocket | null = null;

  onopen: ((event: unknown) => void) | null = null;
  onclose: ((event: unknown) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  sent: unknown[] = [];

  constructor() {
    LiveSocket.last = this;
  }

  send(data: string) {
    this.sent.push(JSON.parse(data));
  }

  close() {}

  open(assistantName?: string) {
    this.onopen?.({});
    this.receive({
      type: "auth_ok",
      data: {
        sessionId: "sess_1",
        conversationId: "conv_1",
        heartbeatIntervalMs: 30000,
        registryStatus: "unknown",
        voiceAvailable: false,
        ...(assistantName === undefined ? {} : { assistantName }),
      },
    });
  }

  receive(frame: unknown) {
    this.onmessage?.({ data: JSON.stringify(frame) });
  }
}

let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

function render(ui: React.ReactNode) {
  act(() => {
    root.render(
      <AssistantProvider
        url="ws://runtime.test/v1/ws"
        publicKey="pk_test_0123456789abcdef"
        getUserToken={() => Promise.resolve("jwt")}
      >
        {ui}
      </AssistantProvider>,
    );
  });
}

/** The classic panel's way into a call (amendment 105). */
const TALK = () => [...container.querySelectorAll("header button")].find((b) => b.textContent === "Talk");

beforeEach(() => {
  vi.stubGlobal(
    "WebSocket",
    class {
      constructor() {
        return new SilentSocket() as never;
      }
    },
  );
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe("hooks outside a provider", () => {
  it("return null rather than throwing, so shared chrome can render either way", () => {
    // A command palette or a nav item is rendered by the host app whether or
    // not it has configured an assistant. These used to throw there, which
    // made the whole surface conditional on something it has no reason to
    // know about — and crashed an app's command menu when Mihe was
    // unconfigured.
    function Outside() {
      const trigger = useAssistantTrigger();
      const ask = useAssistantPrompt("anything");
      return <span>{String(trigger === null && ask === null)}</span>;
    }
    // Rendered bare on purpose — `render` here wraps in AssistantProvider,
    // which is the thing this test needs absent.
    act(() => {
      root.render(<Outside />);
    });
    expect(container.textContent).toBe("true");
  });
});

describe("useAssistantTrigger", () => {
  it("lets a plain div open and close the assistant", () => {
    function Trigger() {
      const trigger = useAssistantTrigger();
      return <div {...trigger}>Ask</div>;
    }
    render(
      <>
        <Trigger />
        <AssistantWidget showLauncher={false} />
      </>,
    );

    const trigger = container.querySelector("div[role='button']")!;
    expect(document.getElementById(ASSISTANT_PANEL_ID)).toBeNull();

    act(() => {
      trigger.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(document.getElementById(ASSISTANT_PANEL_ID)).not.toBeNull();

    act(() => {
      trigger.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(document.getElementById(ASSISTANT_PANEL_ID)).toBeNull();
  });

  it("makes a div keyboard-operable, which is how custom triggers usually break", () => {
    function Trigger() {
      const trigger = useAssistantTrigger();
      return <div {...trigger}>Ask</div>;
    }
    render(
      <>
        <Trigger />
        <AssistantWidget showLauncher={false} />
      </>,
    );

    const trigger = container.querySelector("div[role='button']")! as HTMLElement;
    expect(trigger.getAttribute("tabindex")).toBe("0");
    expect(trigger.getAttribute("aria-controls")).toBe(ASSISTANT_PANEL_ID);
    expect(trigger.getAttribute("aria-haspopup")).toBe("dialog");

    act(() => {
      trigger.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
      );
    });
    expect(document.getElementById(ASSISTANT_PANEL_ID)).not.toBeNull();
  });

  it("reports open state so a trigger can style itself", () => {
    function Trigger() {
      const trigger = useAssistantTrigger();
      return <button {...trigger}>Ask</button>;
    }
    render(
      <>
        <Trigger />
        <AssistantWidget showLauncher={false} />
      </>,
    );

    const trigger = container.querySelector("button")!;
    expect(trigger.getAttribute("aria-expanded")).toBe("false");

    act(() => {
      trigger.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
  });
});

describe("AssistantWidget", () => {
  it("hides its own launcher on request, so the user does not get two", () => {
    render(<AssistantWidget showLauncher={false} />);
    expect(container.querySelector("button")).toBeNull();
  });

  it("shows a launcher by default", () => {
    render(<AssistantWidget />);
    expect(container.querySelector("button[aria-label='Open Assistant']")).not.toBeNull();
  });

  it("honours defaultOpen without fighting a host trigger afterwards", () => {
    function Closer() {
      const { close } = useAssistant();
      return <button data-testid="closer" onClick={close}>Close</button>;
    }
    render(
      <>
        <Closer />
        <AssistantWidget defaultOpen />
      </>,
    );

    expect(document.getElementById(ASSISTANT_PANEL_ID)).not.toBeNull();

    // defaultOpen is applied once on mount; the host stays in control after.
    act(() => {
      container
        .querySelector("[data-testid='closer']")!
        .dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(document.getElementById(ASSISTANT_PANEL_ID)).toBeNull();
  });
});

describe("AssistantPanel", () => {
  it("renders inline with no launcher and no fixed positioning", () => {
    // The sidebar / drawer / settings-tab case.
    render(<AssistantPanel />);

    const panel = document.getElementById(ASSISTANT_PANEL_ID)!;
    expect(panel).not.toBeNull();
    expect(panel.style.position).not.toBe("fixed");
    expect(container.querySelector("button[aria-label='Close assistant']")).toBeNull();
  });

  it("accepts style overrides for sizing", () => {
    render(<AssistantPanel style={{ height: 400 }} />);
    expect(document.getElementById(ASSISTANT_PANEL_ID)!.style.height).toBe("400px");
  });
});

describe("fully custom UI", () => {
  it("exposes everything a replacement UI needs from useAssistant", () => {
    // If this compiles and reads, no one needs our components at all.
    let seen: ReturnType<typeof useAssistant> | null = null;
    function Custom() {
      seen = useAssistant();
      return null;
    }
    render(<Custom />);

    expect(seen).not.toBeNull();
    expect(Object.keys(seen!).sort()).toEqual([
      "assistantName",
      "attach",
      "attachAccept",
      "attachments",
      "busy",
      "cardViews",
      "close",
      "connection",
      "isOpen",
      "lastError",
      "launcherIconUrl",
      "messages",
      "open",
      "proposals",
      "removeAttachment",
      "respondToProposal",
      "send",
      "store",
      "toggle",
      "voice",
      "widgetSettings",
    ]);
  });

  it("opens when a prompt chip sends, so the reply is visible", () => {
    // Otherwise a "How do I add a product?" chip would answer into a closed
    // panel and look broken.
    function Chip() {
      const ask = useAssistantPrompt("How do I add a product?");
      return <button onClick={ask ?? undefined}>How do I add a product?</button>;
    }
    render(
      <>
        <Chip />
        <AssistantWidget showLauncher={false} />
      </>,
    );

    act(() => {
      container
        .querySelector("button")!
        .dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(document.getElementById(ASSISTANT_PANEL_ID)).not.toBeNull();
    expect(container.textContent).toContain("How do I add a product?");
  });
});

describe("what the panel calls the assistant", () => {
  /** Renders the panel and hands back the socket, which connects async. */
  async function open(ui: React.ReactNode): Promise<LiveSocket> {
    LiveSocket.last = null;
    vi.stubGlobal(
      "WebSocket",
      class {
        constructor() {
          return new LiveSocket() as never;
        }
      },
    );
    render(ui);
    await act(async () => {
      await Promise.resolve();
    });
    return LiveSocket.last!;
  }

  const heading = () =>
    document.getElementById(ASSISTANT_PANEL_ID)!.querySelector("header")!
      .textContent;

  it("takes the name from the app's settings", async () => {
    // The bug this prevents: the name lived in two unconnected places — a
    // `title` prop in the customer's code and `assistant_name` in the
    // dashboard, which is what goes into the system prompt. A customer could
    // rename the assistant in settings and have the header keep saying
    // "Assistant" while the model introduced itself as Kit.
    const socket = await open(<AssistantPanel />);
    act(() => socket.open("Kit"));

    expect(heading()).toContain("Kit");
  });

  it("still lets code override it", async () => {
    // The setting is the default, not a lock: a host app that wants different
    // chrome from the persona's own name keeps having it.
    const socket = await open(<AssistantPanel title="Support" />);
    act(() => socket.open("Kit"));

    expect(heading()).toContain("Support");
  });

  it("says something before the handshake answers", async () => {
    // The name arrives with `auth_ok`, so there is a moment with no name at
    // all — and against an older runtime there never is one. A blank header
    // is worse than a generic one.
    await open(<AssistantPanel />);

    expect(heading()).toContain("Assistant");
  });
});

describe("a settled confirmation card", () => {
  /**
   * Renders inside StrictMode, which is Next's dev default, and waits for the
   * socket — the provider connects only after `getUserToken()` resolves, so it
   * does not exist yet when `render` returns.
   */
  async function renderStrict(
    ui: React.ReactNode,
    onActionComplete?: () => void,
  ): Promise<LiveSocket> {
    LiveSocket.last = null;
    vi.stubGlobal(
      "WebSocket",
      class {
        constructor() {
          return new LiveSocket() as never;
        }
      },
    );

    act(() => {
      root.render(
        <StrictMode>
          <AssistantProvider
            url="ws://runtime.test/v1/ws"
            publicKey="pk_test_0123456789abcdef"
            getUserToken={() => Promise.resolve("jwt")}
            onActionComplete={onActionComplete}
          >
            {ui}
          </AssistantProvider>
        </StrictMode>,
      );
    });

    await act(async () => {
      await Promise.resolve();
    });
    return LiveSocket.last!;
  }

  const proposal = {
    proposalId: "prop_1",
    actionName: "edit_draft_order_items",
    label: "Change the items on this order",
    description: "Replace the items on an order.",
    risk: "medium",
    input: {},
    inputSchema: { type: "object" },
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    uiConfirmationRequired: false,
  };

  function settle(socket: LiveSocket) {
    act(() => socket.open());
    act(() =>
      socket.receive({
        type: "action_proposal",
        data: { turnId: "t1", ...proposal },
      }),
    );
    act(() =>
      socket.receive({
        type: "action_status",
        data: { proposalId: "prop_1", status: "executed", result: { ok: true } },
      }),
    );
  }

  it("says what happened once, not once per render pass", async () => {
    // The bug this pins. The outcome line and `onActionComplete` used to live
    // inside a `setProposals` updater, and React calls updaters twice under
    // StrictMode precisely to surface effects hidden in one. A single tap
    // printed "Change the items on this order — done." twice and invalidated
    // the host app's cache twice.
    let completions = 0;
    const socket = await renderStrict(<AssistantPanel />, () => {
      completions += 1;
    });
    settle(socket);

    const matches = container.textContent!.split("Change the items on this order — done.");
    expect(matches.length - 1, "the outcome line should appear once").toBe(1);
    expect(completions, "the host app should be told once").toBe(1);
  });

  it("stays at one line if the runtime reports the same outcome twice", async () => {
    // A reconnect replaying a settled proposal, or a double tap. The message
    // is keyed by the proposal, so the second report changes nothing.
    const socket = await renderStrict(<AssistantPanel />);
    settle(socket);
    act(() =>
      socket.receive({
        type: "action_status",
        data: { proposalId: "prop_1", status: "executed", result: { ok: true } },
      }),
    );

    const matches = container.textContent!.split("Change the items on this order — done.");
    expect(matches.length - 1).toBe(1);
  });
});

describe("a screen whose data arrives late", () => {
  it("republishes when visibleData changes, not just when the route does", async () => {
    // The case this pins, and it is the normal one rather than an edge: a page
    // declares its screen on first render, when its queries have not resolved,
    // so the first snapshot says zero of everything. If nothing republishes
    // when the data lands, the assistant answers "zero promotions" to someone
    // looking at one.
    vi.stubGlobal(
      "WebSocket",
      class {
        constructor() {
          return new LiveSocket() as never;
        }
      },
    );
    LiveSocket.last = null;

    function Page({ count }: { count: number }) {
      useAssistantScreen({
        screenId: "promotions.list",
        route: "/dashboard/promotions",
        title: "Promotions",
        description: "",
        keywords: [],
        visibleData: { promotionsShown: count },
      });
      return null;
    }

    act(() => {
      root.render(
        <AssistantProvider
          url="ws://runtime.test/v1/ws"
          publicKey="pk_test_0123456789abcdef"
          getUserToken={() => Promise.resolve("jwt")}
        >
          <Page count={0} />
        </AssistantProvider>,
      );
    });
    await act(async () => {
      await Promise.resolve();
    });
    const socket = LiveSocket.last!;
    act(() => socket.open());

    // The query resolves and the page re-renders with real numbers.
    act(() => {
      root.render(
        <AssistantProvider
          url="ws://runtime.test/v1/ws"
          publicKey="pk_test_0123456789abcdef"
          getUserToken={() => Promise.resolve("jwt")}
        >
          <Page count={1} />
        </AssistantProvider>,
      );
    });

    await vi.waitFor(() => {
      const updates = socket.sent.filter(
        (f) => (f as { type: string }).type === "screen_update",
      ) as { data: { screen: { visibleData: Record<string, unknown> } | null } }[];
      const counts = updates.map((u) => u.data.screen?.visibleData?.promotionsShown);
      expect(
        counts.at(-1),
        `the runtime should end up knowing 1; it saw ${JSON.stringify(counts)}`,
      ).toBe(1);
    });
  });
});

describe("the launcher icon", () => {
  async function connect(ui: React.ReactNode): Promise<LiveSocket> {
    LiveSocket.last = null;
    vi.stubGlobal(
      "WebSocket",
      class {
        constructor() {
          return new LiveSocket() as never;
        }
      },
    );
    render(ui);
    await act(async () => {
      await Promise.resolve();
    });
    return LiveSocket.last!;
  }

  function handshake(socket: LiveSocket, launcherIconUrl?: string) {
    act(() => {
      socket.onopen?.({});
      socket.receive({
        type: "auth_ok",
        data: {
          sessionId: "sess_1",
          conversationId: "conv_1",
          heartbeatIntervalMs: 30000,
          registryStatus: "unknown",
          voiceAvailable: false,
          ...(launcherIconUrl === undefined ? {} : { launcherIconUrl }),
        },
      });
    });
  }

  const launcher = () => container.querySelector("button[aria-label^='Open']")!;

  it("is the Mihe mark until the app says otherwise", async () => {
    const socket = await connect(<AssistantWidget />);
    expect(launcher().querySelector("svg")).not.toBeNull();
    handshake(socket);
    expect(launcher().querySelector("img")).toBeNull();
    expect(launcher().querySelector("svg")).not.toBeNull();
  });

  it("is the icon uploaded in the dashboard, delivered with the handshake", async () => {
    // The wire end of amendment 58: a setting, so changing it is an upload
    // rather than a deploy of the host app.
    const socket = await connect(<AssistantWidget />);
    handshake(socket, "https://cdn.test/launcher-icons/app_1/ab12.png");
    const img = launcher().querySelector("img")!;
    expect(img.getAttribute("src")).toBe("https://cdn.test/launcher-icons/app_1/ab12.png");
    expect(img.getAttribute("alt")).toBe("");
  });

  it("falls back to the mark when the image cannot load, rather than an empty circle", async () => {
    const socket = await connect(<AssistantWidget />);
    handshake(socket, "https://cdn.test/blocked.png");
    act(() => {
      launcher().querySelector("img")!.dispatchEvent(new Event("error"));
    });
    expect(launcher().querySelector("img")).toBeNull();
    expect(launcher().querySelector("svg")).not.toBeNull();
  });

  it("is whatever the host app passes in code, over both", async () => {
    const socket = await connect(
      <AssistantWidget launcherIcon={<span data-testid="own">K</span>} />,
    );
    handshake(socket, "https://cdn.test/launcher-icons/app_1/ab12.png");
    expect(launcher().querySelector("[data-testid='own']")).not.toBeNull();
    expect(launcher().querySelector("img")).toBeNull();
  });
});

describe("the orb (amendment 61)", () => {
  async function connect(
    ui: React.ReactNode,
    voiceAvailable: boolean,
    widget?: Record<string, unknown>,
  ): Promise<LiveSocket> {
    LiveSocket.last = null;
    vi.stubGlobal(
      "WebSocket",
      class {
        constructor() {
          return new LiveSocket() as never;
        }
      },
    );
    render(ui);
    await act(async () => {
      await Promise.resolve();
    });
    const socket = LiveSocket.last!;
    act(() => {
      socket.onopen?.({});
      socket.receive({
        type: "auth_ok",
        data: {
          sessionId: "sess_1",
          conversationId: "conv_1",
          heartbeatIntervalMs: 30000,
          registryStatus: "unknown",
          voiceAvailable,
          ...(widget ? { widget } : {}),
        },
      });
    });
    return socket;
  }

  const orb = () =>
    container.querySelector<HTMLButtonElement>("button[aria-label^='Open'], button[aria-label$='chat or voice']")!;

  /** A tap as a finger makes one: down and up in the same place. */
  function tap(element: Element) {
    act(() => {
      element.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0, clientX: 10, clientY: 10 }));
      element.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, button: 0, clientX: 10, clientY: 10 }));
    });
  }

  const menuItems = () =>
    Array.from(container.querySelectorAll("[role='menuitem']")).map((item) => item.textContent);

  it("is the default form", async () => {
    await connect(<AssistantWidget />, false);
    expect(orb()).not.toBeNull();
    expect(orb().style.borderRadius).toBe("50%");
  });

  it("sits in its corner of the real window, and isn't drawn before the window is measured", async () => {
    // A server render has no window. Drawing the orb there put it at a guessed
    // 1024×768 spot that hydration kept, mid-page on a wider screen.
    const html = renderToString(
      <AssistantProvider url="ws://runtime.test/v1/ws" publicKey="pk_test_0123456789abcdef" getUserToken={() => Promise.resolve("jwt")}>
        <AssistantWidget />
      </AssistantProvider>,
    );
    expect(html).not.toContain("Open Assistant");

    const was = { width: window.innerWidth, height: window.innerHeight };
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 1489 });
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 821 });
    try {
      await connect(<AssistantWidget />, false);
      expect(orb().style.left).toBe(`${1489 - 20 - 56}px`);
      expect(orb().style.top).toBe(`${821 - 20 - 56}px`);
    } finally {
      Object.defineProperty(window, "innerWidth", { configurable: true, value: was.width });
      Object.defineProperty(window, "innerHeight", { configurable: true, value: was.height });
    }
  });

  it("opens chat directly when chat is the only mode", async () => {
    // Voice is off by default, so this is what most apps see: no menu with
    // one entry in it, just the conversation.
    await connect(<AssistantWidget />, false);
    expect(orb().getAttribute("aria-label")).toBe("Open Assistant");

    tap(orb());
    expect(document.getElementById(ASSISTANT_PANEL_ID)).not.toBeNull();
    expect(container.querySelector("[role='menu']")).toBeNull();
  });

  it("offers chat and each allowed voice mode when voice is on", async () => {
    await connect(<AssistantWidget />, true);
    tap(orb());
    expect(menuItems()).toEqual(["Chat", "Talk", "Hold to talk"]);
  });

  it("offers only the voice modes the app allows", async () => {
    await connect(<AssistantWidget voiceModes={["hold"]} />, true);
    tap(orb());
    expect(menuItems()).toEqual(["Chat", "Hold to talk"]);
  });

  it("goes straight to chat when no voice mode is allowed", async () => {
    await connect(<AssistantWidget voiceModes={[]} />, true);
    tap(orb());
    expect(document.getElementById(ASSISTANT_PANEL_ID)).not.toBeNull();
  });

  it("closes its menu on Escape and hands focus back to the orb", async () => {
    await connect(<AssistantWidget />, true);
    tap(orb());
    const menu = container.querySelector("[role='menu']")!;
    act(() => {
      menu.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    expect(container.querySelector("[role='menu']")).toBeNull();
    expect(document.activeElement).toBe(orb());
  });

  it("opens the panel from the menu's Chat, in the orb's place", async () => {
    await connect(<AssistantWidget />, true);
    tap(orb());
    act(() => {
      (container.querySelector("[role='menuitem']") as HTMLButtonElement).click();
    });
    expect(document.getElementById(ASSISTANT_PANEL_ID)).not.toBeNull();
    expect(orb()).toBeNull();
  });

  it("pops a proposal out of the orb as the same card, with the panel closed", async () => {
    // The standing rule survives the orb: the card still appears, from the
    // payload, waiting for the tap, even though no panel is open to hold it.
    const socket = await connect(<AssistantWidget />, true);
    act(() =>
      socket.receive({
        type: "action_proposal",
        data: {
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
        },
      }),
    );
    expect(document.getElementById(ASSISTANT_PANEL_ID)).toBeNull();
    const card = container.querySelector("[aria-label='Confirm: Refund order']");
    expect(card).not.toBeNull();
    expect(card!.textContent).toContain("Refund to the original payment method.");
  });

  it("snaps a dragged orb to the nearer side and remembers it", async () => {
    window.localStorage.clear();
    await connect(<AssistantWidget draggable />, false);
    const from = { clientX: window.innerWidth - 40, clientY: window.innerHeight - 40 };
    act(() => {
      orb().dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0, ...from }));
      orb().dispatchEvent(new PointerEvent("pointermove", { bubbles: true, clientX: 60, clientY: 200 }));
    });
    act(() => {
      orb().dispatchEvent(new PointerEvent("pointerup", { bubbles: true, clientX: 60, clientY: 200 }));
    });

    // A drag is not a tap: nothing opened.
    expect(document.getElementById(ASSISTANT_PANEL_ID)).toBeNull();
    expect(orb().style.left).toBe("20px");
    expect(JSON.parse(window.localStorage.getItem("mihe:orb-position")!).side).toBe("left");
  });

  it("does not move when it is not draggable, and a drag is still not a tap", async () => {
    window.localStorage.clear();
    await connect(<AssistantWidget />, false);
    const before = orb().style.left;
    act(() => {
      orb().dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0, clientX: 900, clientY: 700 }));
      orb().dispatchEvent(new PointerEvent("pointermove", { bubbles: true, clientX: 60, clientY: 200 }));
    });
    expect(orb().style.left).toBe(before);
    expect(window.localStorage.getItem("mihe:orb-position")).toBeNull();
  });

  it("leaves voice to the orb: the chat panel it opens has no microphone", async () => {
    // Voice is on, so the classic panel would show its microphone and
    // hands-free buttons. Opened from the orb, voice is the orb's.
    await connect(<AssistantWidget />, true);
    tap(orb());
    act(() => {
      (container.querySelector("[role='menuitem']") as HTMLButtonElement).click();
    });
    expect(document.getElementById(ASSISTANT_PANEL_ID)).not.toBeNull();
    expect(container.querySelector("button[aria-label='Start voice']")).toBeNull();
    expect(container.querySelector("button[aria-label='Start hands-free voice']")).toBeNull();
  });

  it("offers a call from the classic panel's header, and never a microphone in its chat box (amendment 105)", async () => {
    await connect(<AssistantWidget form="classic" defaultOpen />, true);
    expect(TALK()).toBeDefined();
    expect(container.querySelector("form button[aria-label='Start voice'], form button[aria-label='Start hands-free voice']")).toBeNull();
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
      await connect(<AssistantWidget />, true, settings({ form: "classic" }));
      const launcher = container.querySelector<HTMLButtonElement>("button[aria-label='Open Assistant']")!;
      act(() => launcher.click());
      // The classic panel, with its own way into a call, is what opened.
      expect(TALK()).toBeDefined();
    });

    it("are overridden by a prop in the host app's code", async () => {
      await connect(<AssistantWidget form="orb" />, true, settings({ form: "classic" }));
      expect(orb().getAttribute("aria-label")).toBe("Assistant: choose chat or voice");
    });

    it("decide which voice modes the menu offers", async () => {
      await connect(<AssistantWidget />, true, settings({ voiceModes: ["hold"] }));
      tap(orb());
      expect(menuItems()).toEqual(["Chat", "Hold to talk"]);
    });

    it("can be narrowed by a prop, never widened", async () => {
      // The runtime refuses hands-free for this app, so offering it would be
      // a button that fails.
      await connect(
        <AssistantWidget voiceModes={["hands-free", "hold"]} />,
        true,
        settings({ voiceModes: ["hold"] }),
      );
      tap(orb());
      expect(menuItems()).toEqual(["Chat", "Hold to talk"]);
    });

    it("offer a call from the classic panel when the app allows any voice mode", async () => {
      await connect(<AssistantWidget form="classic" defaultOpen />, true, settings({ voiceModes: ["hold"] }));
      expect(TALK()).toBeDefined();
    });

    it("offer no call from the classic panel when the app allows no voice mode", async () => {
      await connect(<AssistantWidget form="classic" defaultOpen />, true, settings({ voiceModes: [] }));
      expect(TALK()).toBeUndefined();
    });
  });

  it("keeps the classic launcher for apps that ask for it", async () => {
    await connect(<AssistantWidget form="classic" />, true);
    const launcher = container.querySelector<HTMLButtonElement>("button[aria-label='Open Assistant']")!;
    act(() => launcher.click());
    expect(document.getElementById(ASSISTANT_PANEL_ID)).not.toBeNull();
  });
});

describe("useAssistantTabs", () => {
  function Reports() {
    const [tab, setTab] = useState("sales");
    useAssistantScreen({ screenId: "reports", route: "/reports", title: "Reports" });
    useAssistantTabs({
      id: "reports.tabs",
      label: "Report",
      tabs: [
        { value: "sales", label: "Sales" },
        { value: "stock", label: "Stock" },
      ],
      value: tab,
      onChange: setTab,
    });
    return <p data-testid="tab">{tab}</p>;
  }

  it("switches the app's own tab state and acks once the new tab is published", async () => {
    LiveSocket.last = null;
    vi.stubGlobal(
      "WebSocket",
      class {
        constructor() {
          return new LiveSocket() as never;
        }
      },
    );
    render(<Reports />);
    await act(async () => {
      await Promise.resolve();
    });
    const socket = LiveSocket.last!;
    act(() => socket.open());

    await act(async () => {
      socket.receive({
        type: "command",
        data: {
          commandId: "cmd_1",
          turnId: "turn_1",
          command: { type: "set_view", data: { controlKey: "reports.tabs", value: "stock" } },
        },
      });
    });

    await vi.waitFor(() => {
      const ack = socket.sent.find(
        (f) => (f as { type: string }).type === "command_result",
      ) as { data: { ok: boolean; result: unknown } } | undefined;
      expect(ack?.data).toMatchObject({ ok: true, result: { showing: "stock" } });
    });
    expect(container.textContent).toContain("stock");

    type Update = { data: { screen: { controls: { value?: string }[] } | null } };
    const updates = socket.sent.filter(
      (f) => (f as { type: string }).type === "screen_update",
    ) as Update[];
    // Never a screen without its tabs between two values: a voice session
    // would rebuild its tools for the gap.
    expect(updates.every((u) => u.data.screen?.controls.length === 1)).toBe(true);
    expect(updates.at(-1)?.data.screen?.controls[0]?.value).toBe("stock");
    // The ack follows the screen that shows the switch, so the runtime's next
    // step reads the new tab.
    const ackIndex = socket.sent.findIndex(
      (f) => (f as { type: string }).type === "command_result",
    );
    expect(socket.sent.lastIndexOf(updates.at(-1)!)).toBeLessThan(ackIndex);
  });
});

describe("navigating to a screen that is still loading", () => {
  function Inventory({ loading }: { loading: boolean }) {
    useAssistantScreen({
      screenId: "inventory",
      route: "/inventory",
      title: "Inventory",
      visibleData: { ingredients: loading ? 0 : 16 },
      loading,
    });
    return null;
  }

  it("is not acked until the data has arrived, so the next step reads real numbers", async () => {
    // The bug: Kit navigated to Inventory, the page reported in before its
    // queries resolved, the ack went back on that, and the model told the
    // user there were no raw materials on a page about to show sixteen.
    LiveSocket.last = null;
    vi.stubGlobal(
      "WebSocket",
      class {
        constructor() {
          return new LiveSocket() as never;
        }
      },
    );
    const ui = (loading: boolean) => (
      <AssistantProvider
        url="ws://runtime.test/v1/ws"
        publicKey="pk_test_0123456789abcdef"
        getUserToken={() => Promise.resolve("jwt")}
        navigate={() => {}}
      >
        <Inventory loading={loading} />
      </AssistantProvider>
    );
    act(() => root.render(ui(true)));
    await act(async () => {
      await Promise.resolve();
    });
    const socket = LiveSocket.last!;
    act(() => socket.open());

    await act(async () => {
      socket.receive({
        type: "command",
        data: {
          commandId: "cmd_1",
          turnId: "turn_1",
          command: { type: "navigate", data: { route: "/inventory" } },
        },
      });
      await new Promise((resolve) => setTimeout(resolve, 300));
    });
    const acked = () =>
      socket.sent.find((f) => (f as { type: string }).type === "command_result") as
        | { data: { ok: boolean; result: { note?: string } } }
        | undefined;
    expect(acked(), "acked while the page was still loading").toBeUndefined();

    act(() => root.render(ui(false)));
    await vi.waitFor(() => expect(acked()).toBeDefined());
    expect(acked()!.data.result.note).toBeUndefined();

    type Update = { data: { screen: { visibleData: Record<string, unknown> } | null } };
    const updates = socket.sent.filter(
      (f) => (f as { type: string }).type === "screen_update",
    ) as Update[];
    expect(updates.map((u) => u.data.screen?.visibleData.ingredients)).not.toContain(0);
  });

  function Analytics({ interval }: { interval: string }) {
    useAssistantScreen({
      screenId: "analytics",
      route: "/analytics",
      title: "Analytics",
      visibleData: { interval },
    });
    return null;
  }

  // Two bugs in one place. Pages publish their path, so a route carrying
  // filters never matched and every filtered navigate sat out the timeout and
  // came back with a "has not reported in" note. And on the page already
  // showing, the path matched at once — so the ack went back on the old view
  // and the model read the chart it had just been asked to replace.
  it("acks a filtered navigate on the page's next publish, not the view it replaces", async () => {
    LiveSocket.last = null;
    vi.stubGlobal(
      "WebSocket",
      class {
        constructor() {
          return new LiveSocket() as never;
        }
      },
    );
    window.history.replaceState(null, "", "/analytics");
    const ui = (interval: string) => (
      <AssistantProvider
        url="ws://runtime.test/v1/ws"
        publicKey="pk_test_0123456789abcdef"
        getUserToken={() => Promise.resolve("jwt")}
        navigate={() => {}}
      >
        <Analytics interval={interval} />
      </AssistantProvider>
    );
    act(() => root.render(ui("month")));
    await act(async () => {
      await Promise.resolve();
    });
    const socket = LiveSocket.last!;
    act(() => socket.open());
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 300));
    });

    await act(async () => {
      socket.receive({
        type: "command",
        data: {
          commandId: "cmd_1",
          turnId: "turn_1",
          command: { type: "navigate", data: { route: "/analytics?interval=week" } },
        },
      });
      await new Promise((resolve) => setTimeout(resolve, 300));
    });
    const acked = () =>
      socket.sent.find((f) => (f as { type: string }).type === "command_result") as
        | { data: { ok: boolean; result: { note?: string } } }
        | undefined;
    expect(acked(), "acked on the view being replaced").toBeUndefined();

    act(() => root.render(ui("week")));
    await vi.waitFor(() => expect(acked()).toBeDefined());
    expect(acked()!.data.result.note, "matched on path, so no timeout").toBeUndefined();
  });
});

describe("useAssistantTable", () => {
  type Order = { id: string; orderNumber: string; total: number; notes: string; secret: string };
  const orders: Order[] = [
    { id: "o1", orderNumber: "TLF-0002", total: 1500, notes: "x".repeat(500), secret: "card 4242" },
    { id: "o2", orderNumber: "TLF-0001", total: 900, notes: "", secret: "card 4242" },
  ];

  function Orders() {
    useAssistantScreen({ screenId: "orders", route: "/orders", title: "Orders" });
    useAssistantTable({
      id: "orders.table",
      label: "Orders",
      columns: [
        { key: "orderNumber", label: "Order" },
        { key: "total", label: "Total" },
        { key: "notes", label: "Notes" },
      ],
      rows: orders,
      rowId: (o) => o.orderNumber,
      rowIdName: "orderNumber",
      opens: { screenId: "orders.detail", params: (o) => ({ id: o.id }) },
      total: 47,
    });
    return null;
  }

  it("describes the table without its rows, and reads only declared columns", async () => {
    LiveSocket.last = null;
    vi.stubGlobal(
      "WebSocket",
      class {
        constructor() {
          return new LiveSocket() as never;
        }
      },
    );
    render(<Orders />);
    await act(async () => {
      await Promise.resolve();
    });
    const socket = LiveSocket.last!;
    act(() => socket.open());

    type Update = { data: { screen: { tables: unknown[] } | null } };
    await vi.waitFor(() => {
      const updates = socket.sent.filter(
        (f) => (f as { type: string }).type === "screen_update",
      ) as Update[];
      expect(updates.at(-1)?.data.screen?.tables).toEqual([
        {
          tableKey: "orders.table",
          label: "Orders",
          columns: [
            { key: "orderNumber", label: "Order" },
            { key: "total", label: "Total" },
            { key: "notes", label: "Notes" },
          ],
          loadedRows: 2,
          rowId: "orderNumber",
          opens: "orders.detail",
          totalRows: 47,
        },
      ]);
    });
    // The screen update carries no rows: they are read on demand.
    expect(JSON.stringify(socket.sent)).not.toContain("TLF-0002");

    await act(async () => {
      socket.receive({
        type: "command",
        data: {
          commandId: "cmd_1",
          turnId: "turn_1",
          command: { type: "read_table", data: { tableKey: "orders.table", offset: 0, limit: 1 } },
        },
      });
    });
    await vi.waitFor(() => {
      const ack = socket.sent.find(
        (f) => (f as { type: string }).type === "command_result",
      ) as { data: { ok: boolean; result: { rows: Record<string, unknown>[]; total: number } } };
      expect(ack.data.ok).toBe(true);
      const row = ack.data.result.rows[0]!;
      expect(ack.data.result.rows).toHaveLength(1);
      // Acted on by number, opened by database id: the row carries both.
      expect(row).toMatchObject({
        id: "TLF-0002",
        open: { id: "o1" },
        Order: "TLF-0002",
        Total: 1500,
      });
      expect(String(row.Notes).length).toBeLessThan(210);
      expect(JSON.stringify(row)).not.toContain("4242");
      expect(ack.data.result.total).toBe(47);
    });
  });
});

describe("useAssistantChart", () => {
  const data = [
    { bucket: "2026-02-01", inflow: 0, outflow: null },
    { bucket: "2026-03-01", inflow: 216000, outflow: 4000 },
    { bucket: "2026-04-01", inflow: 60000, outflow: 50000 },
  ];

  function Stock() {
    useAssistantScreen({ screenId: "analytics", route: "/analytics", title: "Analytics" });
    useAssistantChart({
      id: "stock.trend",
      title: "Stock trend",
      data,
      x: { key: "bucket", label: "Month", format: (v) => String(v).slice(0, 7) },
      series: [
        { key: "inflow", name: "Stock in", unit: "NGN" },
        { key: "outflow", name: "Stock out", unit: "NGN" },
      ],
    });
    return null;
  }

  it("publishes a summary, not the points, and reads points on request", async () => {
    LiveSocket.last = null;
    vi.stubGlobal(
      "WebSocket",
      class {
        constructor() {
          return new LiveSocket() as never;
        }
      },
    );
    render(<Stock />);
    await act(async () => {
      await Promise.resolve();
    });
    const socket = LiveSocket.last!;
    act(() => socket.open());

    type Update = {
      data: { screen: { charts: { series: { name: string; summary?: { max: unknown; points: number } }[] }[] } | null };
    };
    await vi.waitFor(() => {
      const updates = socket.sent.filter(
        (f) => (f as { type: string }).type === "screen_update",
      ) as Update[];
      const [stockIn, stockOut] = updates.at(-1)!.data.screen!.charts[0]!.series;
      expect(stockIn!.summary!.max).toEqual({ x: "2026-03", y: 216000 });
      // A missing value is skipped, not counted as zero.
      expect(stockOut!.summary!.points).toBe(2);
    });

    await act(async () => {
      socket.receive({
        type: "command",
        data: {
          commandId: "cmd_1",
          turnId: "turn_1",
          command: { type: "read_chart", data: { chartKey: "stock.trend", series: "Stock in", limit: 60 } },
        },
      });
    });
    await vi.waitFor(() => {
      const ack = socket.sent.find(
        (f) => (f as { type: string }).type === "command_result",
      ) as { data: { ok: boolean; result: unknown } };
      expect(ack.data).toMatchObject({
        commandId: "cmd_1",
        ok: true,
        result: {
          series: [
            {
              name: "Stock in",
              points: [
                { x: "2026-02", y: 0 },
                { x: "2026-03", y: 216000 },
                { x: "2026-04", y: 60000 },
              ],
            },
          ],
        },
      });
    });
  });
});


describe("useAssistantTable with a query", () => {
  type Order = { id: string; orderNumber: string; secret: string };
  const found: Order[] = [{ id: "o9", orderNumber: "TLF-0399", secret: "card 4242" }];

  function Orders({ run }: { run: (p: Record<string, string>) => Promise<{ rows: Order[] }> }) {
    useAssistantScreen({ screenId: "orders", route: "/orders", title: "Orders" });
    useAssistantTable({
      id: "orders.table",
      label: "Orders",
      columns: [{ key: "orderNumber", label: "Order" }],
      rows: [],
      rowId: (o) => o.orderNumber,
      opens: { screenId: "orders.detail", params: (o) => ({ id: o.id }) },
      query: {
        params: {
          search: { kind: "text", description: "order number or customer" },
          status: { kind: "enum", values: ["pending", "paid"] },
        },
        run,
      },
    });
    return null;
  }

  // A search result must leave the browser exactly as a read does: declared
  // columns only. The app's `run` returns whole records, and a field nobody
  // declared — here a card number — must not ride along because it was found
  // rather than loaded.
  it("declares the search without code and renders results to declared columns only", async () => {
    LiveSocket.last = null;
    vi.stubGlobal(
      "WebSocket",
      class {
        constructor() {
          return new LiveSocket() as never;
        }
      },
    );
    const run = vi.fn(async () => ({ rows: found }));
    render(<Orders run={run} />);
    await act(async () => {
      await Promise.resolve();
    });
    const socket = LiveSocket.last!;
    act(() => socket.open());

    type Update = { data: { screen: { tables: { query?: unknown }[] } | null } };
    await vi.waitFor(() => {
      const updates = socket.sent.filter(
        (f) => (f as { type: string }).type === "screen_update",
      ) as Update[];
      expect(updates.at(-1)?.data.screen?.tables[0]?.query).toEqual({
        params: [
          { key: "search", kind: "text", values: [], description: "order number or customer" },
          { key: "status", kind: "enum", values: ["pending", "paid"], description: "" },
        ],
        canShow: false,
      });
    });

    await act(async () => {
      socket.receive({
        type: "command",
        data: {
          commandId: "cmd_1",
          turnId: "turn_1",
          command: {
            type: "query_table",
            data: { tableKey: "orders.table", params: { search: "Mama Tee" }, limit: 20, show: false },
          },
        },
      });
    });
    await vi.waitFor(() => {
      const ack = socket.sent.find(
        (f) => (f as { type: string }).type === "command_result",
      ) as { data: { ok: boolean; result: { rows: Record<string, unknown>[] } } };
      expect(ack.data.ok).toBe(true);
      expect(ack.data.result.rows).toEqual([{ id: "TLF-0399", open: { id: "o9" }, Order: "TLF-0399" }]);
    });
    expect(run).toHaveBeenCalledWith({ search: "Mama Tee" });
    expect(JSON.stringify(socket.sent)).not.toContain("card 4242");
  });
});

describe("a card the app describes (amendment 99)", () => {
  it("waits for the app's words with Confirm disabled, then shows them", async () => {
    LiveSocket.last = null;
    vi.stubGlobal("WebSocket", class { constructor() { return new LiveSocket() as never; } });
    let finish: (d: unknown) => void = () => {};
    act(() => {
      root.render(
        <AssistantProvider url="ws://runtime.test/v1/ws" publicKey="pk_test_0123456789abcdef" getUserToken={() => Promise.resolve("jwt")}
          describeProposal={() => new Promise((resolve) => { finish = resolve as never; })}>
          <AssistantPanel />
        </AssistantProvider>,
      );
    });
    await act(async () => { await Promise.resolve(); });
    const socket = LiveSocket.last!;
    act(() => socket.open());
    act(() => socket.receive({ type: "action_proposal", data: {
      turnId: "t1", proposalId: "prop_7", actionName: "update_product", label: "Change a product", description: "Changes a product.", risk: "medium",
      input: { productId: "p1", productName: "Linen Shirt", price: 13 }, inputSchema: { type: "object" }, expiresAt: new Date(Date.now() + 60_000).toISOString(), uiConfirmationRequired: false,
    } }));
    const confirm = () => [...container.querySelectorAll("button")].find((b) => /Confirm|Change price/.test(b.textContent ?? "") && b.closest("[role=group]")) as HTMLButtonElement;
    expect(container.textContent).toContain("Checking the details");
    expect(confirm().disabled).toBe(true);

    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    await act(async () => { finish({ summary: "Change Linen Shirt's price", confirmLabel: "Change price", lines: [{ label: "Price", before: "$12.00", text: "$13.00", images: [{ src: "https://cdn.example/shirt.webp" }] }] }); await Promise.resolve(); await Promise.resolve(); });
    expect(container.textContent).toContain("Change Linen Shirt's price");
    expect(container.querySelector("s")?.textContent).toBe("$12.00");
    expect(container.querySelector("img[src='https://cdn.example/shirt.webp']")).not.toBeNull();
    expect(container.textContent).not.toContain("p1");
    expect(confirm().disabled).toBe(false);
    expect(confirm().textContent).toBe("Change price");
  });
});

