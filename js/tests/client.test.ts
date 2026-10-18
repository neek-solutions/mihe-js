import { beforeEach, describe, expect, it } from "vitest";

import { AssistantClient, type ClientEvent, type WebSocketLike } from "../src/client";

/** A WebSocket stand-in that records what was sent and lets tests push frames. */
class FakeSocket implements WebSocketLike {
  static instances: FakeSocket[] = [];

  sent: unknown[] = [];
  closed = false;

  onopen: ((event: unknown) => void) | null = null;
  onclose: ((event: unknown) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;

  constructor(readonly url: string) {
    FakeSocket.instances.push(this);
  }

  send(data: string): void {
    this.sent.push(JSON.parse(data));
  }

  close(): void {
    this.closed = true;
    this.onclose?.({});
  }

  /** Simulate the runtime pushing a frame. */
  receive(frame: unknown): void {
    this.onmessage?.({ data: JSON.stringify(frame) });
  }

  sentOfType(type: string): Array<Record<string, unknown>> {
    return (this.sent as Array<{ type: string }>).filter((m) => m.type === type) as never;
  }
}

interface Harness {
  client: AssistantClient;
  events: ClientEvent[];
  socket: () => FakeSocket;
}

async function connect(
  options: { token?: () => Promise<string> } = {},
): Promise<Harness> {
  const events: ClientEvent[] = [];
  const client = new AssistantClient({
    url: "ws://runtime.test/v1/ws",
    publicKey: "pk_test_0123456789abcdef",
    getUserToken: options.token ?? (() => Promise.resolve("jwt-token")),
    sdkVersion: "0.1.0",
    onEvent: (event) => events.push(event),
    socketFactory: (url) => new FakeSocket(url),
    reconnectDelay: () => 1,
  });

  await client.connect();
  return {
    client,
    events,
    socket: () => FakeSocket.instances[FakeSocket.instances.length - 1]!,
  };
}

/** Complete the handshake so the client reaches `open`. */
function authenticate(
  socket: FakeSocket,
  voiceAvailable = false,
  assistantName?: string,
): void {
  socket.onopen?.({});
  socket.receive({
    type: "auth_ok",
    data: {
      sessionId: "sess_1",
      conversationId: "conv_1",
      heartbeatIntervalMs: 30000,
      registryStatus: "unknown",
      voiceAvailable,
      ...(assistantName === undefined ? {} : { assistantName }),
    },
  });
}

/** Turn traffic only, with the handshake's own events filtered out. */
function turnEvents(events: ClientEvent[]): ClientEvent[] {
  return events.filter(
    (event) =>
      event.type !== "state" &&
      event.type !== "voice_available" &&
      event.type !== "launcher_icon" &&
      event.type !== "widget_settings",
  );
}

beforeEach(() => {
  FakeSocket.instances = [];
});

describe("handshake", () => {
  it("sends auth as the very first frame", async () => {
    const h = await connect();
    h.socket().onopen?.({});

    expect(h.socket().sent[0]).toMatchObject({
      type: "auth",
      data: {
        publicKey: "pk_test_0123456789abcdef",
        userToken: "jwt-token",
        protocolVersion: 1,
      },
    });
  });

  it("reports open once the runtime accepts it", async () => {
    const h = await connect();
    authenticate(h.socket());

    expect(h.client.connectionState).toBe("open");
    expect(h.events).toContainEqual({ type: "state", state: "open" });
  });

  it("stops trying after an unrecoverable auth failure", async () => {
    // A bad key or an unsupported protocol version will not fix itself, so
    // reconnecting would just hammer the runtime.
    const h = await connect();
    h.socket().onopen?.({});
    h.socket().receive({
      type: "auth_error",
      data: { code: "unknown_app", message: "No app matches that API key." },
    });

    expect(h.events).toContainEqual({
      type: "error",
      code: "unknown_app",
      message: "No app matches that API key.",
      recoverable: false,
    });

    h.socket().onclose?.({});
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(FakeSocket.instances).toHaveLength(1);
  });

  it("re-authenticates in place when the token expires", async () => {
    // Tearing down the socket would lose any in-flight turn for no reason.
    const h = await connect();
    authenticate(h.socket());

    h.socket().receive({ type: "auth_expired" });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(h.socket().sentOfType("auth")).toHaveLength(2);
    expect(h.socket().closed).toBe(false);
  });

  it("retries rather than failing when the app's token endpoint is down", async () => {
    const h = await connect({
      token: () => Promise.reject(new Error("502 from /assistant/token")),
    });

    expect(h.events).toContainEqual({
      type: "error",
      code: "user_token_unavailable",
      message: "Could not get a session token from the app.",
      recoverable: true,
    });
  });
});

describe("session traffic", () => {
  it("queues nothing before the handshake completes", async () => {
    // Sending on an unauthenticated socket would be dropped by the runtime.
    const h = await connect();
    h.socket().onopen?.({});

    h.client.sendMessage("hello", "m1");
    expect(h.socket().sentOfType("message")).toHaveLength(0);

    h.socket().receive({
      type: "auth_ok",
      data: {
        sessionId: "s",
        conversationId: "c",
        heartbeatIntervalMs: 30000,
        registryStatus: "unknown",
      },
    });
    h.client.sendMessage("hello", "m1");
    expect(h.socket().sentOfType("message")).toHaveLength(1);
  });

  it("streams a turn as start, deltas, then complete", async () => {
    const h = await connect();
    authenticate(h.socket());

    h.socket().receive({ type: "turn_start", data: { turnId: "t1" } });
    h.socket().receive({ type: "delta", data: { turnId: "t1", text: "You have " } });
    h.socket().receive({ type: "delta", data: { turnId: "t1", text: "7 items." } });
    h.socket().receive({
      type: "complete",
      data: { turnId: "t1", message: "You have 7 items.", sources: [] },
    });

    expect(turnEvents(h.events)).toEqual([
      { type: "turn_start", turnId: "t1" },
      { type: "delta", turnId: "t1", text: "You have " },
      { type: "delta", turnId: "t1", text: "7 items." },
      { type: "complete", turnId: "t1", message: "You have 7 items.", sources: [] },
    ]);
  });

  it("learns whether voice is available from the handshake", async () => {
    // The bug this pins: availability used to be discovered by requesting a
    // throwaway permit from a React effect that fired once, on the connection
    // opening. When that answer was lost while the socket stayed open — a Fast
    // Refresh in dev, any state reset in principle — nothing ever asked again
    // and the microphone button was gone for good. Arriving with `auth_ok`
    // means every reconnect re-answers it and there is no separate thing to
    // fall out of step.
    const h = await connect();
    authenticate(h.socket(), true);

    expect(h.events).toContainEqual({ type: "voice_available", available: true });
  });

  it("learns what the assistant is called from the handshake", async () => {
    // The app's settings are the one place the name is set, so the panel
    // header and the model's own introduction cannot drift apart — and
    // renaming it is a setting rather than a redeploy of the host app.
    const h = await connect();
    authenticate(h.socket(), false, "Kit");

    expect(h.events).toContainEqual({ type: "assistant_name", name: "Kit" });
  });

  it("says nothing about the name when the runtime does not", async () => {
    // An older runtime omits the field. Emitting "" would rename the panel to
    // nothing, which is worse than leaving the SDK's own default in place.
    const h = await connect();
    authenticate(h.socket());

    expect(
      h.events.some((event) => event.type === "assistant_name"),
    ).toBe(false);
  });

  it("treats an older runtime that says nothing as voice-less", async () => {
    // Absent means no, not unknown: offering a microphone that cannot work is
    // worse than not offering one.
    const h = await connect();
    h.socket().onopen?.({});
    h.socket().receive({
      type: "auth_ok",
      data: {
        sessionId: "sess_1",
        conversationId: "conv_1",
        heartbeatIntervalMs: 30000,
        registryStatus: "unknown",
      },
    });

    expect(h.events).toContainEqual({ type: "voice_available", available: false });
  });

  it("carries the documentation an answer drew on", async () => {
    // Without this the citation exists on the wire and nowhere else, and a
    // user has no way to tell a retrieved answer from a confident guess.
    const h = await connect();
    authenticate(h.socket());

    h.socket().receive({ type: "turn_start", data: { turnId: "t1" } });
    h.socket().receive({
      type: "complete",
      data: {
        turnId: "t1",
        message: "Ness Valley Dairy, cut-off 20:00 the night before.",
        sources: [
          { sourceId: "src_1", title: "Store handbook", snippet: "Chilled comes from…" },
        ],
      },
    });

    const complete = h.events.find((event) => event.type === "complete");
    expect(complete).toMatchObject({
      sources: [{ sourceId: "src_1", title: "Store handbook" }],
    });
  });

  it("surfaces commands with their correlation id", async () => {
    const h = await connect();
    authenticate(h.socket());

    h.socket().receive({
      type: "command",
      data: {
        commandId: "cmd_1",
        turnId: "t1",
        command: { type: "navigate", data: { route: "/orders" } },
      },
    });

    expect(h.events).toContainEqual({
      type: "command",
      commandId: "cmd_1",
      command: { type: "navigate", data: { route: "/orders" } },
    });
  });

  it("acks a command with its result", async () => {
    const h = await connect();
    authenticate(h.socket());

    h.client.ackCommand("cmd_1", true, { shown: 7 });

    expect(h.socket().sentOfType("command_result")[0]).toMatchObject({
      data: { commandId: "cmd_1", ok: true, result: { shown: 7 } },
    });
  });

  it("acks failures too", async () => {
    // An unanswered command stalls the turn until the runtime times out.
    const h = await connect();
    authenticate(h.socket());

    h.client.ackCommand("cmd_1", false, undefined, "not on the page");

    expect(h.socket().sentOfType("command_result")[0]).toMatchObject({
      data: { ok: false, error: "not on the page" },
    });
  });

  it("passes proposals through untouched", async () => {
    const proposal = {
      proposalId: "prop_1",
      actionName: "mark_order_completed",
      label: "Mark order completed",
      description: "This is irreversible.",
      risk: "high",
      input: { orderId: "ord_42" },
      inputSchema: {},
      expiresAt: "2026-01-01T00:00:00Z",
      uiConfirmationRequired: true,
    };

    const h = await connect();
    authenticate(h.socket());
    h.socket().receive({ type: "action_proposal", data: { turnId: "t1", ...proposal } });

    expect(h.events).toContainEqual({ type: "proposal", proposal: expect.objectContaining(proposal) });
  });

  it("sends a confirmation decision", async () => {
    const h = await connect();
    authenticate(h.socket());

    h.client.confirmAction("prop_1", true);

    expect(h.socket().sentOfType("action_confirm")[0]).toMatchObject({
      data: { proposalId: "prop_1", confirmed: true },
    });
  });

  it("ignores frames that are not valid JSON", async () => {
    const h = await connect();
    authenticate(h.socket());
    const before = h.events.length;

    h.socket().onmessage?.({ data: "{ not json" });

    expect(h.events).toHaveLength(before);
  });
});

describe("reconnection", () => {
  it("reconnects after an unexpected close", async () => {
    const h = await connect();
    authenticate(h.socket());

    h.socket().onclose?.({});
    expect(h.client.connectionState).toBe("reconnecting");

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(FakeSocket.instances.length).toBeGreaterThan(1);
  });

  it("republishes the screen after reconnecting", async () => {
    // The runtime replays nothing, so a reconnected session would otherwise
    // be blind to where the user is.
    const h = await connect();
    authenticate(h.socket());

    h.client.updateScreen({
      screenId: "inventory.products",
      route: "/inventory/products",
      title: "Products",
      description: "",
      keywords: [],
      visibleData: {},
      components: [],
      controls: [],
      tables: [],
      charts: [],
    });

    h.socket().onclose?.({});
    await new Promise((resolve) => setTimeout(resolve, 20));
    authenticate(h.socket());

    expect(h.socket().sentOfType("screen_update")).toHaveLength(1);
  });

  it("does not reconnect after a deliberate close", async () => {
    const h = await connect();
    authenticate(h.socket());

    h.client.close();
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(FakeSocket.instances).toHaveLength(1);
    expect(h.client.connectionState).toBe("closed");
  });

  it("resumes the same conversation across a reconnect", async () => {
    const h = await connect();
    authenticate(h.socket());

    h.socket().onclose?.({});
    await new Promise((resolve) => setTimeout(resolve, 20));
    h.socket().onopen?.({});

    expect(h.socket().sent[0]).toMatchObject({
      data: { conversationId: "conv_1" },
    });
  });
});

describe("leaving a registered screen", () => {
  it("tells the runtime the screen is gone rather than going quiet", async () => {
    // The bug this pins: a page the host app never declared published nothing,
    // so the runtime kept the last screen it had been told about and the
    // assistant named a page the user had left. "I do not know" is the only
    // honest frame, and it is what drops the screen-scoped actions too.
    const { socket, client } = await connect();
    authenticate(socket());

    client.updateScreen(null);

    const frames = socket().sent.filter(
      (frame) => (frame as { type: string }).type === "screen_update",
    );
    expect(frames.at(-1)).toEqual({
      type: "screen_update",
      data: { screen: null },
    });
  });
});

describe("closed while the token is on its way", () => {
  beforeEach(() => {
    FakeSocket.instances = [];
  });

  it("opens no socket, so no second session is left behind", async () => {
    // React's StrictMode connects, closes and connects again on every
    // development mount. The first connect was still waiting for its token
    // when it was closed, then opened its socket anyway, and nothing ever
    // closed that one.
    let release!: (token: string) => void;
    const token = new Promise<string>((resolve) => {
      release = resolve;
    });
    const client = new AssistantClient({
      url: "ws://runtime.test/v1/ws",
      publicKey: "pk_test_0123456789abcdef",
      getUserToken: () => token,
      sdkVersion: "0.1.0",
      onEvent: () => {},
      socketFactory: (url) => new FakeSocket(url),
      reconnectDelay: () => 1,
    });

    const connecting = client.connect();
    client.close();
    release("jwt-token");
    await connecting;

    expect(FakeSocket.instances).toHaveLength(0);
  });
});
