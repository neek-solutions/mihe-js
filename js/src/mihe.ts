/**
 * `Mihe` — the assistant without a framework (doc 08).
 *
 * The wiring between the store, the client and whatever UI draws it. It owns
 * three responsibilities and nothing else:
 *
 * 1. Publish the screen context whenever the app's declaration changes.
 * 2. Execute commands the runtime sends, and ack every one of them.
 * 3. Hold the conversation the UI renders.
 *
 * State is an immutable snapshot, replaced on every change, so React's
 * `useSyncExternalStore` reads it with no adapter: the React provider is a
 * thin wrapper over this class, and the two cannot disagree about what a
 * proposal or a voice event does.
 */

import type {
  KnowledgeSourceRef,
  ProposalStatus,
  ScreenContext,
  WidgetSettings,
} from "@mihe-dev/protocol";

import {
  AssistantClient,
  type ClientEvent,
  type ConnectionState,
  type ProposalPayload,
} from "./client";
import { executeCommand } from "./commands";
import { formatContextReport } from "./debug";
import {
  chartDeclaration,
  chartSignature,
  tableDeclaration,
  tableSignature,
  tabsDeclaration,
  tabsSignature,
  type AssistantChart,
  type AssistantTable,
  type AssistantTabs,
} from "./declarations";
import { COMPONENT_ATTRIBUTE, HighlightEngine } from "./highlight";
import {
  AssistantStore,
  type ActionHandler,
  type ComponentDeclaration,
  type ScreenDeclaration,
} from "./store";
import { VoiceSession, voiceUrl, type VoiceEvent, type VoiceState } from "./voice";

/** How long to coalesce screen changes before publishing. */
const SCREEN_DEBOUNCE_MS = 60;

/**
 * How long a navigate ack waits for the destination to publish. Comfortably
 * under the runtime's 10s command timeout, and long enough for a route that
 * loads data before registering itself.
 */
const SCREEN_ARRIVAL_TIMEOUT_MS = 2500;

export const SDK_VERSION = "0.1.0";

/**
 * DOM id of the assistant panel, so a custom trigger can point
 * `aria-controls` at it.
 */
export const ASSISTANT_PANEL_ID = "mihe-panel";

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  /** True while the assistant is still streaming into this message. */
  streaming?: boolean;
  /**
   * Documentation this answer drew on, if any.
   *
   * Worth surfacing rather than keeping for debugging: an answer a user can
   * trace to a named section of their own handbook is one they can check, and
   * "where did that come from?" is the first question anyone asks of an
   * assistant that suddenly knows their internal policy.
   */
  sources?: KnowledgeSourceRef[];
}

/**
 * The voice session, as the UI sees it.
 *
 * `available` is answered by the runtime rather than assumed: voice is a
 * per-app setting with a real price attached, so a microphone button that
 * appears and then fails on the first press is worse than no button. It stays
 * false until the runtime has actually issued a permit.
 */
export interface VoiceControls {
  available: boolean;
  state: VoiceState;
  /** True while the session is hands-free rather than push-to-talk. */
  handsFree: boolean;
  /** The line currently being spoken, either side. Empty between utterances. */
  caption: string;
  /**
   * Something about the session worth saying that is not a failure — the
   * ceiling approaching, or a session that has just reached it.
   *
   * Separate from `lastError` so a host app's own UI can draw the two
   * differently, which is the whole point: a session ending on time is the
   * ordinary case, and putting it in the same red box as a dead provider tells
   * the user their conversation broke when it did not.
   */
  notice: string | null;
  /**
   * Open the socket and the microphone. Must be called from a user gesture —
   * both the permission prompt and iOS Safari's audio unlock require one.
   *
   * `handsFree` leaves the microphone open and lets the provider decide where
   * utterances begin and end, so the user can interrupt mid-reply. The cost is
   * that the assistant can hear itself; see `VoiceSessionOptions`.
   */
  start: (options?: {
    handsFree?: boolean;
    /**
     * Open the conversation panel as the session starts, so what is said
     * appears there as the session goes. True by default. The orb passes false, because it
     * shows voice in itself and the point of it is that the page stays visible.
     */
    openPanel?: boolean;
  }) => void;
  stop: () => void;
  /**
   * Push-to-talk: press and release.
   *
   * `press({ hold: true })` captures without sending until `confirm()`, and
   * `discard()` drops it: for a control where a press may turn into a drag.
   * Releasing a held press confirms it.
   */
  press: (options?: { hold?: boolean }) => void;
  release: () => void;
  confirm: () => void;
  discard: () => void;
  /**
   * Follow how loud each side is, 0 to 1, as it happens. Returns the
   * unsubscribe. Outside the state snapshot on purpose: it fires tens of
   * times a second, and a listener should move an element directly, not
   * re-render.
   */
  onLevel: (listener: (source: "user" | "assistant", level: number) => void) => () => void;
}

