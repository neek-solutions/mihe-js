/**
 * Executing the commands the runtime sends.
 *
 * Every command names a registered target — a route the runtime resolved from
 * its screen catalogue, or a component key the app declared. Nothing here
 * takes a CSS selector or a coordinate, so there is no path by which the model
 * drives the UI directly (spec §5.2).
 *
 * Every branch returns a result, including failures, because the runtime is
 * blocking a turn on the ack and the model needs to learn the truth. Reporting
 * "the element was not on screen" is far better than reporting nothing.
 */

import type { AssistantCommand } from "@mihe-dev/protocol";

import type { HighlightEngine } from "./highlight";
import { findComponent } from "./highlight";
import type { AssistantStore, QueryParamDeclaration, TableRow } from "./store";

/** When a frontend action is warned about as slow. */
export const ACTION_SLOW_MS = 5_000;

/**
 * How long the runtime waits for a command's answer by default
 * (`COMMAND_ACK_TIMEOUT` in the runtime's session.rs); an action's
 * `timeoutSeconds` or the app's setting can make it longer (amendment 103).
 * Past it, the assistant is told the command failed.
 */
export const RUNTIME_ACK_WAIT_MS = 10_000;

export interface CommandResult {
  ok: boolean;
  result?: unknown;
  error?: string;
}

export interface CommandContext {
  store: AssistantStore;
  highlighter: HighlightEngine;
  /**
   * How the host app changes route. Supplied by the customer, because only
   * they know whether that is Next.js's router, React Router, or something
   * else. Defaults to a full page load, which works everywhere and is
   * noticeably worse — the docs should push people to wire this up.
   */
  navigate: (route: string) => void;
  /**
   * Resolves once the screen at `route` has published its context to the
   * runtime, or `false` if it has not done so within the timeout.
   *
   * Navigating is the one command whose effects are not finished when the
   * function returns: the router swaps the tree, React mounts the destination,
   * its hooks register, and only then does the new context travel. The runtime
   * re-reads the screen after every tool call to decide what the next step may
   * do, so acking before that lands would tell it the user is still on the
   * screen they just left — and the action they navigated *for* would be
   * filtered out as off-screen.
   *
   * Optional so a hand-built context still works; the provider always supplies
   * it.
   */
  screenPublished?: (route: string, options?: { fresh?: boolean }) => Promise<boolean>;
  /**
   * Resolves once a published screen shows `controlKey` set to `value`, or
   * `false` if none does within the timeout. A switch is acked only then, for
   * `screenPublished`'s reason: the runtime's next step reads the screen.
   */
  viewPublished?: (controlKey: string, value: string) => Promise<boolean>;
  /** Opens a registered modal, when the host app has modals to open. */
  /** Return `false` when the key is not one this app can open. */
  openModal?: (modalKey: string) => void | boolean;
}

/** Why a set of search parameters is not what the table declared, or null. */
export function checkQueryParams(
  declared: QueryParamDeclaration[],
  params: Record<string, string>,
): string | null {
  for (const [key, value] of Object.entries(params)) {
    const param = declared.find((p) => p.key === key);
    if (!param) return `"${key}" is not something this table can be searched by.`;
    if (typeof value !== "string") return `The value for "${key}" must be a string.`;
    if (param.kind === "enum" && !param.values.includes(value)) {
      return `"${value}" is not one of "${key}"'s values.`;
    }
    if (param.kind === "date" && !isIsoDate(value)) {
      return `"${value}" is not a date in YYYY-MM-DD form.`;
    }
    if (param.kind === "text" && (value.length > MAX_QUERY_TEXT || /[\u0000-\u001f\u007f]/.test(value))) {
      return `The search for "${key}" is too long or contains control characters.`;
    }
  }
  return null;
}

/** Matches the runtime's cap, `QUERY_TEXT_MAX_CHARS`. */
const MAX_QUERY_TEXT = 100;

function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function currentPath(): string | null {
  return typeof window === "undefined" ? null : window.location.pathname;
}

function currentUrl(): string | null {
  return typeof window === "undefined"
    ? null
    : window.location.pathname + window.location.search;
}

