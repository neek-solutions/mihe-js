/**
 * The JavaScript API (doc 08).
 *
 * The React provider runs on this class, so its behaviour is also pinned by
 * `react/tests/headless.test.tsx`. These tests pin what only the plain API
 * has: calls that return an undo, a declaration updated by calling again, and
 * a trigger bound to an element rather than spread as props.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { COMPONENT_ATTRIBUTE, Mihe, createMihe } from "../src/index";
import type { MiheOptions } from "../src/index";

/** A socket that completes the handshake when told to. */
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

  open() {
    this.onopen?.({});
    this.receive({
      type: "auth_ok",
      data: {
        sessionId: "sess_1",
        conversationId: "conv_1",
        heartbeatIntervalMs: 30000,
        registryStatus: "unknown",
        voiceAvailable: false,
      },
    });
  }

  receive(frame: unknown) {
    this.onmessage?.({ data: JSON.stringify(frame) });
  }

  frames(type: string) {
    return this.sent.filter((frame) => frame.type === type);
  }
}

const options: MiheOptions = {
  url: "ws://runtime.test/v1/ws",
  publicKey: "pk_test_0123456789abcdef",
  getUserToken: () => Promise.resolve("jwt"),
};

/** A connected assistant and its socket, past the handshake. */
async function connected(extra: Partial<MiheOptions> = {}) {
  const mihe = createMihe({ ...options, ...extra });
  // The token is fetched before the socket opens.
  await vi.waitFor(() => expect(LiveSocket.last).not.toBeNull());
  const socket = LiveSocket.last!;
  socket.open();
  return { mihe, socket };
}

const screen = { screenId: "orders.list", route: "/orders", title: "Orders" };

let mihe: Mihe | null = null;

