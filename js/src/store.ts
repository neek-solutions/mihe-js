/**
 * The app's declaration of itself.
 *
 * Spec §5.1 — the host app publishes assistant-readable context rather than
 * the assistant scraping the DOM. This store is where those declarations
 * accumulate: the current screen from `useAssistantScreen`, the components
 * that mounted under it from `useAssistantComponent`, and the action handlers
 * from `useAssistantAction`.
 *
 * Deliberately framework-free and dependency-free. React binds to it through
 * `useSyncExternalStore`, which keeps the store itself testable without a
 * renderer and avoids pulling a state library into a published SDK.
 */

import type {
  ChartPoint,
  ChartSeries,
  ChartXKind,
  ComponentContext,
  ScreenContext,
  ViewControl,
} from "@mihe-dev/protocol";

/** What a screen declares about itself, minus the components. */
export interface ScreenDeclaration {
  screenId: string;
  route: string;
  title: string;
  description?: string;
  keywords?: string[];
  /**
   * Summary values visible on screen. Keep this small and scalar — counts,
   * totals, statuses. It is context for the assistant, not a data dump, and
   * every byte here is sent on every screen change.
   */
  visibleData?: Record<string, unknown>;
  /**
   * The page's data has not arrived yet. While true, `visibleData` is not
   * sent, and a navigation to this screen is not reported done.
   *
   * Without it, the counts a page declares before its queries resolve are
   * zeros, and an assistant that has just navigated here reads them as the
   * truth: "you have no raw materials", on a page about to show sixteen.
   */
  loading?: boolean;
}

/** What a component declares about itself. */
export interface ComponentDeclaration {
  type: ComponentContext["type"];
  label: string;
  description?: string;
  actions?: string[];
}

/**
 * A tab set, or another control that changes what the screen shows
 * (amendment 67). `onChange` is the app's own code, which is what lets this
 * work however the tabs are built.
 */
export interface ViewControlDeclaration {
  kind: ViewControl["kind"];
  label: string;
  options: { value: string; label: string }[];
  value?: string;
  onChange: (value: string) => void | Promise<void>;
}

/**
 * A table the assistant can read (amendment 67, step 2). The rows stay here,
 * read through `read_table` when a question needs them.
 */
export interface TableDeclaration {
  label: string;
  columns: { key: string; label: string }[];
  /** The input name a row's id fills, such as `orderId`. */
  rowIdName?: string;
  /** The screen a row opens. Each row read carries its `open` params. */
  opens?: string;
  /** Rows in the whole list, when the page shows only some. */
  total?: number;
  /** How many rows are loaded, for the screen context. */
  loadedRows: number;
  /** The rows as they are right now, rendered to declared columns only. */
  read: (offset: number, limit: number) => TableRow[];
  /** How the table can be searched past its loaded rows (amendment 67, step 3). */
  query?: TableQueryDeclaration;
}

/** One parameter a table search accepts, as the page declared it. */
export interface QueryParamDeclaration {
  key: string;
  kind: "text" | "enum" | "date";
  /** For `enum`: the values accepted. */
  values: string[];
  description: string;
}

/** A table's search: what it takes, and the app's code that runs it. */
export interface TableQueryDeclaration {
  params: QueryParamDeclaration[];
  /** Runs the app's own search and renders the result to declared columns. */
  run: (params: Record<string, string>) => Promise<{ rows: TableRow[]; total?: number }>;
  /** Makes the table on screen show this search, when the page can. */
  show?: (params: Record<string, string>) => void | Promise<void>;
}

/**
 * One row as the model sees it: its id, the params that open it when the
 * table opens a screen, and each declared column by label.
 */
export type TableRow = { id: string; open?: Record<string, string> } & Record<
  string,
  string | number | boolean | null | Record<string, string> | undefined
>;

/** A chart the assistant can explain (amendment 67, step 4). */
export interface ChartDeclaration {
  title: string;
  xLabel: string;
  xKind: ChartXKind;
  /** Names, units and summaries, as the screen context carries them. */
  series: ChartSeries[];
  /** The points as they are right now, thinned to `limit` per series. */
  read: (series: string | undefined, limit: number) => { name: string; points: ChartPoint[] }[];
}

/** A frontend action the assistant may run. */
export interface ActionHandler {
  name: string;
  handler: (input: Record<string, unknown>) => unknown | Promise<unknown>;
}

type Listener = () => void;

export class AssistantStore {
  private screen: ScreenDeclaration | null = null;
  /** Insertion-ordered, so the context sent to the model is stable. */
  private components = new Map<string, ComponentDeclaration>();
  private controls = new Map<string, ViewControlDeclaration>();
  private tables = new Map<string, TableDeclaration>();
  private charts = new Map<string, ChartDeclaration>();
  /** Values a component on the screen adds to its `visibleData`, by key. */
  private values = new Map<string, Record<string, unknown>>();
  private actions = new Map<string, ActionHandler>();
  private listeners = new Set<Listener>();

