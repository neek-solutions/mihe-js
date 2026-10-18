/**
 * The three registration hooks (spec §8.3–8.5).
 *
 * All three are declarative: a screen or component is registered while it is
 * mounted and gone when it unmounts, so the assistant's picture of the app can
 * never describe something the user is no longer looking at.
 */

import { useCallback, useEffect, useMemo, useRef } from "react";

import {
  COMPONENT_ATTRIBUTE,
  chartDeclaration,
  chartSignature,
  tableDeclaration,
  tableSignature,
  tabsDeclaration,
  tabsSignature,
  type ActionHandler,
  type AssistantChart,
  type AssistantTable,
  type AssistantTabs,
  type ComponentDeclaration,
  type ScreenDeclaration,
} from "@mihe-dev/js";

import { ASSISTANT_PANEL_ID, useOptionalAssistant } from "./provider";

export type {
  AssistantChart,
  AssistantQueryParam,
  AssistantTable,
  AssistantTableColumn,
  AssistantTableQuery,
  AssistantTabs,
} from "@mihe-dev/js";

/**
 * Declare the screen the user is on.
 *
 * Call once per page or view. `visibleData` is what makes answers concrete —
 * "you have 7 low-stock products" rather than "check your stock levels" — so
 * include the summary values already on screen, and only those.
 */
export function useAssistantScreen(screen: ScreenDeclaration): void {
  const assistant = useOptionalAssistant();

  // Compared by value so a caller passing an inline object literal — the
  // normal thing to do — does not republish on every render.
  const serialized = JSON.stringify(screen);

  useEffect(() => {
    if (!assistant) return;
    const declaration = JSON.parse(serialized) as ScreenDeclaration;
    assistant.store.setScreen(declaration);
    return () => assistant.store.clearScreen(declaration.screenId);
  }, [assistant, serialized]);
}

/**
 * Declare a component the assistant can talk about or point at, and get back
 * the props that make it findable.
 *
 * ```tsx
 * const props = useAssistantComponent("products.addButton", {
 *   type: "button",
 *   label: "Add Product",
 *   description: "Opens the form to create a new product",
 * });
 * return <button {...props}>Add Product</button>;
 * ```
 *
 * The returned props must be spread onto a real DOM element. Without them the
 * component is described to the assistant but cannot be highlighted, which
 * produces the confusing case of an assistant confidently pointing at nothing.
 */
export function useAssistantComponent(
  componentKey: string,
  meta: ComponentDeclaration,
): { [COMPONENT_ATTRIBUTE]: string } {
  const assistant = useOptionalAssistant();
  const serialized = JSON.stringify(meta);

  useEffect(() => {
    if (!assistant) return;
    assistant.store.registerComponent(
      componentKey,
      JSON.parse(serialized) as ComponentDeclaration,
    );
    return () => assistant.store.unregisterComponent(componentKey);
  }, [assistant, componentKey, serialized]);

  return useMemo(
    () => ({ [COMPONENT_ATTRIBUTE]: componentKey }),
    [componentKey],
  );
}

/**
 * Register a handler for an action the assistant may run in the browser.
 *
 * The action itself — its risk tier, permissions, and whether it needs
 * confirmation — is configured in the dashboard, not here. This only supplies
 * the code that runs once the runtime has decided it may.
 *
 * Whatever the handler returns becomes the tool result the model sees, so
 * return something descriptive: `{ shown: 7 }` tells it more than `undefined`.
 * Throwing is fine and reports honestly — the assistant will tell the user it
 * failed rather than claiming success.
 */
export function useAssistantAction(action: ActionHandler): void {
  const assistant = useOptionalAssistant();

  // The handler is read through a ref so a caller can close over fresh state
  // without re-registering on every render.
  const handlerRef = useRef(action.handler);
  handlerRef.current = action.handler;

  useEffect(() => {
    if (!assistant) return;
    assistant.store.registerAction({
      name: action.name,
      handler: (input) => handlerRef.current(input),
    });
    return () => assistant.store.unregisterAction(action.name);
  }, [assistant, action.name]);
}

