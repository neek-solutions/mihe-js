/**
 * What an app declares about tabs, tables and charts, and how each becomes
 * what the store holds (amendment 67, doc 08).
 *
 * Shared by the JavaScript API (`mihe.registerTable(…)`) and the React hooks
 * (`useAssistantTable(…)`), so the two can't send the model different things
 * for the same table. Each builder takes `latest`, a function returning the
 * declaration as it is now: rows, closures and data are read at the moment of
 * a read rather than captured at registration, so a table that re-renders
 * every second doesn't re-register every second.
 */

import type { ChartPoint } from "@mihe-dev/protocol";

import { summarise, thin } from "./chart";
import type {
  ChartDeclaration,
  QueryParamDeclaration,
  TableDeclaration,
  ViewControlDeclaration,
} from "./store";

/** A set of tabs the assistant can see and switch. */
export interface AssistantTabs {
  /** Unique on the screen, e.g. `reports.tabs`. The model refers to it by this. */
  id: string;
  /** What the tabs choose between, for the model: "Report", "Period". */
  label: string;
  tabs: { value: string; label: string }[];
  /** The tab showing now. */
  value: string | undefined;
  /** Switch to `value`. Called with one of `tabs`' values and nothing else. */
  onChange: (value: string) => void | Promise<void>;
}

/** A column a table exposes. Undeclared fields are never sent. */
export interface AssistantTableColumn<Row> {
  key: string;
  /** What the model calls it, and the key each row's cell is read under. */
  label: string;
  /** The cell's value. Defaults to `row[key]`. */
  value?: (row: Row) => unknown;
}

/** A table the assistant can read. */
export interface AssistantTable<Row> {
  /** Unique on the screen, e.g. `orders.table`. */
  id: string;
  label: string;
  columns: AssistantTableColumn<Row>[];
  /** The rows loaded now — the page on screen, for a paged table. */
  rows: Row[];
  rowId: (row: Row) => string;
  /**
   * The action input a row's id fills, such as `orderId`. The runtime tells
   * the model which actions accept it, from your registry and the user's
   * permissions. Leave it out for rows nothing acts on.
   */
  rowIdName?: string;
  /**
   * The screen a row opens, and the route params that open it:
   * `{ screenId: "orders.detail", params: (order) => ({ id: order.id }) }`.
   * Each row the model reads then carries exactly those params, so it never
   * has to guess which of a record's ids the link wants.
   */
  opens?: { screenId: string; params: (row: Row) => Record<string, string> };
  /** Rows in the whole list, when `rows` is one page of it. */
  total?: number;
  /**
   * Search past the loaded rows, with your own API and the user's own
   * session (amendment 67, step 3). The model fills in `params`; only the
   * keys you declare, and for an enum only its values, ever reach `run`.
   *
   * ```ts
   * query: {
   *   params: {
   *     search: { kind: "text", description: "order number or customer name" },
   *     status: { kind: "enum", values: ["pending", "paid"] },
   *     from: { kind: "date" },
   *   },
   *   run: async (p) => {
   *     const res = await fetchOrders({ search: p.search, status: p.status, dateFrom: p.from });
   *     return { rows: res.data, total: res.meta.total };
   *   },
   *   // Optional. Make the page show this search — set its filters and
   *   // search box. Without it, results are read but not shown.
   *   show: (p) => { setSearch(p.search ?? ""); setStatus(p.status ?? "all"); },
   * }
   * ```
   *
   * It only reads. A search is in `navigate`'s class: it changes what is
   * shown, never what is stored.
   */
  query?: AssistantTableQuery<Row>;
}

/** A search parameter: what the model may fill in. */
export type AssistantQueryParam =
  | { kind: "text"; description?: string }
  | { kind: "enum"; values: readonly string[]; description?: string }
  | { kind: "date"; description?: string };

/** How a table is searched beyond the rows it has loaded. */
export interface AssistantTableQuery<Row> {
  params: Record<string, AssistantQueryParam>;
  run: (params: Record<string, string>) => Promise<{ rows: Row[]; total?: number }>;
  show?: (params: Record<string, string>) => void | Promise<void>;
}

/** A chart the assistant can explain. */
export interface AssistantChart<Datum> {
  /** Unique on the screen, e.g. `stock.trend`. */
  id: string;
  title: string;
  /** The rows the chart is drawn from: the same array your chart library gets. */
  data: Datum[];
  x: {
    key: keyof Datum & string;
    /** What the axis is: "Month", "Product". */
    label: string;
    /**
     * `ordered` for time and anything else with a sequence, `category` for a
     * set of things. Rises and falls are worked out only for the first.
     * Defaults to `ordered`.
     */
    kind?: "ordered" | "category";
    /** How an x value reads, such as "Mar 26" for "2026-03-01". */
    format?: (value: unknown) => string;
  };
  series: { key: keyof Datum & string; name: string; unit?: string }[];
}

/** Long cells are cut here: a notes field should not cost a page of tokens. */
const MAX_CELL_CHARS = 200;

export function toCell(value: unknown): string | number | boolean | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "number" || typeof value === "boolean") return value;
  const text =
    value instanceof Date
      ? value.toISOString()
      : typeof value === "string"
        ? value
        : JSON.stringify(value);
  return text.length > MAX_CELL_CHARS ? `${text.slice(0, MAX_CELL_CHARS)}…` : text;
}

