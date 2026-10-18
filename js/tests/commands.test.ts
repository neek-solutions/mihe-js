import { beforeEach, describe, expect, it, vi } from "vitest";

import { RUNTIME_ACK_WAIT_MS, executeCommand, type CommandContext } from "../src/commands";
import { COMPONENT_ATTRIBUTE, HighlightEngine } from "../src/highlight";
import { AssistantStore } from "../src/store";

function context(overrides: Partial<CommandContext> = {}): CommandContext {
  return {
    store: new AssistantStore(),
    highlighter: new HighlightEngine(),
    navigate: vi.fn(),
    ...overrides,
  };
}

/** Put a registered element on the page, the way the hook's props would. */
function mount(componentKey: string, tag = "button"): HTMLElement {
  const element = document.createElement(tag);
  element.setAttribute(COMPONENT_ATTRIBUTE, componentKey);
  document.body.appendChild(element);
  return element;
}

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("navigate", () => {
  it("hands the route to the app's router", async () => {
    const navigate = vi.fn();
    const result = await executeCommand(
      { type: "navigate", data: { route: "/orders" } },
      context({ navigate }),
    );

    expect(navigate).toHaveBeenCalledWith("/orders");
    expect(result).toEqual({ ok: true, result: { route: "/orders" } });
  });

  it("asks for a fresh publish when the route changes the page's query", async () => {
    window.history.replaceState(null, "", "/analytics");
    const screenPublished = vi.fn(() => Promise.resolve(true));
    await executeCommand(
      { type: "navigate", data: { route: "/analytics?interval=week" } },
      context({ screenPublished }),
    );
    expect(screenPublished).toHaveBeenCalledWith("/analytics?interval=week", { fresh: true });
  });

  it("does not wait for a publish that will never come when the URL is already that", async () => {
    window.history.replaceState(null, "", "/analytics?interval=week");
    const screenPublished = vi.fn(() => Promise.resolve(true));
    await executeCommand(
      { type: "navigate", data: { route: "/analytics?interval=week" } },
      context({ screenPublished }),
    );
    expect(screenPublished).toHaveBeenCalledWith("/analytics?interval=week", { fresh: false });
  });

  it("does not ack until the destination has published its context", async () => {
    // The runtime re-reads the screen after this ack to decide what the next
    // tool call may do. Acking early hands it the screen we just left, and the
    // action the user navigated for gets filtered out as off-screen.
    let arrive = (_: boolean) => {};
    const screenPublished = vi.fn(
      () => new Promise<boolean>((resolve) => (arrive = resolve)),
    );

    let acked = false;
    const running = executeCommand(
      { type: "navigate", data: { route: "/inventory/products" } },
      context({ screenPublished }),
    ).then((r) => {
      acked = true;
      return r;
    });

    await Promise.resolve();
    expect(acked).toBe(false);

    arrive(true);
    expect(await running).toEqual({
      ok: true,
      result: { route: "/inventory/products" },
    });
  });

  it("still acks, with a caveat, when the destination never reports in", async () => {
    // A route the app forgot to register must not hang the socket until the
    // runtime's own timeout fires — but the model has to be told, or it will
    // assume the screen-scoped action it wanted is available.
    const result = await executeCommand(
      { type: "navigate", data: { route: "/unregistered" } },
      context({ screenPublished: async () => false }),
    );

    expect(result.ok).toBe(true);
    expect(result.result).toMatchObject({ route: "/unregistered" });
    expect(String((result.result as { note?: string }).note)).toContain(
      "has not reported its context yet",
    );
  });
});

