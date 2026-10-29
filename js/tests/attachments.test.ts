/**
 * Attachments (amendment 102): the app describes a picture, and only its
 * words reach the runtime. No describer, no paperclip.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { acceptsFile, createMihe, MAX_ATTACHMENTS, type Mihe, type MiheOptions } from "../src/index";

class LiveSocket {
  static last: LiveSocket | null = null;
  onopen: ((e: unknown) => void) | null = null;
  onclose: ((e: unknown) => void) | null = null;
  onerror: ((e: unknown) => void) | null = null;
  onmessage: ((e: { data: unknown }) => void) | null = null;
  sent: { type: string; data: Record<string, unknown> }[] = [];
  constructor() { LiveSocket.last = this; }
  send(data: string) { this.sent.push(JSON.parse(data)); }
  close() {}
  open() {
    this.onopen?.({});
    this.onmessage?.({ data: JSON.stringify({ type: "auth_ok", data: { sessionId: "s", conversationId: "c", heartbeatIntervalMs: 30000, registryStatus: "unknown", voiceAvailable: false } }) });
  }
  messages() { return this.sent.filter((f) => f.type === "message").map((f) => f.data.text as string); }
}

const base: MiheOptions = { url: "ws://runtime.test/v1/ws", publicKey: "pk_test_0123456789abcdef", getUserToken: () => Promise.resolve("jwt") };
const png = (name = "shot.png") => new File([new Uint8Array([1, 2, 3])], name, { type: "image/png" });
let mihe: Mihe | null = null;

async function connected(extra: Partial<MiheOptions> = {}) {
  mihe = createMihe({ ...base, ...extra });
  await vi.waitFor(() => expect(LiveSocket.last).not.toBeNull());
  LiveSocket.last!.open();
  return { mihe, socket: LiveSocket.last! };
}

beforeEach(() => {
  LiveSocket.last = null;
  vi.stubGlobal("WebSocket", class { constructor() { return new LiveSocket() as never; } });
  vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: () => "blob:preview", revokeObjectURL: vi.fn() }));
});
afterEach(() => { mihe?.destroy(); mihe = null; vi.unstubAllGlobals(); });

describe("attachments", () => {
  it("are off unless the app describes them, so a picture never goes anywhere unhandled", async () => {
    const { mihe } = await connected();
    expect(mihe.getState().attachAccept).toBeNull();
    mihe.attach(png());
    expect(mihe.getState().attachments).toEqual([]);
  });

  it("send the app's words with the message, never the picture, and show the picture to the person", async () => {
    const describeAttachment = vi.fn(async (f: File) => `a calm two-column hero (${f.name})`);
    const { mihe, socket } = await connected({ describeAttachment });
    expect(mihe.getState().attachAccept).toBe("image/*");
    mihe.attach(png());
    expect(mihe.getState().attachments[0]).toMatchObject({ name: "shot.png", status: "reading", previewUrl: "blob:preview" });
    await vi.waitFor(() => expect(mihe.getState().attachments[0]!.status).toBe("ready"));
    mihe.send("Make my hero like this");
    expect(socket.messages()).toEqual(['Make my hero like this\n\n[Attached picture "shot.png", as the app describes it: a calm two-column hero (shot.png)]']);
    expect(mihe.getState().messages.at(-1)).toMatchObject({ role: "user", text: "Make my hero like this", attachments: [{ name: "shot.png", previewUrl: "blob:preview" }] });
    expect(mihe.getState().attachments).toEqual([]);
  });

  it("wait for a picture still being read, and can go on their own", async () => {
    let finish: ((t: string) => void) | undefined;
    const { mihe, socket } = await connected({ describeAttachment: () => new Promise((r) => { finish = r; }) });
    mihe.attach(png());
    mihe.send("");
    expect(socket.messages()).toEqual([]);
    await vi.waitFor(() => expect(finish).toBeDefined());
    finish!("a mood board in sand and blue");
    await vi.waitFor(() => expect(mihe.getState().attachments[0]!.status).toBe("ready"));
    mihe.send("");
    expect(socket.messages()[0]).toMatch(/^\(See the attached picture\.\)\n\n\[Attached picture "shot.png"/);
  });

  it("say why one couldn't be read, and leave it out of the message", async () => {
    const { mihe, socket } = await connected({ describeAttachment: async () => { throw new Error("That picture is too big (over 10 MB)."); } });
    mihe.attach(png());
    await vi.waitFor(() => expect(mihe.getState().attachments[0]).toMatchObject({ status: "failed", error: "That picture is too big (over 10 MB)." }));
    mihe.send("hello");
    expect(socket.messages()).toEqual(["hello"]);
  });

  it("refuse kinds the app doesn't take, and more than a handful at once", async () => {
    const { mihe } = await connected({ describeAttachment: async () => "x" });
    mihe.attach(new File(["x"], "notes.pdf", { type: "application/pdf" }));
    expect(mihe.getState().attachments).toEqual([]);
    expect(mihe.getState().lastError).toMatch(/isn't a kind of file/);
    for (let i = 0; i <= MAX_ATTACHMENTS; i++) mihe.attach(png(`p${i}.png`));
    expect(mihe.getState().attachments).toHaveLength(MAX_ATTACHMENTS);
    mihe.removeAttachment(mihe.getState().attachments[0]!.id);
    expect(mihe.getState().attachments).toHaveLength(MAX_ATTACHMENTS - 1);
  });

  it("go as soon as they're read during a voice call, where nobody presses Send", async () => {
    const { mihe, socket } = await connected({ describeAttachment: async () => "a terracotta mood board" });
    // As if a call were open: the voice state is the core's to set; this stands in for the session.
    (mihe as unknown as { setState(p: object): void }).setState({ voice: { ...mihe.getState().voice, state: "listening" } });
    mihe.attach(png());
    await vi.waitFor(() => expect(socket.messages()).toHaveLength(1));
    expect(socket.messages()[0]).toMatch(/^\(See the attached picture\.\)\n\n\[Attached picture "shot.png", as the app describes it: a terracotta mood board\]$/);
    expect(mihe.getState().attachments).toEqual([]);
  });

  it("match accept lists by type and extension", () => {
    expect(acceptsFile("image/*", { name: "a.webp", type: "image/webp" })).toBe(true);
    expect(acceptsFile("image/png,.pdf", { name: "A.PDF", type: "" })).toBe(true);
    expect(acceptsFile("image/png", { name: "a.jpg", type: "image/jpeg" })).toBe(false);
  });
});