/** The tabs as the store holds them. `onChange` is read at call time. */
export function tabsDeclaration(latest: () => AssistantTabs): ViewControlDeclaration {
  const tabs = latest();
  return {
    kind: "tabs",
    label: tabs.label,
    options: tabs.tabs.map(({ value, label }) => ({ value, label })),
    value: tabs.value,
    onChange: (value) => latest().onChange(value),
  };
}

/**
 * What identifies a tab set's declaration, without its closure: when this
 * changes, the store needs the new declaration.
 */
export function tabsSignature(tabs: AssistantTabs): string {
  return JSON.stringify({
    label: tabs.label,
    tabs: tabs.tabs.map(({ value, label }) => ({ value, label })),
    value: tabs.value,
  });
}

/** The query parameters a table accepts, as the store holds them. */
function queryParams(query: AssistantTableQuery<unknown>): QueryParamDeclaration[] {
  return Object.entries(query.params).map(([key, param]) => ({
    key,
    kind: param.kind,
    values: param.kind === "enum" ? [...param.values] : [],
    description: param.description ?? "",
  }));
}

/**
 * What identifies a table's declaration, without its rows or closures: when
 * this changes, the store needs the new declaration. The rows' count is in
 * it, because the screen context reports how many are loaded.
 */
export function tableSignature<Row>(table: AssistantTable<Row>): string {
  return JSON.stringify({
    label: table.label,
    columns: table.columns.map(({ key, label }) => ({ key, label })),
    rowIdName: table.rowIdName,
    opens: table.opens?.screenId,
    total: table.total,
    loaded: table.rows.length,
    query: table.query
      ? {
          params: queryParams(table.query as AssistantTableQuery<unknown>),
          canShow: table.query.show !== undefined,
        }
      : undefined,
  });
}

/** The table as the store holds it. Rows and closures are read at call time. */
export function tableDeclaration<Row>(latest: () => AssistantTable<Row>): TableDeclaration {
  const table = latest();

  // One rendering for rows read and rows found, so a search result looks
  // exactly like a read: declared columns only, cells cut, `open` params.
  const render = (row: Row) => {
    const { rowId, columns, opens } = latest();
    const out: Record<string, string | number | boolean | null> = {};
    for (const column of columns) {
      const raw = column.value ? column.value(row) : (row as Record<string, unknown>)[column.key];
      out[column.label] = toCell(raw);
    }
    return {
      id: rowId(row),
      ...(opens ? { open: opens.params(row) } : {}),
      ...out,
    };
  };

  return {
    label: table.label,
    columns: table.columns.map(({ key, label }) => ({ key, label })),
    rowIdName: table.rowIdName,
    opens: table.opens?.screenId,
    total: table.total,
    loadedRows: table.rows.length,
    read: (offset, limit) => latest().rows.slice(offset, offset + limit).map(render),
    ...(table.query
      ? {
          query: {
            params: queryParams(table.query as AssistantTableQuery<unknown>),
            run: async (params: Record<string, string>) => {
              const query = latest().query;
              if (!query) throw new Error("This table can no longer be searched.");
              const found = await query.run(params);
              return {
                rows: found.rows.map(render),
                ...(found.total === undefined ? {} : { total: found.total }),
              };
            },
            ...(table.query.show
              ? { show: (params: Record<string, string>) => latest().query?.show?.(params) }
              : {}),
          },
        }
      : {}),
  };
}

/** Each series' points, read from the chart as it is now. */
function chartPoints<Datum>(chart: AssistantChart<Datum>, key: string): ChartPoint[] {
  const format = chart.x.format;
  return chart.data.flatMap((datum) => {
    const raw = (datum as Record<string, unknown>)[key];
    const y = typeof raw === "number" ? raw : raw == null ? NaN : Number(raw);
    if (!Number.isFinite(y)) return [];
    const xRaw = (datum as Record<string, unknown>)[chart.x.key];
    return [{ x: format ? format(xRaw) : String(xRaw), y }];
  });
}

/**
 * The chart as the store holds it: each series summarised here, in the
 * browser, and the points read at call time when an exact value is wanted.
 */
export function chartDeclaration<Datum>(latest: () => AssistantChart<Datum>): ChartDeclaration {
  const chart = latest();
  const ordered = chart.x.kind !== "category";
  return {
    title: chart.title,
    xLabel: chart.x.label,
    xKind: ordered ? "ordered" : "category",
    series: chart.series.map((s) => {
      const summary = summarise(chartPoints(chart, s.key), ordered);
      return {
        name: s.name,
        ...(s.unit ? { unit: s.unit } : {}),
        ...(summary ? { summary } : {}),
      };
    }),
    read: (name, limit) => {
      const current = latest();
      return current.series
        .filter((s) => name === undefined || s.name === name)
        .map((s) => ({ name: s.name, points: thin(chartPoints(current, s.key), limit) }));
    },
  };
}

/** What identifies a chart's declaration: its summaries, not its closures. */
export function chartSignature<Datum>(chart: AssistantChart<Datum>): string {
  const { read: _read, ...declared } = chartDeclaration(() => chart);
  return JSON.stringify(declared);
}