/** Everything a UI draws, as one immutable snapshot. */
export interface MiheState {
  connection: ConnectionState;
  messages: ChatMessage[];
  /** Confirmation cards awaiting a decision. */
  proposals: ProposalPayload[];
  /** True from the moment a turn starts until it completes or fails. */
  busy: boolean;
  lastError: string | null;
  /**
   * Whether the assistant UI is showing.
   *
   * Held here rather than inside the widget so that anything in the host
   * app — a nav button, a command palette, a keyboard shortcut, a plain div —
   * can open the assistant.
   */
  isOpen: boolean;
  /**
   * What the assistant calls itself, from the app's settings in the dashboard.
   * `null` until the handshake answers; a title passed in code still wins.
   */
  assistantName: string | null;
  /**
   * The customer's launcher icon, uploaded in the dashboard (amendment 58).
   * `null` means draw the Mihe mark.
   */
  launcherIconUrl: string | null;
  /**
   * How the widget presents itself, from the app's settings in the dashboard
   * (amendment 61). `null` until the handshake answers.
   */
  widgetSettings: WidgetSettings | null;
  /** Realtime voice (doc 03). */
  voice: VoiceControls;
}

export interface MiheOptions {
  /** Runtime WebSocket URL. */
  url: string;
  /** The app's public key. Safe to ship in a browser bundle. */
  publicKey: string;
  /**
   * Fetches a signed user token from the host app's own backend.
   *
   * This is the app's authority, not the browser's: the runtime reads the
   * user's id and permissions from this token's verified claims and from
   * nothing else, so a user cannot grant themselves access by editing
   * anything on this side.
   */
  getUserToken: () => Promise<string>;
  /**
   * Route change handler. Wire this to your router — the default is a full
   * page load, which works but throws away app state.
   */
  navigate?: (route: string) => void;
  /**
   * Open a registered dialog. Return `false` when the key is not one this
   * app can open, so the assistant is told rather than reporting success for
   * a form that never appeared.
   */
  openModal?: (modalKey: string) => void | boolean;
  /**
   * Called when a confirmed action finishes, whatever the outcome.
   *
   * Exists because the assistant changes data the host app is already
   * displaying, and an app with a client-side cache has no way to know. The
   * usual implementation is one line — refetch what the page shows — and
   * without it a user watches an action succeed while the page goes on
   * showing what was true before it.
   */
  onActionComplete?: (action: {
    actionName: string;
    status: ProposalStatus;
    result?: unknown;
  }) => void;
  /**
   * Log what each screen costs to the console: how many tokens one answer
   * re-sends, and which tools make up most of it (amendment 67). Turn it on
   * while building an integration; leave it off in production.
   */
  debug?: boolean;
}

/**
 * How the approaching ceiling is put to the user.
 *
 * Phrased here rather than by the runtime because it is a countdown, and the
 * runtime sends a number. Rounded to five seconds: the figure is approximate
 * by the time it has crossed a socket and been rendered, and a notice reading
 * "27 seconds left" claims a precision nobody has.
 */
function endingSoonNotice(secondsRemaining: number): string {
  const rounded = Math.max(5, Math.round(secondsRemaining / 5) * 5);
  return `About ${rounded} seconds left of voice. The conversation carries on in text.`;
}

function messageId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * A declaration made through one of the `register…` methods. Calling the
 * method again with the same id updates this entry, so the undo from the
 * first call still removes it; an undo from before an unregister finds a
 * different entry and does nothing, so a late cleanup cannot remove what the
 * next page declared.
 */