describe("highlight and focus", () => {
  it("highlights a registered element", async () => {
    mount("products.addButton");
    const result = await executeCommand(
      { type: "highlight", data: { componentKey: "products.addButton", message: "Start here." } },
      context(),
    );

    expect(result.ok).toBe(true);
    expect(document.getElementById("mihe-highlight")).not.toBeNull();
  });

  it("reports honestly when the element is not on the page", async () => {
    // The runtime is blocking a turn on this ack, so silence would be worse
    // than a failure — the model needs to know it pointed at nothing.
    const result = await executeCommand(
      { type: "highlight", data: { componentKey: "products.addButton", message: null } },
      context(),
    );

    expect(result.ok).toBe(false);
    expect(result.error).toContain("not on the page");
  });

  it("moves focus into a registered input", async () => {
    const input = mount("productForm.name", "input");
    const result = await executeCommand(
      { type: "focus", data: { componentKey: "productForm.name", message: null } },
      context(),
    );

    expect(result.ok).toBe(true);
    expect(document.activeElement).toBe(input);
  });

  it("focuses the first focusable child when a wrapper is registered", async () => {
    // People register the field wrapper as often as the input itself.
    const wrapper = mount("productForm.price", "div");
    const input = document.createElement("input");
    wrapper.appendChild(input);

    await executeCommand(
      { type: "focus", data: { componentKey: "productForm.price", message: null } },
      context(),
    );

    expect(document.activeElement).toBe(input);
  });

  it("clears the overlay", async () => {
    mount("products.addButton");
    const ctx = context();
    await executeCommand(
      { type: "highlight", data: { componentKey: "products.addButton", message: null } },
      ctx,
    );

    await executeCommand({ type: "clear_highlight" }, ctx);

    expect(document.getElementById("mihe-highlight")).toBeNull();
  });

  it("never intercepts the click it is asking for", async () => {
    mount("products.addButton");
    await executeCommand(
      { type: "highlight", data: { componentKey: "products.addButton", message: null } },
      context(),
    );

    const overlay = document.getElementById("mihe-highlight");
    expect(overlay?.style.pointerEvents).toBe("none");
  });
});

describe("run_frontend_action", () => {
  it("runs the registered handler and returns its value as the tool result", async () => {
    const store = new AssistantStore();
    store.registerAction({
      name: "filter_low_stock",
      handler: () => ({ shown: 7 }),
    });

    const result = await executeCommand(
      { type: "run_frontend_action", data: { actionName: "filter_low_stock", input: {} } },
      context({ store }),
    );

    expect(result).toEqual({ ok: true, result: { shown: 7 } });
  });

  it("passes the validated input through", async () => {
    const handler = vi.fn(() => null);
    const store = new AssistantStore();
    store.registerAction({ name: "create_draft", handler });

    await executeCommand(
      {
        type: "run_frontend_action",
        data: { actionName: "create_draft", input: { name: "Bread", price: 3 } },
      },
      context({ store }),
    );

    expect(handler).toHaveBeenCalledWith({ name: "Bread", price: 3 });
  });

  it("awaits an async handler", async () => {
    const store = new AssistantStore();
    store.registerAction({
      name: "slow",
      handler: async () => {
        await new Promise((resolve) => setTimeout(resolve, 5));
        return { done: true };
      },
    });

    const result = await executeCommand(
      { type: "run_frontend_action", data: { actionName: "slow", input: {} } },
      context({ store }),
    );

    expect(result).toEqual({ ok: true, result: { done: true } });
  });

  it("turns a thrown handler into a reportable failure", async () => {
    // The host app's message is the most useful thing to give the assistant,
    // so it can tell the user what actually went wrong.
    const store = new AssistantStore();
    store.registerAction({
      name: "explodes",
      handler: () => {
        throw new Error("Stock service is unavailable");
      },
    });

    const result = await executeCommand(
      { type: "run_frontend_action", data: { actionName: "explodes", input: {} } },
      context({ store }),
    );

    expect(result).toEqual({ ok: false, error: "Stock service is unavailable" });
  });

  it("reports when no handler is mounted", async () => {
    // Usually means the component owning the action is not on this screen.
    const result = await executeCommand(
      { type: "run_frontend_action", data: { actionName: "filter_low_stock", input: {} } },
      context(),
    );

    expect(result.ok).toBe(false);
    expect(result.error).toContain("No handler is currently mounted");
  });
});

describe("modals", () => {
  it("opens a modal when the app wired it up", async () => {
    const openModal = vi.fn();
    const result = await executeCommand(
      { type: "open_modal", data: { modalKey: "product.createModal" } },
      context({ openModal }),
    );

    expect(openModal).toHaveBeenCalledWith("product.createModal");
    expect(result.ok).toBe(true);
  });

  it("says so plainly when it did not", async () => {
    const result = await executeCommand(
      { type: "open_modal", data: { modalKey: "product.createModal" } },
      context(),
    );

    expect(result.ok).toBe(false);
    expect(result.error).toContain("has not wired up modal opening");
  });

  it("reports a modal the app cannot open rather than claiming success", async () => {
    // A host app routes modal keys to whichever dialogs are currently mounted,
    // so a key for a screen the user has left is a real miss. Returning `ok`
    // for a form that never appeared is precisely the claim the model's
    // standing rules forbid — and it would go on to tell the user to fill in
    // something that is not on their screen.
    const openModal = vi.fn(() => false);
    const result = await executeCommand(
      { type: "open_modal", data: { modalKey: "product.createModal" } },
      context({ openModal }),
    );

    expect(result.ok).toBe(false);
    expect(result.error).toContain("product.createModal");
  });

  it("treats a void return as success, so an older implementation is unchanged", async () => {
    const openModal = vi.fn(() => undefined);
    const result = await executeCommand(
      { type: "open_modal", data: { modalKey: "product.createModal" } },
      context({ openModal }),
    );

    expect(result.ok).toBe(true);
  });
});