export async function executeCommand(
  command: AssistantCommand,
  ctx: CommandContext,
): Promise<CommandResult> {
  switch (command.type) {
    case "navigate": {
      const { route } = command.data;
      // A query means the page's state is about to change — usually the same
      // page with new filters. The screen already published is then the
      // *old* view, and acking on it would have the model read the chart it
      // was asked to replace. So wait for a fresh publish, unless the URL is
      // already exactly this, in which case nothing will change and nothing
      // will be published.
      const fresh = route.includes("?") && currentUrl() !== route;
      ctx.navigate(route);
      const arrived = (await ctx.screenPublished?.(route, { fresh })) ?? true;
      return arrived
        ? { ok: true, result: { route } }
        : {
            ok: true,
            result: {
              route,
              note: "Navigation started, but the destination has not reported its context yet. Anything scoped to that screen may not be available for another moment.",
            },
          };
    }

    case "highlight": {
      const { componentKey, message } = command.data;
      return ctx.highlighter.highlight(componentKey, message ?? undefined)
        ? { ok: true }
        : { ok: false, error: notOnPage(componentKey) };
    }

    case "focus": {
      const { componentKey, message } = command.data;
      return ctx.highlighter.focus(componentKey, message ?? undefined)
        ? { ok: true }
        : { ok: false, error: notOnPage(componentKey) };
    }

    case "scroll_to": {
      const { componentKey } = command.data;
      return ctx.highlighter.scrollTo(componentKey)
        ? { ok: true }
        : { ok: false, error: notOnPage(componentKey) };
    }

    case "open_modal": {
      const { modalKey } = command.data;
      if (!ctx.openModal) {
        return {
          ok: false,
          error:
            "This app has not wired up modal opening, so that modal cannot be opened.",
        };
      }
      // An explicit `false` means the host app knows about modals but not this
      // one — usually because the dialog belongs to a screen the user has
      // left. Reported as a failure rather than swallowed: the model's
      // standing rule is never to claim something happened without a tool
      // result saying so, and "ok" to an unopened form is exactly that claim.
      // `undefined` stays a success, so an implementation returning nothing
      // behaves as it always did.
      if (ctx.openModal(modalKey) === false) {
        return {
          ok: false,
          error: `There is no \`${modalKey}\` dialog on this screen. It may belong to a different one.`,
        };
      }
      return { ok: true };
    }

    case "run_frontend_action": {
      const { actionName, input } = command.data;
      const action = ctx.store.getAction(actionName);
      if (!action) {
        // The runtime believes this action is registered but no handler
        // mounted — usually a component that owns it is not on this screen.
        return {
          ok: false,
          error: `No handler is currently mounted for "${actionName}".`,
        };
      }

      // A handler that waits on the user (a confirmation dialog, a password,
      // a file picker) outlives the runtime's wait, and the assistant then
      // reports as failed an action the user goes on to finish. Nothing else
      // tells the developer, so the console does.
      const started = Date.now();
      const slow = setTimeout(() => {
        console.warn(
          `[mihe] The "${actionName}" handler has run for ${ACTION_SLOW_MS / 1000}s. ` +
            `The runtime waits ${RUNTIME_ACK_WAIT_MS / 1000}s unless the action (timeoutSeconds) or the app sets longer, then tells the assistant it failed. ` +
            "If it is waiting for the user, open the UI they need and return at once (say what you opened); " +
            "they finish it there.",
        );
      }, ACTION_SLOW_MS);
      const late = () => {
        if (Date.now() - started > RUNTIME_ACK_WAIT_MS) {
          // The SDK doesn't know this action's limit (amendment 103), only the default.
          console.warn(
            `[mihe] The "${actionName}" handler finished after ${Math.round((Date.now() - started) / 1000)}s. ` +
              `If that was past its time limit (${RUNTIME_ACK_WAIT_MS / 1000}s unless the action sets timeoutSeconds or the app sets longer), ` +
              "the assistant was told it failed whatever the outcome. If it waits on the user, return before they act; if it is slow by nature, give it timeoutSeconds.",
          );
        }
      };

      try {
        const result = await action.handler(
          (input ?? {}) as Record<string, unknown>,
        );
        late();
        return { ok: true, result: result ?? { done: true } };
      } catch (cause) {
        late();
        // The host app's handler threw. Its message is the most useful thing
        // to hand back, so the assistant can tell the user what went wrong.
        return { ok: false, error: describeError(cause) };
      } finally {
        clearTimeout(slow);
      }
    }

    case "set_view": {
      const { controlKey, value } = command.data;
      const control = ctx.store.getControl(controlKey);
      if (!control) {
        return { ok: false, error: `"${controlKey}" is not on the page right now.` };
      }
      // Checked here as well as in the runtime, so the app's `onChange` is
      // only ever handed a value it declared, whatever sent the command.
      if (!control.options.some((option) => option.value === value)) {
        return { ok: false, error: `"${value}" is not one of "${controlKey}"'s options.` };
      }

      try {
        await control.onChange(value);
      } catch (cause) {
        return { ok: false, error: describeError(cause) };
      }

      const shown = (await ctx.viewPublished?.(controlKey, value)) ?? true;
      return shown
        ? { ok: true, result: { showing: value } }
        : {
            ok: false,
            error: `The app was asked to show "${value}", but "${controlKey}" still reports another tab.`,
          };
    }

    case "read_table": {
      const { tableKey, offset, limit } = command.data;
      const table = ctx.store.getTable(tableKey);
      if (!table) {
        return { ok: false, error: `"${tableKey}" is not on the page right now.` };
      }
      try {
        const rows = table.read(offset, limit);
        return {
          ok: true,
          result: {
            rows,
            offset,
            loaded: table.loadedRows,
            ...(table.total === undefined ? {} : { total: table.total }),
          },
        };
      } catch (cause) {
        return { ok: false, error: describeError(cause) };
      }
    }

    case "query_table": {
      const { tableKey, params, limit, show } = command.data;
      const table = ctx.store.getTable(tableKey);
      if (!table) {
        return { ok: false, error: `"${tableKey}" is not on the page right now.` };
      }
      if (!table.query) {
        return { ok: false, error: `"${tableKey}" cannot be searched.` };
      }
      // Checked here as well as in the runtime, so the app's `run` is only
      // ever handed parameters it declared, whatever sent the command.
      const invalid = checkQueryParams(table.query.params, params);
      if (invalid) return { ok: false, error: invalid };

      let found: { rows: TableRow[]; total?: number };
      try {
        found = await table.query.run(params);
      } catch (cause) {
        return { ok: false, error: describeError(cause) };
      }

      let shown = false;
      if (show && table.query.show) {
        try {
          await table.query.show(params);
          // Acked once the page has published again, for `navigate`'s
          // reason: the model's next step reads the screen.
          shown = (await ctx.screenPublished?.(currentPath() ?? "", { fresh: true })) ?? true;
        } catch (cause) {
          return { ok: false, error: describeError(cause) };
        }
      }

      return {
        ok: true,
        result: {
          rows: found.rows.slice(0, limit),
          ...(found.total === undefined ? {} : { total: found.total }),
          shown,
        },
      };
    }

    case "read_chart": {
      const { chartKey, series, limit } = command.data;
      const chart = ctx.store.getChart(chartKey);
      if (!chart) {
        return { ok: false, error: `"${chartKey}" is not on the page right now.` };
      }
      try {
        return { ok: true, result: { series: chart.read(series ?? undefined, limit) } };
      } catch (cause) {
        return { ok: false, error: describeError(cause) };
      }
    }

    case "clear_highlight": {
      ctx.highlighter.clear();
      return { ok: true };
    }

    default: {
      // An unknown command type means the runtime is ahead of this SDK.
      // Reporting it beats silently doing nothing.
      const unknown = command as { type: string };
      return {
        ok: false,
        error: `This app's SDK does not understand the "${unknown.type}" command. It may need updating.`,
      };
    }
  }
}

function notOnPage(componentKey: string): string {
  const registeredElsewhere = Boolean(findComponent(componentKey));
  return registeredElsewhere
    ? `"${componentKey}" is on the page but not visible.`
    : `"${componentKey}" is not on the page right now.`;
}

function describeError(cause: unknown): string {
  if (cause instanceof Error) return cause.message;
  if (typeof cause === "string") return cause;
  return "The action failed.";
}