interface Declared<T, D> {
  latest: T;
  signature: string;
  declaration: D;
}

/** Create the assistant and connect it. */
export function createMihe(options: MiheOptions): Mihe {
  const mihe = new Mihe(options);
  mihe.connect();
  return mihe;
}

export class Mihe {
  /** The app's declaration of itself. */
  readonly store = new AssistantStore();
  private readonly highlighter = new HighlightEngine();
  private options: MiheOptions;
  private state: MiheState;
  private readonly listeners = new Set<() => void>();

  private client: AssistantClient | null = null;
  private voiceSession: VoiceSession | null = null;
  /**
   * Set while the user is waiting on a permit they asked for.
   *
   * A token arriving with this false is one the runtime issued for a probe at
   * connect time, and starting a session on it would turn the microphone on
   * without anyone having asked.
   */
  private voiceRequested = false;
  /** The mode asked for, read when the permit comes back. */
  private requestedHandsFree = false;
  /** Whether the session being requested should open the panel. */
  private requestedOpenPanel = true;
  private readonly levelListeners = new Set<
    (source: "user" | "assistant", level: number) => void
  >();

  /** The route of the last screen context actually sent to the runtime. */
  private publishedRoute: string | null = null;
  /** The last screen context actually sent, for acks that check a view. */
  private publishedScreen: ScreenContext | null = null;
  /** Whether that screen had finished loading its data when it was sent. */
  private publishedSettled = false;
  /** Navigate and set_view acks waiting for the screen to report in. */
  private readonly screenWaiters = new Set<(screen: ScreenContext) => void>();
  private publishTimer: ReturnType<typeof setTimeout> | null = null;
  private unsubscribeStore: (() => void) | null = null;

  private readonly tabs = new Map<string, Declared<AssistantTabs, unknown>>();
  private readonly tables = new Map<string, Declared<AssistantTable<unknown>, unknown>>();
  private readonly charts = new Map<string, Declared<AssistantChart<unknown>, unknown>>();
  private readonly actions = new Map<string, Declared<ActionHandler["handler"], ActionHandler>>();
  private lastScreen: string | null = null;

  constructor(options: MiheOptions) {
    this.options = { ...options };
    this.state = {
      connection: "idle",
      messages: [],
      proposals: [],
      busy: false,
      lastError: null,
      isOpen: false,
      assistantName: null,
      launcherIconUrl: null,
      widgetSettings: null,
      voice: {
        available: false,
        state: "idle",
        handsFree: false,
        caption: "",
        notice: null,
        start: this.startVoiceRequest,
        stop: this.stopVoice,
        press: (options) => this.voiceSession?.beginUtterance(options),
        release: () => this.voiceSession?.endUtterance(),
        confirm: () => this.voiceSession?.confirmUtterance(),
        discard: () => this.voiceSession?.discardUtterance(),
        onLevel: (listener) => {
          this.levelListeners.add(listener);
          return () => {
            this.levelListeners.delete(listener);
          };
        },
      },
    };
  }

  // ---- state -------------------------------------------------------------

  /** The current state. The same object until something changes. */
  getState = (): MiheState => this.state;

  /** Called after every change of state. Returns the unsubscribe. */
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  /** Voice controls and state; the same as `getState().voice`. */
  get voice(): VoiceControls {
    return this.state.voice;
  }

  private setState(patch: Partial<MiheState>): void {
    this.state = { ...this.state, ...patch };
    // Copied, so a listener that unsubscribes while being called is safe.
    for (const listener of [...this.listeners]) listener();
  }

  private setVoice(patch: Partial<VoiceControls>): void {
    this.setState({ voice: { ...this.state.voice, ...patch } });
  }

  private setMessages(update: (messages: ChatMessage[]) => ChatMessage[]): void {
    this.setState({ messages: update(this.state.messages) });
  }

  // ---- lifecycle ---------------------------------------------------------

