/**
 * The WebSocket client (doc 02).
 *
 * One persistent socket per session carries chat, commands, and
 * confirmations. Two properties drive the design:
 *
 * - A frontend action is a tool call that round-trips through the browser, so
 *   the runtime pushes a command and blocks until this client acks it. Every
 *   command MUST be answered, including on failure — an unanswered command
 *   stalls the assistant's turn until the runtime's timeout fires.
 * - Confirming an action needs server-to-client push, which is why this is a
 *   socket rather than a request per message.
 *
 * The client owns transport only. It never decides what a command means; the
 * provider does that and hands back a result.
 */

import type { ContextReport } from "./debug";
import {
  PROTOCOL_VERSION,
  type AssistantCommand,
  type ClientMessage,
  type KnowledgeSourceRef,
  type ProposalStatus,
  type ScreenContext,
  type ServerMessage,
  type WidgetSettings,
} from "@mihe-dev/protocol";

export type ConnectionState =
  | "idle"
  | "connecting"
  | "open"
  | "reconnecting"
  | "closed";

/** What the provider needs to react to. */
export type ClientEvent =
  | { type: "state"; state: ConnectionState }
  /**
   * Answered on every handshake, so it cannot drift out of step with the
   * connection the way a one-shot probe could.
   */
  | { type: "voice_available"; available: boolean }
  /**
   * What the assistant calls itself, from the app's settings.
   *
   * Re-sent on every handshake for the same reason `voice_available` is: a
   * rename takes effect on the next session rather than on the next deploy of
   * the host app.
   */
  | { type: "assistant_name"; name: string }
  /**
   * The customer's launcher icon from the app's settings, or `null` for the
   * Mihe mark. Emitted on every handshake, absent or not: unlike the name,
   * removing an icon has to take effect, and an absent field is how the
   * runtime says "the default".
   */
  | { type: "launcher_icon"; url: string | null }
  /**
   * How the widget presents itself, from the app's settings (amendment 61).
   * `null` from a runtime too old to send any, which leaves the SDK's own
   * defaults and the host's props in charge.
   */
  | { type: "widget_settings"; settings: WidgetSettings | null }
  | { type: "turn_start"; turnId: string }
  | { type: "delta"; turnId: string; text: string }
  | {
      type: "complete";
      turnId: string;
      message: string;
      /** Documentation the answer drew on. Empty when none was used. */
      sources: KnowledgeSourceRef[];
    }
  | { type: "command"; commandId: string; command: AssistantCommand }
  | { type: "proposal"; proposal: ProposalPayload }
  | {
      type: "action_status";
      proposalId: string;
      status: ProposalStatus;
      result?: unknown;
      error?: string;
    }
  | { type: "error"; code: string; message: string; recoverable: boolean }
  /**
   * A single-use permit for the voice socket, in reply to
   * `requestVoiceToken`. Short-lived by design — see doc 03.
   */
  | { type: "voice_token"; token: string; expiresAt: string }
  /** What one answer on this screen re-sends, when `debug` is on. */
  | { type: "context_report"; report: ContextReport };

/**
 * A confirmation card's contents.
 *
 * Every human-readable field here comes from the runtime's registry, never
 * from model output — that is the prompt-injection firebreak, and it is why
 * the widget renders exclusively from this payload and never from the
 * assistant's prose.
 */
export interface ProposalPayload {
  proposalId: string;
  actionName: string;
  label: string;
  description: string;
  risk: "low" | "medium" | "high";
  input: Record<string, unknown>;
  inputSchema: unknown;
  expiresAt: string;
  uiConfirmationRequired: boolean;
}

export interface ClientOptions {
  /** Runtime WebSocket URL, e.g. `wss://runtime.example.com/v1/ws`. */
  url: string;
  publicKey: string;
  /**
   * Fetches a user token from the host app's own backend, which mints it
   * signed with the app secret.
   *
   * Called on every connect and reconnect rather than once, so a token that
   * expired while the tab was backgrounded is replaced rather than replayed.
   */
  getUserToken: () => Promise<string>;
  sdkVersion: string;
  onEvent: (event: ClientEvent) => void;
  /**
   * Ask the runtime what each screen costs, reported after every screen
   * update (amendment 67). For building the integration, not for production.
   */
  debug?: boolean;
  /** Injectable for tests. */
  socketFactory?: (url: string) => WebSocketLike;
  /** Injectable for tests; defaults to exponential backoff with jitter. */
  reconnectDelay?: (attempt: number) => number;
}