beforeEach(() => {
  LiveSocket.last = null;
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
  mihe?.destroy();
  mihe = null;
  vi.useRealTimers();
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

describe("state", () => {
  it("is the same object until something changes, so React can read it directly", async () => {
    // `useSyncExternalStore` re-renders forever if `getSnapshot` returns a
    // new object on every call.
    ({ mihe } = await connected());
    const before = mihe.getState();
    expect(mihe.getState()).toBe(before);

    let changes = 0;
    mihe.subscribe(() => changes++);
    mihe.open();
    expect(mihe.getState()).not.toBe(before);
    expect(mihe.getState().isOpen).toBe(true);
    expect(changes).toBe(1);

    // Opening what is open is not a change.
    mihe.open();
    expect(changes).toBe(1);
  });

  it("sends a message, shows it, and opens the panel for the reply", async () => {
    let socket: LiveSocket;
    ({ mihe, socket } = await connected());
    mihe.send("  How many orders are pending?  ");

    expect(mihe.getState().isOpen).toBe(true);
    expect(mihe.getState().messages.map((m) => m.text)).toEqual([
      "How many orders are pending?",
    ]);
    expect(socket.frames("message")[0]?.data.text).toBe("How many orders are pending?");
  });

  it("stops calling listeners after destroy", async () => {
    ({ mihe } = await connected());
    const listener = vi.fn();
    mihe.subscribe(listener);
    mihe.destroy();
    // Closing is itself a change of state, which listeners hear.
    expect(mihe.getState().connection).toBe("closed");
    listener.mockClear();
    mihe.toggle();
    expect(listener).not.toHaveBeenCalled();
  });
});

describe("a confirmed action", () => {
  const proposal = {
    proposalId: "prop_1",
    actionName: "cancel_order",
    label: "Cancel this order",
    description: "Cancel an order.",
    risk: "medium",
    input: {},
    inputSchema: { type: "object" },
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    uiConfirmationRequired: false,
  };

  it("retires the card, says what happened once, and tells the app once", async () => {
    // A status can arrive twice — a reconnect replaying it, a double tap —
    // and the app's refetch should not run twice for one tap.
    const completed = vi.fn();
    let socket: LiveSocket;
    ({ mihe, socket } = await connected({ onActionComplete: completed }));

    socket.receive({ type: "action_proposal", data: { turnId: "t1", ...proposal } });
    expect(mihe.getState().proposals).toHaveLength(1);

    const status = {
      type: "action_status",
      data: { proposalId: "prop_1", status: "executed", result: { ok: true } },
    };
    socket.receive(status);
    socket.receive(status);

    expect(mihe.getState().proposals).toHaveLength(0);
    expect(mihe.getState().messages.map((m) => m.text)).toEqual(["Cancel this order — done."]);
    expect(completed).toHaveBeenCalledTimes(1);
    expect(completed).toHaveBeenCalledWith({
      actionName: "cancel_order",
      status: "executed",
      result: { ok: true },
    });
  });
});

describe("voice", () => {
  it("ignores a permit nobody asked for, so the microphone never opens unprompted", async () => {
    let socket: LiveSocket;
    ({ mihe, socket } = await connected());
    socket.receive({
      type: "voice_token",
      data: { token: "vt_1", expiresAt: new Date(Date.now() + 60_000).toISOString() },
    });
    expect(mihe.getState().voice.state).toBe("idle");
    expect(mihe.getState().isOpen).toBe(false);
  });
});

describe("setScreen", () => {
  it("publishes the screen, and the undo tells the runtime the user left", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    let socket: LiveSocket;
    ({ mihe, socket } = await connected());

    const leave = mihe.setScreen(screen);
    vi.advanceTimersByTime(100);
    const published = socket.frames("screen_update").at(-1)?.data.screen as { route: string };
    expect(published.route).toBe("/orders");

    leave();
    vi.advanceTimersByTime(100);
    expect(socket.frames("screen_update").at(-1)?.data.screen).toBeNull();
  });

  it("does not resend a screen declared again unchanged", async () => {
    // A render function that declares its screen on every render would
    // otherwise send it over the socket every time.
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    let socket: LiveSocket;
    ({ mihe, socket } = await connected());

    mihe.setScreen(screen);
    vi.advanceTimersByTime(100);
    const sent = socket.frames("screen_update").length;

    mihe.setScreen({ ...screen });
    vi.advanceTimersByTime(100);
    expect(socket.frames("screen_update")).toHaveLength(sent);
  });
});

describe("registerTable", () => {
  const columns = [{ key: "number", label: "Order" }];
  const table = (rows: { id: string; number: string }[]) => ({
    id: "orders.table",
    label: "Orders",
    columns,
    rows,
    rowId: (row: { id: string }) => row.id,
  });

  it("reads the rows given last, without re-registering for each change of rows", async () => {
    ({ mihe } = await connected());
    mihe.setScreen(screen);
    mihe.registerTable(table([{ id: "1", number: "ORD-1" }]));
    const declared = mihe.store.getTable("orders.table");

    // Same count, so same signature: only the rows behind `read` move.
    mihe.registerTable(table([{ id: "2", number: "ORD-2" }]));
    expect(mihe.store.getTable("orders.table")).toBe(declared);
    expect(declared?.read(0, 10)).toEqual([{ id: "2", Order: "ORD-2" }]);
  });

  it("is removed by the first call's undo, even after updates", async () => {
    ({ mihe } = await connected());
    mihe.setScreen(screen);
    const remove = mihe.registerTable(table([{ id: "1", number: "ORD-1" }]));
    mihe.registerTable(table([]));
    remove();
    expect(mihe.store.getTable("orders.table")).toBeUndefined();
  });

  it("ignores a stale undo, so leaving one page cannot remove the next page's table", async () => {
    ({ mihe } = await connected());
    mihe.setScreen(screen);
    const stale = mihe.registerTable(table([]));
    stale();
    mihe.registerTable(table([{ id: "1", number: "ORD-1" }]));

    stale();
    expect(mihe.store.getTable("orders.table")).toBeDefined();
  });

  it("is registered again after a change of screen cleared it", async () => {
    // The store drops a screen's tables when the screen changes. A call with
    // an unchanged declaration must still put it back.
    ({ mihe } = await connected());
    mihe.setScreen(screen);
    mihe.registerTable(table([]));
    mihe.setScreen({ screenId: "orders.archive", route: "/orders/archive", title: "Archive" });
    expect(mihe.store.getTable("orders.table")).toBeUndefined();

    mihe.registerTable(table([]));
    expect(mihe.store.getTable("orders.table")).toBeDefined();
  });
});

describe("registerTabs", () => {
  it("reports the tab showing now, and calls the latest onChange", async () => {
    ({ mihe } = await connected());
    mihe.setScreen(screen);
    const tabs = [
      { value: "open", label: "Open" },
      { value: "closed", label: "Closed" },
    ];
    const first = vi.fn();
    const latest = vi.fn();
    mihe.registerTabs({ id: "orders.tabs", label: "Status", tabs, value: "open", onChange: first });
    mihe.registerTabs({ id: "orders.tabs", label: "Status", tabs, value: "closed", onChange: latest });

    const control = mihe.store.getControl("orders.tabs");
    expect(control?.value).toBe("closed");
    await control?.onChange("open");
    expect(first).not.toHaveBeenCalled();
    expect(latest).toHaveBeenCalledWith("open");
  });
});

describe("registerAction", () => {
  it("runs the latest handler, and a second call is an update, not a duplicate", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    ({ mihe } = await connected());
    mihe.registerAction("print_receipt", () => "first");
    const remove = mihe.registerAction("print_receipt", () => "second");

    expect(await mihe.store.getAction("print_receipt")?.handler({})).toBe("second");
    expect(warn).not.toHaveBeenCalled();

    remove();
    expect(mihe.store.getAction("print_receipt")).toBeUndefined();
    warn.mockRestore();
  });
});