  /**
   * Replace options. Callbacks take effect at once; a new `url`, `publicKey`
   * or `debug` reconnects, since each belongs to the session.
   */
  update(options: Partial<MiheOptions>): void {
    const previous = this.options;
    this.options = { ...previous, ...options };
    const identityChanged =
      this.options.url !== previous.url ||
      this.options.publicKey !== previous.publicKey ||
      Boolean(this.options.debug) !== Boolean(previous.debug);
    if (identityChanged && this.client) {
      this.disconnect();
      this.connect();
    }
  }

  /** Open the session. Called by `createMihe`; does nothing if connected. */
  connect(): void {
    if (this.client) return;
    const client = new AssistantClient({
      url: this.options.url,
      publicKey: this.options.publicKey,
      getUserToken: () => this.options.getUserToken(),
      sdkVersion: SDK_VERSION,
      onEvent: this.handleEvent,
      debug: this.options.debug ?? false,
    });
    this.client = client;

    // Debounced, because a screen with twenty components fires twenty
    // registrations as it mounts and they should travel as one snapshot.
    this.unsubscribeStore = this.store.subscribe(() => {
      if (this.publishTimer !== null) clearTimeout(this.publishTimer);
      this.publishTimer = setTimeout(this.publish, SCREEN_DEBOUNCE_MS);
    });
    this.publish();

    void client.connect();
  }

  /**
   * Close the session, the voice session and any highlight. The
   * conversation and the declarations stay, for a later `connect()`.
   */
  disconnect(): void {
    if (this.publishTimer !== null) clearTimeout(this.publishTimer);
    this.publishTimer = null;
    this.unsubscribeStore?.();
    this.unsubscribeStore = null;
    this.client?.close();
    this.client = null;
    void this.voiceSession?.stop();
    this.voiceSession = null;
    this.highlighter.clear();
  }

  /** Disconnect and drop every listener. The instance is done after this. */
  destroy(): void {
    this.disconnect();
    this.listeners.clear();
    this.levelListeners.clear();
  }

  // ---- conversation ------------------------------------------------------

  send = (text: string): void => {
    const trimmed = text.trim();
    if (!trimmed) return;

    // Opening on send is what makes a "Help me add a product" button work as
    // one call: the reply has to be visible somewhere. Harmless for host apps
    // rendering their own always-visible panel.
    const id = messageId("msg");
    this.setState({
      isOpen: true,
      messages: [...this.state.messages, { id, role: "user", text: trimmed }],
      lastError: null,
    });
    this.client?.sendMessage(trimmed, id);
  };

  respondToProposal = (proposalId: string, confirmed: boolean): void => {
    this.client?.confirmAction(proposalId, confirmed);
    if (!confirmed) {
      this.setState({
        proposals: this.state.proposals.filter((p) => p.proposalId !== proposalId),
      });
    }
  };

  open = (): void => {
    if (!this.state.isOpen) this.setState({ isOpen: true });
  };

  close = (): void => {
    if (this.state.isOpen) this.setState({ isOpen: false });
  };

  toggle = (): void => {
    this.setState({ isOpen: !this.state.isOpen });
  };

  /**
   * A one-tap "ask this", for suggestion chips and help links:
   * `chip.onclick = mihe.prompt("How do I add a product?")`.
   */
  prompt(text: string): () => void {
    return () => this.send(text);
  }

  // ---- declarations ------------------------------------------------------

  /**
   * Declare the screen the user is on. Call it again when what the screen
   * shows changes; call the returned function when the user leaves it.
   *
   * `visibleData` is what makes answers concrete — "you have 7 low-stock
   * products" rather than "check your stock levels" — so include the summary
   * values already on screen, and only those.
   */
  setScreen(screen: ScreenDeclaration): () => void {
    const serialized = JSON.stringify(screen);
    // A render function that declares on every render would otherwise send
    // the same screen over the socket each time.
    if (serialized !== this.lastScreen || this.store.getScreenContext()?.screenId !== screen.screenId) {
      this.lastScreen = serialized;
      this.store.setScreen(JSON.parse(serialized) as ScreenDeclaration);
    }
    return () => {
      this.store.clearScreen(screen.screenId);
      if (this.store.getScreenContext() === null) this.lastScreen = null;
    };
  }