describe("forward compatibility", () => {
  it("reports an unknown command rather than silently ignoring it", async () => {
    // A runtime ahead of this SDK should produce a diagnosable message, not
    // an assistant that appears to work but does nothing.
    const result = await executeCommand(
      { type: "teleport", data: {} } as never,
      context(),
    );

    expect(result.ok).toBe(false);
    expect(result.error).toContain("does not understand");
    expect(result.error).toContain("may need updating");
  });
});

describe("set_view", () => {
  function withTabs(onChange: (value: string) => void | Promise<void>) {
    const store = new AssistantStore();
    store.setScreen({ screenId: "reports", route: "/reports", title: "Reports" });
    store.registerControl("reports.tabs", {
      kind: "tabs",
      label: "Report",
      options: [
        { value: "sales", label: "Sales" },
        { value: "stock", label: "Stock" },
      ],
      value: "sales",
      onChange,
    });
    return store;
  }

  it("switches through the app's own onChange and acks once the tab shows", async () => {
    const onChange = vi.fn();
    const viewPublished = vi.fn(async () => true);
    const result = await executeCommand(
      { type: "set_view", data: { controlKey: "reports.tabs", value: "stock" } },
      context({ store: withTabs(onChange), viewPublished }),
    );

    expect(onChange).toHaveBeenCalledWith("stock");
    expect(viewPublished).toHaveBeenCalledWith("reports.tabs", "stock");
    expect(result).toEqual({ ok: true, result: { showing: "stock" } });
  });

  it("never hands onChange a value the app did not declare", async () => {
    // The runtime checks this too. Checked again here so the app's code is
    // safe whatever sent the command.
    const onChange = vi.fn();
    const result = await executeCommand(
      { type: "set_view", data: { controlKey: "reports.tabs", value: "admin" } },
      context({ store: withTabs(onChange) }),
    );

    expect(onChange).not.toHaveBeenCalled();
    expect(result.ok).toBe(false);
  });

  it("reports a switch the screen never showed as a failure", async () => {
    // A controlled tab whose `value` never followed `onChange` looks switched
    // to the model and unchanged to the user. Saying it failed is the truth.
    const result = await executeCommand(
      { type: "set_view", data: { controlKey: "reports.tabs", value: "stock" } },
      context({ store: withTabs(vi.fn()), viewPublished: async () => false }),
    );

    expect(result.ok).toBe(false);
  });

  it("hands back the app's own error when onChange throws", async () => {
    const result = await executeCommand(
      { type: "set_view", data: { controlKey: "reports.tabs", value: "stock" } },
      context({
        store: withTabs(() => {
          throw new Error("Stock report is still loading");
        }),
      }),
    );

    expect(result).toEqual({ ok: false, error: "Stock report is still loading" });
  });
});