describe("registerComponent", () => {
  it("marks the element so it can be pointed at, and the undo unmarks it", async () => {
    ({ mihe } = await connected());
    mihe.setScreen(screen);
    const button = document.createElement("button");
    const remove = mihe.registerComponent(button, "orders.new", {
      type: "button",
      label: "New order",
    });

    expect(button.getAttribute(COMPONENT_ATTRIBUTE)).toBe("orders.new");
    expect(mihe.store.hasComponent("orders.new")).toBe(true);

    remove();
    expect(button.hasAttribute(COMPONENT_ATTRIBUTE)).toBe(false);
    expect(mihe.store.hasComponent("orders.new")).toBe(false);
  });
});

describe("bindTrigger", () => {
  it("makes a plain div a button for keyboards and screen readers", async () => {
    // The usual way a custom trigger ships broken: a div with a click handler
    // and nothing else, which a keyboard cannot reach.
    ({ mihe } = await connected());
    const div = document.createElement("div");
    document.body.append(div);
    const unbind = mihe.bindTrigger(div);

    expect(div.getAttribute("role")).toBe("button");
    expect(div.getAttribute("tabindex")).toBe("0");
    expect(div.getAttribute("aria-expanded")).toBe("false");

    div.click();
    expect(mihe.getState().isOpen).toBe(true);
    expect(div.getAttribute("aria-expanded")).toBe("true");

    div.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
    expect(mihe.getState().isOpen).toBe(false);

    unbind();
    expect(div.hasAttribute("role")).toBe(false);
    div.click();
    expect(mihe.getState().isOpen).toBe(false);
  });

  it("leaves a real button's own semantics alone", async () => {
    ({ mihe } = await connected());
    const button = document.createElement("button");
    mihe.bindTrigger(button);
    expect(button.hasAttribute("role")).toBe(false);
    expect(button.hasAttribute("tabindex")).toBe(false);
  });
});

describe("prompt", () => {
  it("returns a one-tap ask", async () => {
    ({ mihe } = await connected());
    const ask = mihe.prompt("How do I add a product?");
    ask();
    expect(mihe.getState().messages.at(-1)?.text).toBe("How do I add a product?");
  });
});

describe("what a card says (amendment 99)", () => {
  const proposal = {
    proposalId: "prop_9", actionName: "update_product", label: "Change a product", description: "Changes a product.", risk: "medium",
    input: { productId: "p1", productName: "Linen Shirt", price: 13 },
    inputSchema: { type: "object", "x-mihe-summary": "Change {productName}", properties: { productId: { type: "string", "x-mihe-hidden": true }, productName: { type: "string", title: "Product" }, price: { type: "number", title: "Price" } } },
    expiresAt: new Date(Date.now() + 60_000).toISOString(), uiConfirmationRequired: false,
  };

  it("uses the registry's hints when the app doesn't describe cards", async () => {
    let socket: LiveSocket;
    ({ mihe, socket } = await connected({}));
    socket.receive({ type: "action_proposal", data: { turnId: "t1", ...proposal } });
    expect(mihe!.getState().cardViews.prop_9).toMatchObject({ source: "hints", summary: "Change Linen Shirt" });
  });

  it("is pending while the app describes it, then shows the app's words", async () => {
    let finish: (d: unknown) => void = () => {};
    const describeProposal = vi.fn(() => new Promise((resolve) => { finish = resolve; }));
    let socket: LiveSocket;
    ({ mihe, socket } = await connected({ describeProposal: describeProposal as never }));
    socket.receive({ type: "action_proposal", data: { turnId: "t1", ...proposal } });
    expect(mihe!.getState().cardViews.prop_9).toBe("pending");
    await vi.waitFor(() => expect(describeProposal).toHaveBeenCalledWith(expect.objectContaining({ proposalId: "prop_9", input: proposal.input })));
    finish({ summary: "Change Linen Shirt's price", lines: [{ label: "Price", before: "$12.00", text: "$13.00" }] });
    await vi.waitFor(() => expect(mihe!.getState().cardViews.prop_9).toMatchObject({ source: "app", lines: [{ before: "$12.00", text: "$13.00" }] }));
  });

  it("falls back to the hints when the app fails, or doesn't answer in time", async () => {
    vi.useFakeTimers();
    try {
      let socket: LiveSocket;
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      ({ mihe, socket } = await connected({ describeProposal: () => { throw new Error("boom"); } }));
      socket.receive({ type: "action_proposal", data: { turnId: "t1", ...proposal } });
      await vi.advanceTimersByTimeAsync(0);
      expect(mihe!.getState().cardViews.prop_9).toMatchObject({ source: "hints" });
      warn.mockRestore();

      ({ mihe, socket } = await connected({ describeProposal: () => new Promise(() => {}) }));
      socket.receive({ type: "action_proposal", data: { turnId: "t1", ...proposal, proposalId: "prop_10" } });
      expect(mihe!.getState().cardViews.prop_10).toBe("pending");
      await vi.advanceTimersByTimeAsync(4000);
      expect(mihe!.getState().cardViews.prop_10).toMatchObject({ source: "hints" });
    } finally { vi.useRealTimers(); }
  });
});