  /**
   * Declare a component the assistant can talk about or point at. Marks
   * `element` so it can be found; pass `null` for one that is described but
   * cannot be highlighted.
   */
  registerComponent(
    element: Element | null,
    componentKey: string,
    meta: ComponentDeclaration,
  ): () => void {
    element?.setAttribute(COMPONENT_ATTRIBUTE, componentKey);
    this.store.registerComponent(componentKey, { ...meta });
    return () => {
      this.store.unregisterComponent(componentKey);
      if (element?.getAttribute(COMPONENT_ATTRIBUTE) === componentKey) {
        element.removeAttribute(COMPONENT_ATTRIBUTE);
      }
    };
  }

  /**
   * Supply the code for an action the assistant may run in the browser.
   *
   * The action itself — its risk tier, permissions, and whether it needs
   * confirmation — is configured in the dashboard, not here. Whatever the
   * handler returns becomes the tool result the model sees, so return
   * something descriptive. Throwing reports the failure honestly.
   */
  registerAction(name: string, handler: ActionHandler["handler"]): () => void {
    const existing = this.actions.get(name);
    if (existing && this.store.getAction(name) === existing.declaration) {
      existing.latest = handler;
      return () => this.undoAction(name, existing);
    }
    const entry: Declared<ActionHandler["handler"], ActionHandler> = {
      latest: handler,
      signature: name,
      declaration: { name, handler: (input) => entry.latest(input) },
    };
    this.actions.set(name, entry);
    this.store.registerAction(entry.declaration);
    return () => this.undoAction(name, entry);
  }

  private undoAction(name: string, entry: Declared<ActionHandler["handler"], ActionHandler>) {
    if (this.actions.get(name) !== entry) return;
    this.actions.delete(name);
    if (this.store.getAction(name) === entry.declaration) this.store.unregisterAction(name);
  }

  /**
   * Let the assistant see which tab is open and switch to another. Pass the
   * tab that is really showing as `value`, and call this again when it
   * changes: a switch is not reported done until `value` matches.
   */
  registerTabs(tabs: AssistantTabs): () => void {
    return this.declare(
      this.tabs,
      tabs.id,
      tabs,
      tabsSignature(tabs),
      (latest) => tabsDeclaration(latest),
      (id) => this.store.getControl(id),
      (id, declaration) => this.store.registerControl(id, declaration),
      (id) => this.store.unregisterControl(id),
    );
  }

  /**
   * Let the assistant read a table. The rows are not sent with the screen;
   * the model reads them when a question needs them, and only the declared
   * columns ever leave the browser (amendment 67). Call it again when the
   * rows change.
   */
  registerTable<Row>(table: AssistantTable<Row>): () => void {
    return this.declare(
      this.tables,
      table.id,
      table as AssistantTable<unknown>,
      tableSignature(table),
      (latest) => tableDeclaration(latest),
      (id) => this.store.getTable(id),
      (id, declaration) => this.store.registerTable(id, declaration),
      (id) => this.store.unregisterTable(id),
    );
  }

  /**
   * Let the assistant explain a chart. Each series is summarised here, in
   * the browser; the points are read when an exact value is wanted. Call it
   * again when the data changes.
   */
  registerChart<Datum>(chart: AssistantChart<Datum>): () => void {
    return this.declare(
      this.charts,
      chart.id,
      chart as AssistantChart<unknown>,
      chartSignature(chart),
      (latest) => chartDeclaration(latest),
      (id) => this.store.getChart(id),
      (id, declaration) => this.store.registerChart(id, declaration),
      (id) => this.store.unregisterChart(id),
    );
  }

  /**
   * Add figures to the screen's `visibleData` under `key`: the stat cards
   * inside a tab, a summary panel. Dropped when the screen changes.
   */
  setValues(key: string, values: Record<string, unknown>): () => void {
    this.store.setValues(key, JSON.parse(JSON.stringify(values)) as Record<string, unknown>);
    return () => this.store.clearValues(key);
  }