  /** Cached so `useSyncExternalStore` sees a stable reference between changes. */
  private snapshot: ScreenContext | null = null;
  private snapshotDirty = true;

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  /**
   * The current screen context, or null before any screen has registered.
   *
   * Returns the same object until something actually changes, so React can
   * bail out of re-rendering and the provider can skip republishing.
   */
  getScreenContext = (): ScreenContext | null => {
    if (!this.snapshotDirty) return this.snapshot;

    this.snapshot = this.screen
      ? {
          screenId: this.screen.screenId,
          route: this.screen.route,
          title: this.screen.title,
          description: this.screen.description ?? "",
          keywords: this.screen.keywords ?? [],
          visibleData: (this.screen.loading
            ? {}
            : {
                ...(this.screen.visibleData ?? {}),
                ...Object.fromEntries(this.values),
              }) as ScreenContext["visibleData"],
          components: [...this.components.entries()].map(([componentKey, meta]) => ({
            componentKey,
            type: meta.type,
            label: meta.label,
            description: meta.description ?? "",
            actions: meta.actions ?? [],
          })),
          controls: [...this.controls.entries()].map(([controlKey, control]) => ({
            controlKey,
            kind: control.kind,
            label: control.label,
            options: control.options.map(({ value, label }) => ({ value, label })),
            ...(control.value === undefined ? {} : { value: control.value }),
          })),
          tables: [...this.tables.entries()].map(([tableKey, table]) => ({
            tableKey,
            label: table.label,
            columns: table.columns.map(({ key, label }) => ({ key, label })),
            loadedRows: table.loadedRows,
            ...(table.rowIdName ? { rowId: table.rowIdName } : {}),
            ...(table.opens ? { opens: table.opens } : {}),
            ...(table.total === undefined ? {} : { totalRows: table.total }),
            ...(table.query
              ? {
                  query: {
                    params: table.query.params.map(({ key, kind, values, description }) => ({
                      key,
                      kind,
                      values,
                      description,
                    })),
                    canShow: table.query.show !== undefined,
                  },
                }
              : {}),
          })),
          charts: [...this.charts.entries()].map(([chartKey, chart]) => ({
            chartKey,
            title: chart.title,
            xLabel: chart.xLabel,
            xKind: chart.xKind,
            series: chart.series,
          })),
        }
      : null;

    this.snapshotDirty = false;
    return this.snapshot;
  };

  setScreen(screen: ScreenDeclaration): void {
    const previous = this.screen;
    this.screen = screen;

    // Components belong to the screen that registered them. Moving to a new
    // screen clears them, so the assistant is never told it can point at an
    // element from the page the user just left.
    if (previous && previous.screenId !== screen.screenId) {
      this.components.clear();
      this.controls.clear();
      this.tables.clear();
      this.charts.clear();
      this.values.clear();
    }
    this.invalidate();
  }

  clearScreen(screenId: string): void {
    // Ignore a stale unmount: React mounts the next screen before unmounting
    // the previous one, so a late cleanup must not wipe the new screen.
    if (this.screen?.screenId !== screenId) return;
    this.screen = null;
    this.components.clear();
    this.controls.clear();
    this.tables.clear();
    this.charts.clear();
    this.values.clear();
    this.invalidate();
  }

  registerComponent(componentKey: string, meta: ComponentDeclaration): void {
    this.components.set(componentKey, meta);
    this.invalidate();
  }

  unregisterComponent(componentKey: string): void {
    if (this.components.delete(componentKey)) this.invalidate();
  }

  registerControl(controlKey: string, control: ViewControlDeclaration): void {
    this.controls.set(controlKey, control);
    this.invalidate();
  }

  unregisterControl(controlKey: string): void {
    if (this.controls.delete(controlKey)) this.invalidate();
  }

  getControl(controlKey: string): ViewControlDeclaration | undefined {
    return this.controls.get(controlKey);
  }

  registerTable(tableKey: string, table: TableDeclaration): void {
    this.tables.set(tableKey, table);
    this.invalidate();
  }

  unregisterTable(tableKey: string): void {
    if (this.tables.delete(tableKey)) this.invalidate();
  }

  getTable(tableKey: string): TableDeclaration | undefined {
    return this.tables.get(tableKey);
  }

  setValues(key: string, values: Record<string, unknown>): void {
    this.values.set(key, values);
    this.invalidate();
  }

  clearValues(key: string): void {
    if (this.values.delete(key)) this.invalidate();
  }

  registerChart(chartKey: string, chart: ChartDeclaration): void {
    this.charts.set(chartKey, chart);
    this.invalidate();
  }

  unregisterChart(chartKey: string): void {
    if (this.charts.delete(chartKey)) this.invalidate();
  }

  getChart(chartKey: string): ChartDeclaration | undefined {
    return this.charts.get(chartKey);
  }

  registerAction(action: ActionHandler): void {
    if (this.actions.has(action.name)) {
      console.warn(
        `[assistant] Two handlers registered for action "${action.name}". ` +
          `The most recent one wins; the earlier one will never run.`,
      );
    }
    this.actions.set(action.name, action);
    // Handlers are not part of the published context, so no invalidate.
  }

  unregisterAction(name: string): void {
    this.actions.delete(name);
  }

  getAction(name: string): ActionHandler | undefined {
    return this.actions.get(name);
  }

  /** Whether the current screen says its data is still loading. */
  isScreenLoading(): boolean {
    return this.screen?.loading === true;
  }

  hasComponent(componentKey: string): boolean {
    return this.components.has(componentKey);
  }

  private invalidate(): void {
    this.snapshotDirty = true;
    for (const listener of this.listeners) listener();
  }
}