/**
 * Let the assistant see which tab is open and switch to another.
 *
 * ```tsx
 * const [tab, setTab] = useState("sales");
 * useAssistantTabs({
 *   id: "reports.tabs",
 *   label: "Report",
 *   tabs: [{ value: "sales", label: "Sales" }, { value: "stock", label: "Stock" }],
 *   value: tab,
 *   onChange: setTab,
 * });
 * ```
 *
 * Tabs are built a dozen ways — a UI library's component, a route segment, a
 * query parameter, plain state — so the SDK never touches them. It reports
 * what you declare and calls your `onChange`, and the runtime only ever asks
 * for a value you listed (amendment 67).
 *
 * Pass the tab that is really showing as `value`. The assistant is told it,
 * and a switch is not reported done until `value` matches what was asked.
 */
export function useAssistantTabs(tabs: AssistantTabs): void {
  const assistant = useOptionalAssistant();

  // Read through a ref for `useAssistantAction`'s reason: a caller closing
  // over fresh state must not re-register on every render.
  const latest = useRef(tabs);
  latest.current = tabs;

  const signature = tabsSignature(tabs);

  useEffect(() => {
    if (!assistant) return;
    assistant.store.registerControl(tabs.id, tabsDeclaration(() => latest.current));
  }, [assistant, tabs.id, signature]);

  // Unregistered only when the id or the assistant goes, not on every change
  // of tab: a cleanup between two registrations would publish a screen with
  // no tabs in between, and a voice session would rebuild its tools for it.
  useEffect(() => {
    if (!assistant) return;
    return () => assistant.store.unregisterControl(tabs.id);
  }, [assistant, tabs.id]);
}

/**
 * Let the assistant read a table on the screen.
 *
 * ```tsx
 * useAssistantTable({
 *   id: "orders.table",
 *   label: "Orders",
 *   columns: [
 *     { key: "orderNumber", label: "Order" },
 *     { key: "total", label: "Total" },
 *   ],
 *   rows: orders,
 *   rowId: (order) => order.id,
 *   rowIdName: "orderId",
 *   total,
 * });
 * ```
 *
 * The rows are not sent with the screen. The model is told the table and its
 * columns, and reads rows with `read_table` when a question needs them, so a
 * table costs a line per answer rather than its contents (amendment 67).
 * Only the declared columns ever leave the browser, and cell text is treated
 * as data, never instructions.
 */
export function useAssistantTable<Row>(table: AssistantTable<Row>): void {
  const assistant = useOptionalAssistant();

  // The rows and functions are read at the moment of a read, so a table that
  // re-renders every second does not re-register every second.
  const latest = useRef(table);
  latest.current = table;

  const signature = tableSignature(table);

  useEffect(() => {
    if (!assistant) return;
    assistant.store.registerTable(table.id, tableDeclaration(() => latest.current));
  }, [assistant, table.id, signature]);

  // Unregistered only when the table goes, for `useAssistantTabs`' reason.
  useEffect(() => {
    if (!assistant) return;
    return () => assistant.store.unregisterTable(table.id);
  }, [assistant, table.id]);
}

/**
 * Add the figures a component shows to the screen's `visibleData`, under
 * `key`.
 *
 * For values that live below the page that calls `useAssistantScreen`: the
 * stat cards inside a tab, a summary panel. They are dropped when the
 * component unmounts or the screen changes, and held back while the screen
 * says it is loading, as `visibleData` is.
 *
 * ```tsx
 * useAssistantValues("stockSummary", { currentStockValue, periodInflow });
 * ```
 */
export function useAssistantValues(key: string, values: Record<string, unknown>): void {
  const assistant = useOptionalAssistant();
  const serialized = JSON.stringify(values);

  useEffect(() => {
    if (!assistant) return;
    assistant.store.setValues(key, JSON.parse(serialized) as Record<string, unknown>);
  }, [assistant, key, serialized]);

  useEffect(() => {
    if (!assistant) return;
    return () => assistant.store.clearValues(key);
  }, [assistant, key]);
}