/** The slice of `WebSocket` this client uses, so tests can supply a fake. */
export interface WebSocketLike {
  send(data: string): void;
  close(): void;
  onopen: ((event: unknown) => void) | null;
  onclose: ((event: unknown) => void) | null;
  onerror: ((event: unknown) => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
}

const MAX_RECONNECT_DELAY_MS = 30_000;

export class AssistantClient {
  private socket: WebSocketLike | null = null;
  private state: ConnectionState = "idle";
  private attempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  /** Set when the caller closed deliberately, so we do not reconnect. */
  private stopped = false;
  private conversationId: string | null = null;
  /** Re-sent after every reconnect, so the runtime is never blind to context. */
  private lastScreen: ScreenContext | null = null;

  constructor(private readonly options: ClientOptions) {}

  get connectionState(): ConnectionState {
    return this.state;
  }

  async connect(): Promise<void> {
    if (this.state === "connecting" || this.state === "open") return;
    this.stopped = false;
    await this.open();
  }

  close(): void {
    this.stopped = true;
    this.clearTimers();
    this.socket?.close();
    this.socket = null;
    this.setState("closed");
  }

  /** Send a user message. Silently dropped when offline — the widget shows the state. */
  sendMessage(text: string, clientMsgId: string): void {
    this.send({ type: "message", data: { text, clientMsgId } });
  }

  /**
   * Publish the current screen. Idempotent: a full snapshot that replaces
   * whatever the runtime held.
   */
  /**
   * Tell the runtime where the user is, or that they are somewhere it does not
   * know about.
   *
   * `null` matters as much as a screen. The host app registers the screens it
   * chooses to; every other page is one the runtime must be told it cannot
   * see. Left unsaid, the runtime keeps the last screen it heard about, and
   * the assistant names a page the user left — which is worse than admitting
   * it does not know, and quietly keeps that screen's scoped actions callable.
   */
  updateScreen(screen: ScreenContext | null): void {
    this.lastScreen = screen;
    this.send({ type: "screen_update", data: { screen } });
  }

  /**
   * Answer a command. Must be called for every command received, including
   * failures — the runtime is blocking a turn on this.
   */
  ackCommand(
    commandId: string,
    ok: boolean,
    result?: unknown,
    error?: string,
  ): void {
    this.send({
      type: "command_result",
      data: {
        commandId,
        ok,
        result: (result ?? null) as never,
        error: error ?? null,
      },
    });
  }

  confirmAction(
    proposalId: string,
    confirmed: boolean,
    editedInput?: Record<string, unknown>,
  ): void {
    this.send({
      type: "action_confirm",
      data: {
        proposalId,
        confirmed,
        editedInput: (editedInput ?? null) as never,
      },
    });
  }

  cancelTurn(turnId: string): void {
    this.send({ type: "cancel", data: { turnId } });
  }

  /**
   * Ask for a permit to open the voice socket.
   *
   * Requested on the chat socket rather than fetched over HTTP because this
   * session is what the permit is scoped to: the runtime hands back a token
   * bound to the very session actor holding this connection, so the voice
   * socket joins the conversation already in progress instead of starting a
   * second one beside it.
   *
   * Answered by a `voice_token` event, or by an `error` when voice is not
   * available for this app — which is the signal to hide the microphone
   * rather than offer one that fails on the first press.
   */
  requestVoiceToken(): void {
    this.send({ type: "voice_token_request" });
  }

  // ------------------------------------------------------------- internals

  private async open(): Promise<void> {
    this.setState(this.attempt === 0 ? "connecting" : "reconnecting");

    let token: string;
    try {
      token = await this.options.getUserToken();
    } catch (cause) {
      if (this.stopped) return;
      // The host app's token endpoint is down. Retrying is right — this is
      // usually transient — but the user should be told why it is quiet.
      this.emit({
        type: "error",
        code: "user_token_unavailable",
        message: "Could not get a session token from the app.",
        recoverable: true,
      });
      this.scheduleReconnect();
      return;
    }

    // Closed while the token was on its way. Opening anyway left a socket
    // nothing would ever close: a second live session, which React's
    // StrictMode made on every development mount by connecting, closing and
    // connecting again.
    if (this.stopped) return;

    const factory =
      this.options.socketFactory ??
      ((url: string) => new WebSocket(url) as unknown as WebSocketLike);

    const socket = factory(this.options.url);
    this.socket = socket;

    socket.onopen = () => {
      const auth: ClientMessage = {
        type: "auth",
        data: {
          publicKey: this.options.publicKey,
          userToken: token,
          sdkVersion: this.options.sdkVersion,
          protocolVersion: PROTOCOL_VERSION,
          conversationId: this.conversationId,
          ...(this.options.debug ? { debug: true } : {}),
        },
      };
      socket.send(JSON.stringify(auth));
    };

    socket.onmessage = (event) => {
      if (typeof event.data !== "string") return;
      let message: ServerMessage;
      try {
        message = JSON.parse(event.data) as ServerMessage;
      } catch {
        return;
      }
      this.handle(message);
    };

    socket.onclose = () => {
      this.clearTimers();
      if (this.stopped) {
        this.setState("closed");
        return;
      }
      this.scheduleReconnect();
    };

    socket.onerror = () => {
      // `onclose` always follows, and that is where reconnect is handled.
    };
  }