  /**
   * One declaration kind's register-update-undo, shared so tabs, tables and
   * charts behave the same. The store's entry is re-registered only when the
   * signature changes, or when the store no longer holds it because the
   * screen changed underneath.
   */
  private declare<T, D>(
    entries: Map<string, Declared<T, unknown>>,
    id: string,
    value: T,
    signature: string,
    build: (latest: () => T) => D,
    current: (id: string) => D | undefined,
    register: (id: string, declaration: D) => void,
    unregister: (id: string) => void,
  ): () => void {
    let entry = entries.get(id) as Declared<T, D> | undefined;
    if (entry && current(id) === entry.declaration) {
      entry.latest = value;
      if (entry.signature !== signature) {
        const target = entry;
        entry.signature = signature;
        entry.declaration = build(() => target.latest);
        register(id, entry.declaration);
      }
    } else {
      const fresh = { latest: value, signature } as Declared<T, D>;
      fresh.declaration = build(() => fresh.latest);
      entries.set(id, fresh as Declared<T, unknown>);
      register(id, fresh.declaration);
      entry = fresh;
    }
    const mine = entry;
    return () => {
      if (entries.get(id) !== mine) return;
      entries.delete(id);
      if (current(id) === mine.declaration) unregister(id);
    };
  }

  /**
   * Make an element open and close the assistant, keyboard and screen
   * reader included: a `div` with only a click handler is invisible to both,
   * and that is the most common way a custom trigger ships broken.
   */
  bindTrigger(element: HTMLElement): () => void {
    const native = element instanceof HTMLButtonElement;
    const added: string[] = ["aria-expanded", "aria-controls", "aria-haspopup"];
    if (!native) {
      element.setAttribute("role", "button");
      added.push("role");
      if (!element.hasAttribute("tabindex")) {
        element.setAttribute("tabindex", "0");
        added.push("tabindex");
      }
    }
    element.setAttribute("aria-controls", ASSISTANT_PANEL_ID);
    element.setAttribute("aria-haspopup", "dialog");

    const sync = () => element.setAttribute("aria-expanded", String(this.state.isOpen));
    const onClick = () => this.toggle();
    // Space and Enter are what a native button responds to; a button
    // already turns them into a click.
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        this.toggle();
      }
    };

    sync();
    const unsubscribe = this.subscribe(sync);
    element.addEventListener("click", onClick);
    if (!native) element.addEventListener("keydown", onKeyDown);

    return () => {
      unsubscribe();
      element.removeEventListener("click", onClick);
      element.removeEventListener("keydown", onKeyDown);
      for (const attribute of added) element.removeAttribute(attribute);
    };
  }

  // ---- the runtime's events ---------------------------------------------

  private handleEvent = (event: ClientEvent): void => {
    switch (event.type) {
      case "state":
        this.setState({ connection: event.state });
        // Re-sent on every change of connection, so a reconnected session
        // learns the screen without waiting for the user to move.
        if (this.publishTimer !== null) clearTimeout(this.publishTimer);
        this.publishTimer = null;
        this.publish();
        break;

      case "turn_start":
        this.setState({
          busy: true,
          messages: [
            ...this.state.messages,
            { id: event.turnId, role: "assistant", text: "", streaming: true },
          ],
        });
        break;

      case "delta":
        this.setMessages((current) =>
          current.map((message) =>
            message.id === event.turnId
              ? { ...message, text: message.text + event.text }
              : message,
          ),
        );
        break;

      case "complete":
        this.setState({
          busy: false,
          messages: this.state.messages.map((message) =>
            message.id === event.turnId
              ? {
                  ...message,
                  text: event.message,
                  streaming: false,
                  sources: event.sources.length ? event.sources : undefined,
                }
              : message,
          ),
        });
        break;

      case "command": {
        const ctx = {
          store: this.store,
          highlighter: this.highlighter,
          navigate:
            this.options.navigate ??
            ((route: string) => {
              window.location.assign(route);
            }),
          screenPublished: this.awaitScreenPublished,
          viewPublished: this.awaitViewPublished,
          openModal: this.options.openModal,
        };
        const client = this.client;
        // Always acks, including on a thrown handler, because the runtime is
        // blocking a turn until it hears back.
        void executeCommand(event.command, ctx)
          .then((result) =>
            client?.ackCommand(event.commandId, result.ok, result.result, result.error),
          )
          .catch((cause: unknown) =>
            client?.ackCommand(
              event.commandId,
              false,
              undefined,
              cause instanceof Error ? cause.message : "The command failed.",
            ),
          );
        break;
      }

      case "proposal":
        this.setState({ proposals: [...this.state.proposals, event.proposal] });
        break;

      case "action_status": {
        if (event.status === "executing") break;

        // Retire the card and say what became of it. Without this the card
        // simply vanishes on approval and the assistant stays silent — which
        // reads as nothing having happened, for an action that may have just
        // notified a customer. The model does learn the outcome, but not
        // until its next turn, so it cannot be what tells the user.
        const settled = this.state.proposals.find((p) => p.proposalId === event.proposalId);

        if (settled) {
          // Keyed by the proposal, so a status arriving twice — a reconnect
          // replaying it, a double tap — settles to one line rather than two.
          const statusId = `status_${event.proposalId}`;
          if (event.status !== "rejected" && !this.state.messages.some((m) => m.id === statusId)) {
            // The label comes from the registry, like everything else on the
            // card, so this line cannot be steered by model output.
            const outcome =
              event.status === "executed"
                ? `${settled.label} — done.`
                : `${settled.label} — ${event.error ?? "that did not work."}`;
            this.setMessages((messages) => [
              ...messages,
              { id: statusId, role: "assistant", text: outcome },
            ]);
          }

          // Host apps cache — an action that changed data server-side leaves
          // the page showing what was true a moment ago.
          this.options.onActionComplete?.({
            actionName: settled.actionName,
            status: event.status,
            result: event.result,
          });
        }

        this.setState({
          proposals: this.state.proposals.filter((p) => p.proposalId !== event.proposalId),
          ...(event.error ? { lastError: event.error } : {}),
        });
        break;
      }

      case "voice_available":
        this.setVoice({ available: event.available });
        break;

      case "assistant_name":
        this.setState({ assistantName: event.name });
        break;

      case "launcher_icon":
        this.setState({ launcherIconUrl: event.url });
        break;

      case "widget_settings":
        this.setState({ widgetSettings: event.settings });
        break;

      case "context_report":
        console.info(formatContextReport(event.report));
        break;

      case "voice_token":
        // Only ever the answer to a session the user actually asked for. It
        // used to double as an availability probe, which meant minting a
        // single-use credential to answer a yes/no question.
        if (!this.voiceRequested) break;
        this.voiceRequested = false;
        void this.startVoice(event.token);
        break;

      case "error":
        // Voice refusals are not chat errors and must not be shown as one:
        // the chat socket is fine, and the honest reading is "voice is not
        // available here", which is a button that should disappear.
        if (event.code.startsWith("voice_")) {
          this.voiceRequested = false;
          this.setState({ busy: false, voice: { ...this.state.voice, available: false } });
          break;
        }
        this.setState({ busy: false, lastError: event.message });
        break;
    }
  };

  // ---- screen publishing -------------------------------------------------

  private publish = (): void => {
    this.publishTimer = null;
    const screen = this.store.getScreenContext();

    // A null screen is published, not skipped. The user has navigated to a
    // page the host app never declared, and the runtime has to be told —
    // otherwise it answers with the last screen it heard about. Nothing is
    // sent before the first screen ever registers, since there is no move to
    // report yet.
    if (!screen && this.publishedRoute === null) return;

    this.client?.updateScreen(screen);
    this.publishedRoute = screen?.route ?? null;
    this.publishedScreen = screen;
    // Published either way, so the runtime knows where the user is and scopes
    // actions to it. But a navigation is not acked against a screen whose
    // data is still loading: the model's next step would read its empty
    // counts as the answer.
    this.publishedSettled = !this.store.isScreenLoading();
    if (!screen || !this.publishedSettled) return;
    // Copied, because a waiter that matches removes itself from the set.
    for (const waiter of [...this.screenWaiters]) waiter(screen);
  };

  /**
   * A navigate command cannot be acked until the destination has published
   * its context, or the runtime's next step would still be reasoning about
   * the screen the user just left. See `CommandContext.screenPublished`.
   */
  private awaitScreenPublished = (route: string, options?: { fresh?: boolean }) =>
    new Promise<boolean>((resolve) => {
      // Pages publish their path, never the query, so arrival is matched on
      // the path.
      const path = route.split("?")[0];
      if (!options?.fresh && this.publishedRoute === path && this.publishedSettled) {
        return resolve(true);
      }
      const done = (arrived: boolean) => {
        this.screenWaiters.delete(waiter);
        clearTimeout(timer);
        resolve(arrived);
      };
      const waiter = (published: ScreenContext) => {
        if (published.route === path) done(true);
      };
      // Bounded, so a route the app never publishes stalls one turn rather
      // than hanging until the runtime's own ack timeout fires.
      const timer = setTimeout(() => done(false), SCREEN_ARRIVAL_TIMEOUT_MS);
      this.screenWaiters.add(waiter);
    });

  /**
   * A set_view ack waits the same way, for the tab the app was asked to show
   * to be the one the published screen reports. An app whose `onChange` did
   * nothing is reported as a failure rather than a switch that did not
   * happen.
   */
  private awaitViewPublished = (controlKey: string, value: string) =>
    new Promise<boolean>((resolve) => {
      const showing = (screen: ScreenContext | null) =>
        screen?.controls.some(
          (control) => control.controlKey === controlKey && control.value === value,
        ) ?? false;
      if (this.publishedSettled && showing(this.publishedScreen)) return resolve(true);

      const done = (shown: boolean) => {
        this.screenWaiters.delete(waiter);
        clearTimeout(timer);
        resolve(shown);
      };
      const waiter = (published: ScreenContext) => {
        if (showing(published)) done(true);
      };
      const timer = setTimeout(() => done(false), SCREEN_ARRIVAL_TIMEOUT_MS);
      this.screenWaiters.add(waiter);
    });

  // ---- voice -------------------------------------------------------------

  private startVoiceRequest = (options?: { handsFree?: boolean; openPanel?: boolean }) => {
    // A new session is not the place to still be reading why the last one
    // stopped.
    this.setVoice({ notice: null });
    // A fresh permit every time: they are single use and expire in a minute.
    this.requestedHandsFree = Boolean(options?.handsFree);
    this.requestedOpenPanel = options?.openPanel ?? true;
    this.voiceRequested = true;
    this.client?.requestVoiceToken();
  };

  private stopVoice = () => {
    this.voiceRequested = false;
    void this.voiceSession?.stop();
    this.voiceSession = null;
    // A countdown for a session the user has already closed is worse than no
    // notice: it is a wrong one.
    this.setVoice({ handsFree: false, notice: null });
  };

  private async startVoice(token: string): Promise<void> {
    const wanted = this.requestedHandsFree;
    this.setVoice({ handsFree: wanted });

    const session = new VoiceSession({
      url: voiceUrl(this.options.url, token, wanted),
      handsFree: wanted,
      onEvent: this.handleVoiceEvent,
      onLevel: (source, level) => {
        for (const listener of this.levelListeners) listener(source, level);
      },
    });
    this.voiceSession = session;
    // Opening the panel so what is said has somewhere to appear, for the
    // same reason `send` does, unless the caller shows voice itself.
    if (this.requestedOpenPanel) this.open();
    await session.start();
  }

  private handleVoiceEvent = (event: VoiceEvent): void => {
    switch (event.type) {
      case "state":
        this.setVoice({
          state: event.state,
          ...(event.state === "idle" || event.state === "error" ? { caption: "" } : {}),
        });
        break;

      case "transcript":
        // The caption is for words still being spoken. Once a line is final
        // it joins the transcript, so the caption is cleared rather than
        // showing the same sentence twice.
        if (event.final) {
          this.setState({
            voice: { ...this.state.voice, caption: "" },
            messages: [
              ...this.state.messages,
              { id: messageId("voice"), role: event.role, text: event.text },
            ],
          });
        } else {
          this.setVoice({ caption: event.text });
        }
        break;

      case "ending_soon":
        this.setVoice({ notice: endingSoonNotice(event.secondsRemaining) });
        break;

      case "ended":
        // The runtime's own words, which say the conversation survives. The
        // session tore itself down, so nothing else will clear the mode; left
        // set, the next push-to-talk session would open as hands-free.
        this.setVoice({ caption: "", notice: event.message, handsFree: false });
        break;

      case "error":
        this.setState({ lastError: event.message });
        break;
    }
  };
}