/**
 * Let the assistant explain a chart.
 *
 * ```tsx
 * useAssistantChart({
 *   id: "stock.trend",
 *   title: "Stock trend",
 *   data: series,
 *   x: { key: "bucket", label: "Month", format: (v) => monthLabel(String(v)) },
 *   series: [
 *     { key: "inflowValue", name: "Stock in", unit: "NGN" },
 *     { key: "outflowValue", name: "Stock out", unit: "NGN" },
 *   ],
 * });
 * ```
 *
 * Each series is summarised here, in the browser, and the summary is what
 * the model gets with the screen: start, end, high, low, total and the
 * largest steps. That answers most questions about a trend in a few dozen
 * tokens a series. The points are read with `read_chart` when an exact value
 * is wanted (amendment 67). A picture of the chart is never sent.
 */
export function useAssistantChart<Datum>(chart: AssistantChart<Datum>): void {
  const assistant = useOptionalAssistant();

  const latest = useRef(chart);
  latest.current = chart;

  const signature = chartSignature(chart);

  useEffect(() => {
    if (!assistant) return;
    assistant.store.registerChart(chart.id, chartDeclaration(() => latest.current));
  }, [assistant, chart.id, signature]);

  useEffect(() => {
    if (!assistant) return;
    return () => assistant.store.unregisterChart(chart.id);
  }, [assistant, chart.id]);
}

/** Props that turn any element into an assistant trigger. */
export interface AssistantTriggerProps {
  onClick: () => void;
  onKeyDown: (event: { key: string; preventDefault: () => void }) => void;
  role: "button";
  tabIndex: 0;
  "aria-expanded": boolean;
  "aria-controls": string;
  "aria-haspopup": "dialog";
}

/**
 * Make anything open the assistant — a nav button, a menu item, a card, a
 * plain div.
 *
 * ```tsx
 * const trigger = useAssistantTrigger();
 * return <div {...trigger}>Ask the assistant</div>;
 * ```
 *
 * The `role`, `tabIndex`, and `onKeyDown` are why this is a hook rather than
 * advice to call `toggle()` yourself: a `div` with only an `onClick` is
 * invisible to keyboards and screen readers, and that is the most common way
 * a custom trigger ships broken. On a real `<button>` they are harmless.
 *
 * **Returns `null` when there is no assistant**, so the caller can render
 * nothing rather than a control that does not work. Triggers live in shared
 * chrome — a command palette, a nav item, a help link — which is exactly the
 * code that renders whether or not a host app has configured the assistant.
 * Throwing there would make the whole surface conditional on something it has
 * no reason to know about.
 */
export function useAssistantTrigger(): AssistantTriggerProps | null {
  const assistant = useOptionalAssistant();
  const isOpen = assistant?.isOpen ?? false;
  const toggle = assistant?.toggle;

  return useMemo(
    () => (!toggle ? null : {
      onClick: toggle,
      onKeyDown: (event) => {
        // Space and Enter are what a native button responds to.
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          toggle();
        }
      },
      role: "button" as const,
      tabIndex: 0 as const,
      "aria-expanded": isOpen,
      "aria-controls": ASSISTANT_PANEL_ID,
      "aria-haspopup": "dialog" as const,
    }),
    [isOpen, toggle],
  );
}

/**
 * A one-tap "ask this" trigger, for suggestion chips and contextual help
 * links.
 *
 * ```tsx
 * <button onClick={useAssistantPrompt("How do I add a product?")}>
 *   How do I add a product?
 * </button>
 * ```
 *
 * Sending opens the assistant, so the reply is visible without the host app
 * having to coordinate two calls.
 *
 * `null` when there is no assistant, for the same reason as
 * [`useAssistantTrigger`]: a chip that silently does nothing is worse than one
 * that was never rendered.
 */
export function useAssistantPrompt(text: string): (() => void) | null {
  const assistant = useOptionalAssistant();
  const send = assistant?.send;
  const ask = useCallback(() => send?.(text), [send, text]);
  return send ? ask : null;
}