  private handle(message: ServerMessage): void {
    switch (message.type) {
      case "auth_ok": {
        this.attempt = 0;
        this.conversationId = message.data.conversationId;
        this.emit({
          type: "voice_available",
          available: message.data.voiceAvailable ?? false,
        });
        // Only when the runtime actually sent one. An older runtime omits the
        // field, and overwriting a good name with "" would rename the panel to
        // nothing — worse than leaving the SDK's own default in place.
        if (message.data.assistantName) {
          this.emit({ type: "assistant_name", name: message.data.assistantName });
        }
        this.emit({
          type: "launcher_icon",
          url: message.data.launcherIconUrl ?? null,
        });
        this.emit({ type: "widget_settings", settings: message.data.widget ?? null });
        this.setState("open");
        this.startHeartbeat(message.data.heartbeatIntervalMs);
        // The runtime replays nothing, so re-publish context immediately.
        if (this.lastScreen) this.updateScreen(this.lastScreen);
        break;
      }

      case "auth_error": {
        this.emit({
          type: "error",
          code: message.data.code,
          message: message.data.message,
          // A bad key or an unsupported protocol version will not fix itself.
          recoverable: false,
        });
        this.stopped = true;
        break;
      }

      case "auth_expired": {
        // Re-authenticate in place rather than tearing down the socket.
        void this.options
          .getUserToken()
          .then((token) =>
            this.send({
              type: "auth",
              data: {
                publicKey: this.options.publicKey,
                userToken: token,
                sdkVersion: this.options.sdkVersion,
                protocolVersion: PROTOCOL_VERSION,
                conversationId: this.conversationId,
                ...(this.options.debug ? { debug: true } : {}),
              },
            }),
          )
          .catch(() => this.socket?.close());
        break;
      }

      case "turn_start":
        this.emit({ type: "turn_start", turnId: message.data.turnId });
        break;

      case "delta":
        this.emit({
          type: "delta",
          turnId: message.data.turnId,
          text: message.data.text,
        });
        break;

      case "complete":
        this.emit({
          type: "complete",
          turnId: message.data.turnId,
          message: message.data.message,
          sources: message.data.sources ?? [],
        });
        break;

      case "command":
        this.emit({
          type: "command",
          commandId: message.data.commandId,
          command: message.data.command,
        });
        break;

      case "action_proposal":
        this.emit({
          type: "proposal",
          proposal: message.data as unknown as ProposalPayload,
        });
        break;

      case "action_status":
        this.emit({
          type: "action_status",
          proposalId: message.data.proposalId,
          status: message.data.status,
          result: message.data.result ?? undefined,
          error: message.data.error ?? undefined,
        });
        break;

      case "error":
        this.emit({
          type: "error",
          code: message.data.code,
          message: message.data.message,
          recoverable: message.data.recoverable,
        });
        break;

      case "voice_token":
        this.emit({
          type: "voice_token",
          token: message.data.token,
          expiresAt: message.data.expiresAt,
        });
        break;

      case "context_report":
        this.emit({ type: "context_report", report: message.data });
        break;

      case "pong":
        break;
    }
  }

  private send(message: ClientMessage): void {
    if (this.state !== "open" && message.type !== "auth") return;
    try {
      this.socket?.send(JSON.stringify(message));
    } catch {
      // A send on a closing socket throws; `onclose` handles recovery.
    }
  }

  private scheduleReconnect(): void {
    this.setState("reconnecting");
    const delay =
      this.options.reconnectDelay?.(this.attempt) ?? backoff(this.attempt);
    this.attempt += 1;
    this.reconnectTimer = setTimeout(() => void this.open(), delay);
  }

  private startHeartbeat(intervalMs: number): void {
    this.clearHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      this.send({ type: "ping" });
    }, intervalMs);
  }

  private clearHeartbeat(): void {
    if (this.heartbeatTimer !== null) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private clearTimers(): void {
    this.clearHeartbeat();
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private setState(state: ConnectionState): void {
    if (this.state === state) return;
    this.state = state;
    this.emit({ type: "state", state });
  }

  private emit(event: ClientEvent): void {
    this.options.onEvent(event);
  }
}

/**
 * Exponential backoff with jitter, capped.
 *
 * Jitter matters more than it looks: without it, every tab of every customer
 * reconnects in lockstep after a runtime restart and stampedes it.
 */
function backoff(attempt: number): number {
  const base = Math.min(1000 * 2 ** attempt, MAX_RECONNECT_DELAY_MS);
  return base / 2 + Math.random() * (base / 2);
}
