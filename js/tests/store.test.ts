import { describe, expect, it, vi } from "vitest";

import { AssistantStore } from "../src/store";

const productsScreen = {
  screenId: "inventory.products",
  route: "/inventory/products",
  title: "Products",
  description: "Manage the catalog",
  visibleData: { lowStockCount: 7 },
};

describe("AssistantStore", () => {
  it("has no context before a screen registers", () => {
    expect(new AssistantStore().getScreenContext()).toBeNull();
  });

  it("builds a full screen context from the declaration", () => {
    const store = new AssistantStore();
    store.setScreen(productsScreen);
    store.registerComponent("products.addButton", {
      type: "button",
      label: "Add Product",
      description: "Opens the create form",
    });

    const context = store.getScreenContext();
    expect(context).toMatchObject({
      screenId: "inventory.products",
      route: "/inventory/products",
      visibleData: { lowStockCount: 7 },
    });
    expect(context?.components).toEqual([
      {
        componentKey: "products.addButton",
        type: "button",
        label: "Add Product",
        description: "Opens the create form",
        actions: [],
      },
    ]);
  });

  it("returns the same snapshot until something changes", () => {
    // useSyncExternalStore compares by reference; a fresh object every read
    // would re-render the whole app on every tick.
    const store = new AssistantStore();
    store.setScreen(productsScreen);

    const first = store.getScreenContext();
    expect(store.getScreenContext()).toBe(first);

    store.registerComponent("products.addButton", { type: "button", label: "Add" });
    expect(store.getScreenContext()).not.toBe(first);
  });

  it("drops components when the user moves to another screen", () => {
    // Otherwise the assistant would be told it can point at a button from the
    // page the user just left.
    const store = new AssistantStore();
    store.setScreen(productsScreen);
    store.registerComponent("products.addButton", { type: "button", label: "Add" });

    store.setScreen({
      screenId: "orders.list",
      route: "/orders",
      title: "Orders",
    });

    expect(store.getScreenContext()?.components).toEqual([]);
    expect(store.hasComponent("products.addButton")).toBe(false);
  });

  it("keeps components when the same screen re-registers", () => {
    // A parent re-render must not blank the component list mid-conversation.
    const store = new AssistantStore();
    store.setScreen(productsScreen);
    store.registerComponent("products.addButton", { type: "button", label: "Add" });

    store.setScreen({ ...productsScreen, visibleData: { lowStockCount: 6 } });

    expect(store.getScreenContext()?.components).toHaveLength(1);
    expect(store.getScreenContext()?.visibleData).toEqual({ lowStockCount: 6 });
  });

  it("ignores a stale unmount from the previous screen", () => {
    // React mounts the next screen before unmounting the previous one, so a
    // late cleanup must not wipe the screen the user is now looking at.
    const store = new AssistantStore();
    store.setScreen(productsScreen);
    store.setScreen({ screenId: "orders.list", route: "/orders", title: "Orders" });

    store.clearScreen("inventory.products");

    expect(store.getScreenContext()?.screenId).toBe("orders.list");
  });

  it("clears the screen on its own unmount", () => {
    const store = new AssistantStore();
    store.setScreen(productsScreen);
    store.clearScreen("inventory.products");
    expect(store.getScreenContext()).toBeNull();
  });

  it("notifies subscribers when the declaration changes", () => {
    const store = new AssistantStore();
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);

    store.setScreen(productsScreen);
    expect(listener).toHaveBeenCalledTimes(1);

    store.registerComponent("a", { type: "button", label: "A" });
    expect(listener).toHaveBeenCalledTimes(2);

    unsubscribe();
    store.registerComponent("b", { type: "button", label: "B" });
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("does not republish when an unregistered component is removed", () => {
    const store = new AssistantStore();
    const listener = vi.fn();
    store.subscribe(listener);

    store.unregisterComponent("never-registered");
    expect(listener).not.toHaveBeenCalled();
  });

  it("keeps action handlers out of the published context", () => {
    // Handlers are functions and are not serializable; they also tell the
    // runtime nothing it does not already know from the registry.
    const store = new AssistantStore();
    store.setScreen(productsScreen);
    const listener = vi.fn();
    store.subscribe(listener);

    store.registerAction({ name: "filter_low_stock", handler: () => null });

    expect(listener).not.toHaveBeenCalled();
    expect(JSON.stringify(store.getScreenContext())).not.toContain("filter_low_stock");
    expect(store.getAction("filter_low_stock")).toBeDefined();
  });

  it("warns when two handlers claim the same action name", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const store = new AssistantStore();

    store.registerAction({ name: "duplicate", handler: () => 1 });
    store.registerAction({ name: "duplicate", handler: () => 2 });

    expect(warn).toHaveBeenCalledWith(expect.stringContaining("duplicate"));
    warn.mockRestore();
  });
});

describe("view controls", () => {
  const tabs = {
    kind: "tabs" as const,
    label: "Report",
    options: [
      { value: "sales", label: "Sales" },
      { value: "stock", label: "Stock" },
    ],
    value: "sales",
    onChange: () => {},
  };

  it("publishes what the app declared, without its code", async () => {
    const store = new AssistantStore();
    store.setScreen({ screenId: "reports", route: "/reports", title: "Reports" });
    store.registerControl("reports.tabs", tabs);

    expect(store.getScreenContext()?.controls).toEqual([
      {
        controlKey: "reports.tabs",
        kind: "tabs",
        label: "Report",
        options: tabs.options,
        value: "sales",
      },
    ]);
  });

  it("drops the tabs of a screen the user has left", () => {
    // Otherwise the assistant is told it can switch tabs on a page that is gone.
    const store = new AssistantStore();
    store.setScreen({ screenId: "reports", route: "/reports", title: "Reports" });
    store.registerControl("reports.tabs", tabs);
    store.setScreen({ screenId: "orders", route: "/orders", title: "Orders" });

    expect(store.getScreenContext()?.controls).toEqual([]);
    expect(store.getControl("reports.tabs")).toBeUndefined();
  });
});

describe("a screen still loading", () => {
  it("sends no values until its data has arrived", () => {
    // The zeros a page declares before its queries resolve are not facts.
    const store = new AssistantStore();
    store.setScreen({
      screenId: "inventory",
      route: "/inventory",
      title: "Inventory",
      visibleData: { ingredients: 0 },
      loading: true,
    });
    expect(store.getScreenContext()?.visibleData).toEqual({});
    expect(store.isScreenLoading()).toBe(true);

    store.setScreen({
      screenId: "inventory",
      route: "/inventory",
      title: "Inventory",
      visibleData: { ingredients: 16 },
    });
    expect(store.getScreenContext()?.visibleData).toEqual({ ingredients: 16 });
  });
});

describe("values added by a component", () => {
  it("join the screen's values, and go with the screen", () => {
    const store = new AssistantStore();
    store.setScreen({ screenId: "analytics", route: "/a", title: "A", visibleData: { from: "2025-10-01" } });
    store.setValues("stockSummary", { currentStockValue: 224368.66 });
    expect(store.getScreenContext()?.visibleData).toEqual({
      from: "2025-10-01",
      stockSummary: { currentStockValue: 224368.66 },
    });

    store.setScreen({ screenId: "orders", route: "/o", title: "O" });
    expect(store.getScreenContext()?.visibleData).toEqual({});
  });
});