describe("query_table", () => {
  function searchable(overrides: { show?: () => void } = {}) {
    const store = new AssistantStore();
    const run = vi.fn(async (_params: Record<string, string>) => ({
      rows: [
        { id: "TLF-0399", Order: "TLF-0399" },
        { id: "TLF-0398", Order: "TLF-0398" },
        { id: "TLF-0397", Order: "TLF-0397" },
      ],
      total: 3,
    }));
    store.registerTable("orders.table", {
      label: "Orders",
      columns: [{ key: "number", label: "Order" }],
      loadedRows: 25,
      read: () => [],
      query: {
        params: [
          { key: "search", kind: "text", values: [], description: "" },
          { key: "status", kind: "enum", values: ["pending", "paid"], description: "" },
          { key: "from", kind: "date", values: [], description: "" },
        ],
        run,
        ...(overrides.show ? { show: overrides.show } : {}),
      },
    });
    return { store, run };
  }

  const query = (params: Record<string, string>, extra: { limit?: number; show?: boolean } = {}) =>
    ({
      type: "query_table",
      data: { tableKey: "orders.table", params, limit: extra.limit ?? 20, show: extra.show ?? false },
    }) as const;

  // The runtime checks these too. The SDK checking again is what makes "only
  // declared parameters reach the app" true whatever sent the command.
  it("never hands the app's search a parameter it did not declare", async () => {
    const { store, run } = searchable();
    const bad: Record<string, string>[] = [{ customerId: "x" }, { status: "refunded" }, { from: "2026-13-45" }];
    for (const params of bad) {
      const result = await executeCommand(query(params), context({ store }));
      expect(result.ok).toBe(false);
    }
    expect(run).not.toHaveBeenCalled();
  });

  it("returns the app's results, cut to the limit, without touching the screen", async () => {
    const show = vi.fn();
    const { store, run } = searchable({ show });
    const result = await executeCommand(query({ search: "Mama Tee" }, { limit: 2 }), context({ store }));
    expect(run).toHaveBeenCalledWith({ search: "Mama Tee" });
    expect(show).not.toHaveBeenCalled();
    expect(result).toEqual({
      ok: true,
      result: {
        rows: [
          { id: "TLF-0399", Order: "TLF-0399" },
          { id: "TLF-0398", Order: "TLF-0398" },
        ],
        total: 3,
        shown: false,
      },
    });
  });

  it("shows the search on the page and waits for it to publish", async () => {
    const show = vi.fn();
    const { store } = searchable({ show });
    const screenPublished = vi.fn(() => Promise.resolve(true));
    const result = await executeCommand(
      query({ status: "paid" }, { show: true }),
      context({ store, screenPublished }),
    );
    expect(show).toHaveBeenCalledWith({ status: "paid" });
    expect(screenPublished).toHaveBeenCalledWith(expect.any(String), { fresh: true });
    expect(result.ok && (result.result as { shown: boolean }).shown).toBe(true);
  });
});

describe("a frontend action that waits on the user", () => {
  // A handler awaiting a dialog outlives the runtime's 10s wait, and the
  // assistant reports as failed what the user then finishes. The console is
  // the only place a developer would hear about it.
  it("warns while it runs long, and again if it finishes after the runtime gave up", async () => {
    vi.useFakeTimers();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const store = new AssistantStore();
      store.registerAction({
        name: "open_dialog_and_wait",
        handler: () => new Promise((resolve) => setTimeout(() => resolve({ saved: true }), 12_000)),
      });
      const running = executeCommand(
        { type: "run_frontend_action", data: { actionName: "open_dialog_and_wait", input: {} } } as never,
        { store, highlighter: new HighlightEngine(), navigate: () => {} },
      );
      await vi.advanceTimersByTimeAsync(5_000);
      expect(warn).toHaveBeenCalledTimes(1);
      expect(String(warn.mock.calls[0]![0])).toContain("open the UI they need and return at once");

      await vi.advanceTimersByTimeAsync(7_000);
      await running;
      expect(warn).toHaveBeenCalledTimes(2);
      expect(String(warn.mock.calls[1]![0])).toContain("finished after the runtime stopped waiting");
    } finally {
      warn.mockRestore();
      vi.useRealTimers();
    }
  });

  it("quotes the runtime's real wait", async () => {
    // Copied from the runtime, so a change there must change it here, or the
    // warning names the wrong number. Skipped outside the monorepo.
    const { existsSync, readFileSync } = await import("node:fs");
    const path = new URL("../../../runtime/crates/server/src/session.rs", import.meta.url);
    if (!existsSync(path)) return;
    const rust = readFileSync(path, "utf8");
    const seconds = /COMMAND_ACK_TIMEOUT: Duration = Duration::from_secs\((\d+)\)/.exec(rust)?.[1];
    expect(Number(seconds) * 1000).toBe(RUNTIME_ACK_WAIT_MS);
  });

  it("says nothing about a handler that answers promptly", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const store = new AssistantStore();
      store.registerAction({ name: "quick", handler: () => ({ shown: 3 }) });
      await executeCommand(
        { type: "run_frontend_action", data: { actionName: "quick", input: {} } } as never,
        { store, highlighter: new HighlightEngine(), navigate: () => {} },
      );
      expect(warn).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });
});
