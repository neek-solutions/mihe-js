import { describe, expect, it, vi } from "vitest";

import { fromPcm16, resample, toPcm16 } from "../src/audio";
import {
  VoiceSession,
  voiceUrl,
  type VoiceEvent,
  type VoiceSocketLike,
} from "../src/voice";

describe("pcm conversion", () => {
  it("round-trips samples within one quantisation step", () => {
    const original = Float32Array.from([0, 0.5, -0.5, 1, -1]);
    const back = fromPcm16(toPcm16(original));

    for (let i = 0; i < original.length; i += 1) {
      expect(back[i]).toBeCloseTo(original[i]!, 3);
    }
  });

  it("clamps rather than wrapping, so an over-range sample is not a loud click", () => {
    // Without the clamp, 1.5 × 0x7fff overflows the int16 range and setInt16
    // wraps it to a large negative number — heard as a crack, not as clipping.
    const view = new DataView(toPcm16(Float32Array.from([1.5, -1.5])));
    expect(view.getInt16(0, true)).toBe(0x7fff);
    expect(view.getInt16(2, true)).toBeLessThan(0);
    expect(view.getInt16(2, true)).toBeGreaterThanOrEqual(-0x7fff);
  });

  it("writes little endian, which is what the wire and the provider expect", () => {
    const view = new DataView(toPcm16(Float32Array.from([1])));
    expect(view.getInt16(0, true)).toBe(0x7fff);
    expect(view.getInt16(0, false)).not.toBe(0x7fff);
  });

  it("emits two bytes per sample", () => {
    expect(toPcm16(new Float32Array(120)).byteLength).toBe(240);
  });
});

describe("resampling", () => {
  it("is skipped entirely when the rates already agree", () => {
    // The common case: the browser honoured our 24 kHz request, so this must
    // not allocate or interpolate.
    const samples = Float32Array.from([0.1, 0.2, 0.3]);
    expect(resample(samples, 24000, 24000)).toBe(samples);
  });

  it("halves the sample count going from 48 kHz to 24 kHz", () => {
    const samples = new Float32Array(480).fill(0.25);
    const out = resample(samples, 48000, 24000);
    expect(out.length).toBe(240);
    expect(out[100]).toBeCloseTo(0.25, 5);
  });

  it("interpolates between neighbours rather than dropping samples", () => {
    const out = resample(Float32Array.from([0, 1, 0, 1]), 48000, 24000);
    expect(out.length).toBe(2);
    expect(out[0]).toBeCloseTo(0, 5);
    expect(out[1]).toBeCloseTo(0, 5);
  });
});

describe("voiceUrl", () => {
  it("derives the voice socket from the chat socket", () => {
    // One `url` prop for the whole SDK: a second would be one more thing to
    // get wrong in every integration, for no configurability anyone wants.
    expect(voiceUrl("wss://runtime.test/v1/ws", "vt_1")).toBe(
      "wss://runtime.test/v1/voice?token=vt_1",
    );
  });

  it("tolerates a trailing slash", () => {
    expect(voiceUrl("wss://runtime.test/v1/ws/", "vt_1")).toBe(
      "wss://runtime.test/v1/voice?token=vt_1",
    );
  });

  it("asks for hands-free in the query, so the runtime configures VAD", () => {
    // The mode has to be known before the upstream session is opened, which
    // happens as the socket is accepted — so it travels with the token rather
    // than as a frame afterwards.
    expect(voiceUrl("wss://runtime.test/v1/ws", "vt_1", true)).toBe(
      "wss://runtime.test/v1/voice?token=vt_1&handsFree=true",
    );
    expect(voiceUrl("wss://runtime.test/v1/ws", "vt_1")).not.toContain(
      "handsFree",
    );
  });

  it("escapes the token rather than pasting it in raw", () => {
    expect(voiceUrl("wss://runtime.test/v1/ws", "a b&c")).toContain(
      "token=a%20b%26c",
    );
  });
});

/** Deliver the runtime's `ready`, carrying the provider's utterance floor. */
function ready(socket: FakeSocket, minUtteranceMs = 150): void {
  socket.deliver({
    type: "ready",
    data: { voiceSessionId: "vs_1", minUtteranceMs },
  });
}

/**
 * Feed the session enough audio to count as speech.
 *
 * Bytes rather than elapsed time, because that is what the provider measures:
 * two bytes per sample at 24 kHz.
 */
function speak(session: VoiceSession, ms: number): void {
  const bytes = Math.round((ms / 1000) * 24000) * 2;
  (session as unknown as { sendAudio: (pcm: ArrayBuffer) => void }).sendAudio(
    new ArrayBuffer(bytes),
  );
}

/** A fake voice socket that records what the session sent. */
class FakeSocket implements VoiceSocketLike {
  binaryType = "";
  sent: (string | ArrayBuffer)[] = [];
  closed = false;
  onopen: ((event: unknown) => void) | null = null;
  onclose: ((event: unknown) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;

  send(data: string | ArrayBuffer): void {
    this.sent.push(data);
  }

  close(): void {
    this.closed = true;
  }

  /** Deliver a control frame from the runtime. */
  deliver(message: unknown): void {
    this.onmessage?.({ data: JSON.stringify(message) });
  }

  controlFrames(): unknown[] {
    return this.sent
      .filter((frame): frame is string => typeof frame === "string")
      .map((frame) => JSON.parse(frame));
  }
}

/**
 * A session with the audio devices stubbed out.
 *
 * jsdom has no `AudioContext` and no `getUserMedia`, and the parts worth
 * testing here are the state machine and the frames it emits — the audio graph
 * is exercised by using the demo, which is where every serious bug in this
 * codebase has been found.
 */
async function startedSession(): Promise<{
  session: VoiceSession;
  socket: FakeSocket;
  events: VoiceEvent[];
}> {
  const socket = new FakeSocket();
  const events: VoiceEvent[] = [];
  const session = new VoiceSession({
    url: "wss://runtime.test/v1/voice?token=vt_1",
    onEvent: (event) => events.push(event),
    socketFactory: () => socket,
  });

  const internals = session as unknown as {
    mic: { start: () => Promise<void>; unmute: () => void; mute: () => void; stop: () => Promise<void> };
    speaker: {
      enqueue: (pcm: ArrayBuffer) => void;
      start: () => Promise<void>;
      speaking: boolean;
      heardMs: () => number;
      flush: () => void;
      stop: () => Promise<void>;
    };
  };
  internals.mic = {
    start: vi.fn(async () => undefined),
    unmute: vi.fn(),
    mute: vi.fn(),
    stop: vi.fn(async () => undefined),
  };
  internals.speaker = {
    enqueue: vi.fn(),
    start: vi.fn(async () => undefined),
    speaking: false,
    heardMs: () => 0,
    flush: vi.fn(),
    stop: vi.fn(async () => undefined),
  };

  await session.start();
  return { session, socket, events };
}

describe("the voice session", () => {
  it("does not accept a press until the runtime says the session is ready", async () => {
    // Audio sent before `session.updated` lands in a provider session still on
    // its own defaults — the wrong sample rate, heard as noise rather than
    // reported as an error.
    const { session, socket } = await startedSession();
    expect(session.currentState).toBe("connecting");

    session.beginUtterance();
    expect(session.currentState).toBe("connecting");

    ready(socket);
    expect(session.currentState).toBe("listening");

    session.beginUtterance();
    expect(session.currentState).toBe("recording");
  });

  it("commits on release, which is what makes the model answer", async () => {
    // The provider's commit only closes the input buffer. Without the release
    // sending it at all, the button visibly does nothing.
    const { session, socket } = await startedSession();
    ready(socket);

    session.beginUtterance();
    speak(session, 400);
    session.endUtterance();

    expect(socket.controlFrames()).toContainEqual({ type: "commit" });
    expect(session.currentState).toBe("thinking");
  });

  it("discards a press too short to be speech rather than committing it", async () => {
    // The bug this pins, found by using it: a tap sent a commit carrying 85 ms
    // of audio, the provider answered "buffer too small", and — because every
    // provider error was fatal — the call ended. Two failures in one press.
    const { session, socket, events } = await startedSession();
    ready(socket, 150);

    session.beginUtterance();
    speak(session, 80);
    session.endUtterance();

    expect(socket.controlFrames()).not.toContainEqual({ type: "commit" });
    expect(session.currentState).toBe("listening");
    expect(events).toContainEqual({
      type: "error",
      code: "utterance_too_short",
      message: "Hold the button while you speak.",
      recoverable: true,
      fallbackToChat: false,
    });
  });

  it("takes the utterance floor from the runtime rather than assuming one", async () => {
    // The floor belongs to whichever provider the runtime is talking to. An
    // SDK that baked in one provider's number is wrong the day a second lands.
    const { session, socket } = await startedSession();
    ready(socket, 40);

    session.beginUtterance();
    speak(session, 80);
    session.endUtterance();

    expect(socket.controlFrames()).toContainEqual({ type: "commit" });
  });

  it("survives a recoverable provider error instead of hanging up", async () => {
    const { session, socket, events } = await startedSession();
    ready(socket);

    socket.deliver({
      type: "error",
      data: {
        code: "voice_provider_error",
        message: "Error committing input audio buffer: buffer too small.",
        recoverable: true,
        fallbackToChat: false,
      },
    });

    expect(socket.closed).toBe(false);
    expect(session.currentState).not.toBe("error");
    expect(events.some((event) => event.type === "error")).toBe(true);
  });

  it("reports how much was heard when the user interrupts", async () => {
    // The provider streams seconds ahead of the speaker, so without this the
    // model believes it said a whole sentence the user cut off three words in,
    // and answers follow-ups about words nobody heard.
    const { session, socket } = await startedSession();
    ready(socket);
    socket.deliver({ type: "status", data: { state: "speaking" } });

    const speaker = (session as unknown as {
      speaker: { speaking: boolean; heardMs: () => number; flush: () => void };
    }).speaker;
    speaker.speaking = true;
    speaker.heardMs = () => 1500;

    session.beginUtterance();

    expect(socket.controlFrames()).toContainEqual({
      type: "playback",
      data: { ms: 1500 },
    });
    expect(speaker.flush).toHaveBeenCalled();
  });

  it("lets a finished reply play out rather than flushing it", async () => {
    // The bug this pins: `response.done` means the provider stopped
    // *generating*, while the browser still holds seconds of unplayed audio.
    // The relay sent a listening status alongside it, the client flushed on
    // that status, and the tail of every single reply was discarded — heard as
    // answers breaking off mid-sentence.
    const { session, socket } = await startedSession();
    ready(socket);
    socket.deliver({ type: "status", data: { state: "speaking" } });

    const speaker = (session as unknown as {
      speaker: { speaking: boolean; flush: () => void };
    }).speaker;
    speaker.speaking = true;

    socket.deliver({ type: "speech_done" });

    expect(speaker.flush).not.toHaveBeenCalled();
    expect(session.currentState).toBe("listening");
  });

  it("flushes queued audio when the user interrupts", async () => {
    // The other half: a listening status now means exactly one thing, which is
    // what makes discarding the queue the right response to it.
    const { session, socket } = await startedSession();
    ready(socket);
    socket.deliver({ type: "status", data: { state: "speaking" } });

    const speaker = (session as unknown as {
      speaker: { speaking: boolean; flush: () => void };
    }).speaker;
    speaker.speaking = true;

    socket.deliver({ type: "status", data: { state: "listening" } });

    expect(speaker.flush).toHaveBeenCalled();
  });

  it("keeps the button's own state while it is held down", async () => {
    // The client knows about a press before the server does. Letting a status
    // frame overwrite `recording` makes the button flicker mid-sentence.
    const { session, socket } = await startedSession();
    ready(socket);
    session.beginUtterance();

    socket.deliver({ type: "status", data: { state: "listening" } });
    expect(session.currentState).toBe("recording");
  });

  it("surfaces a runtime refusal and ends the session", async () => {
    const { socket, events } = await startedSession();
    socket.deliver({
      type: "error",
      data: {
        code: "voice_disconnected",
        message: "The voice service disconnected.",
        recoverable: false,
        fallbackToChat: true,
      },
    });

    expect(events).toContainEqual({
      type: "error",
      code: "voice_disconnected",
      message: "The voice service disconnected.",
      recoverable: false,
      fallbackToChat: true,
    });
    expect(socket.closed).toBe(true);
  });

  it("treats a session that ran its course as finished, not failed", async () => {
    // The bug this pins: the duration ceiling arrived as a fatal `error`, so
    // the most ordinary end a voice session has left the microphone button in
    // its failed state and the message in a red box — telling the user their
    // conversation had broken when the chat socket was untouched and the whole
    // transcript was already in it.
    const { session, socket, events } = await startedSession();
    socket.deliver({
      type: "ended",
      data: {
        reason: "session_limit",
        message: "That is as long as one voice session runs.",
      },
    });

    expect(events).toContainEqual({
      type: "ended",
      reason: "session_limit",
      message: "That is as long as one voice session runs.",
    });
    expect(events).not.toContainEqual(
      expect.objectContaining({ type: "state", state: "error" }),
    );
    // Teardown closes the audio devices before settling, so the resting state
    // arrives a tick later than the frame does.
    await vi.waitFor(() => expect(session.currentState).toBe("idle"));
    expect(socket.closed).toBe(true);
  });

  it("does not open the microphone before the provider is ready", async () => {
    // The bug this pins, and it only ever bit once per session, which is what
    // made it look like a ghost. Hands-free unmuted in `start`, so capture ran
    // from before the socket existed until `ready` — and every frame after the
    // socket opened was sent, queuing behind a relay still in `wait_for_ready`.
    // It arrived in one burst when the loop began reading, the provider's VAD
    // read the burst as an utterance, and the session answered something
    // nobody had said.
    const socket = new FakeSocket();
    const events: VoiceEvent[] = [];
    const session = new VoiceSession({
      url: "wss://runtime.test/v1/voice?token=vt_1&handsFree=true",
      handsFree: true,
      onEvent: (event) => events.push(event),
      socketFactory: () => socket,
    });

    const unmute = vi.fn();
    const internals = session as unknown as {
      mic: Record<string, unknown>;
      speaker: Record<string, unknown>;
    };
    internals.mic = {
      start: vi.fn(async () => undefined),
      unmute,
      mute: vi.fn(),
      stop: vi.fn(async () => undefined),
    };
    internals.speaker = {
      start: vi.fn(async () => undefined),
      speaking: false,
      heardMs: () => 0,
      flush: vi.fn(),
      stop: vi.fn(async () => undefined),
    };

    await session.start();
    expect(unmute, "the room is not the user talking").not.toHaveBeenCalled();

    socket.deliver({ type: "ready", data: { voiceSessionId: "vs_1", minUtteranceMs: 120 } });
    expect(unmute, "open it once the provider has accepted its config").toHaveBeenCalledTimes(1);
  });

  it("leaves the microphone shut in push-to-talk until the button is held", async () => {
    const { session, socket } = await startedSession();
    socket.deliver({ type: "ready", data: { voiceSessionId: "vs_1" } });

    const internals = session as unknown as { mic: { unmute: ReturnType<typeof vi.fn> } };
    expect(internals.mic.unmute).not.toHaveBeenCalled();
  });

  it("passes the ceiling warning through without ending anything", async () => {
    // The warning exists so the user can finish their sentence. Acting on it
    // would defeat it.
    const { session, socket, events } = await startedSession();
    socket.deliver({ type: "ready", data: { voiceSessionId: "vs_1" } });
    socket.deliver({ type: "ending_soon", data: { secondsRemaining: 30 } });

    expect(events).toContainEqual({ type: "ending_soon", secondsRemaining: 30 });
    expect(session.currentState).toBe("listening");
    expect(socket.closed).toBe(false);
  });

  it("marks a settled line final, so the caption can stop showing it", async () => {
    // The bug this pins, seen in a real integration: the caption was set from every
    // transcript including the final one and only cleared when the session
    // ended, so a finished sentence stayed on screen as a caption while also
    // appearing in the transcript. The user read it twice, in two styles, and
    // the second looked like something they had said.
    const { socket, events } = await startedSession();
    socket.deliver({
      type: "transcript",
      data: { role: "assistant", text: "Taking you", final: false },
    });
    socket.deliver({
      type: "transcript",
      data: { role: "assistant", text: "Taking you to orders.", final: true },
    });

    const finals = events.filter(
      (event) => event.type === "transcript" && event.final,
    );
    expect(finals).toHaveLength(1);
  });

  it("joins streamed deltas into the line so far, so the caption reads as a sentence", async () => {
    // The runtime forwards the provider's deltas, a few characters each. Passed
    // through raw, the caption showed only the newest fragment, which read as
    // gibberish over the orb. A new line must also start empty, not carry on
    // from the last one.
    const { socket, events } = await startedSession();
    for (const text of ["Taking", " you", " to orders."]) {
      socket.deliver({ type: "transcript", data: { role: "assistant", text, final: false } });
    }
    socket.deliver({
      type: "transcript",
      data: { role: "assistant", text: "Taking you to orders.", final: true },
    });
    socket.deliver({ type: "transcript", data: { role: "assistant", text: "Done", final: false } });

    const streaming = events
      .filter((event) => event.type === "transcript" && !event.final)
      .map((event) => (event as { text: string }).text);
    expect(streaming).toEqual(["Taking", "Taking you", "Taking you to orders.", "Done"]);
  });

  it("passes both sides' transcripts through, streaming and settled", async () => {
    // Transcripts are the audit trail, not only captions — a voice session
    // nobody can review afterwards is not one a compliance-minded customer
    // can adopt.
    const { socket, events } = await startedSession();
    socket.deliver({
      type: "transcript",
      data: { role: "user", text: "add a product", final: true },
    });
    socket.deliver({
      type: "transcript",
      data: { role: "assistant", text: "Taking you", final: false },
    });

    const transcripts = events.filter((event) => event.type === "transcript");
    expect(transcripts).toEqual([
      { type: "transcript", role: "user", text: "add a product", final: true },
      { type: "transcript", role: "assistant", text: "Taking you", final: false },
    ]);
  });

  it("does not send audio while the button is up", async () => {
    // Otherwise the microphone is live between utterances, which is both a
    // privacy problem and a bill.
    const { session, socket } = await startedSession();
    ready(socket);

    const sendAudio = (session as unknown as {
      sendAudio: (pcm: ArrayBuffer) => void;
    }).sendAudio.bind(session);

    sendAudio(new ArrayBuffer(8));
    expect(socket.sent.filter((f) => f instanceof ArrayBuffer)).toHaveLength(0);

    session.beginUtterance();
    sendAudio(new ArrayBuffer(8));
    expect(socket.sent.filter((f) => f instanceof ArrayBuffer)).toHaveLength(1);
  });
});

describe("a held press, for a control that may be dragged", () => {
  /** Audio frames the session actually put on the wire. */
  const audioSent = (socket: FakeSocket) =>
    socket.sent.filter((frame): frame is ArrayBuffer => frame instanceof ArrayBuffer);

  it("sends nothing until confirmed, then sends what it held, in order", async () => {
    // The first word is captured from the moment the finger goes down, so it
    // must survive the wait to learn whether this is speech or a drag.
    const { session, socket } = await startedSession();
    ready(socket);

    session.beginUtterance({ hold: true });
    speak(session, 100);
    speak(session, 60);
    expect(audioSent(socket)).toHaveLength(0);
    expect(session.currentState).toBe("recording");

    session.confirmUtterance();
    expect(audioSent(socket).map((frame) => frame.byteLength)).toEqual([4800, 2880]);

    speak(session, 300);
    session.endUtterance();
    expect(socket.controlFrames()).toContainEqual({ type: "commit" });
  });

  it("sends nothing at all when discarded, and is ready for the next press", async () => {
    // The voice socket has no way to take back audio, so a drag must never
    // have put any on it.
    const { session, socket } = await startedSession();
    ready(socket);

    session.beginUtterance({ hold: true });
    speak(session, 400);
    session.discardUtterance();

    expect(audioSent(socket)).toHaveLength(0);
    expect(socket.controlFrames()).not.toContainEqual({ type: "commit" });
    expect(session.currentState).toBe("listening");

    session.beginUtterance();
    expect(session.currentState).toBe("recording");
  });

  it("treats a release before anyone decided as speech", async () => {
    // A press that never moved and was let go inside the hold window is a
    // short utterance, not nothing.
    const { session, socket } = await startedSession();
    ready(socket);

    session.beginUtterance({ hold: true });
    speak(session, 400);
    session.endUtterance();

    expect(audioSent(socket)).toHaveLength(1);
    expect(socket.controlFrames()).toContainEqual({ type: "commit" });
  });

  it("does not cut the assistant off until the press is known to be speech", async () => {
    const { session, socket } = await startedSession();
    ready(socket);
    const speaker = (session as unknown as { speaker: { speaking: boolean; flush: () => void } })
      .speaker;
    speaker.speaking = true;
    socket.deliver({ type: "status", data: { state: "speaking" } });

    session.beginUtterance({ hold: true });
    expect(speaker.flush).not.toHaveBeenCalled();

    session.confirmUtterance();
    expect(speaker.flush).toHaveBeenCalled();
  });
});

describe("after a reply, push-to-talk takes the next press", () => {
  // The bug these pin, found in a real integration: the runtime never sends a
  // `speaking` status, so a session went to `thinking` on release and stayed
  // there. `speech_done` only moved `speaking` on, and every press after the
  // first answer was refused until the user stopped and started again.

  it("after a spoken reply", async () => {
    const { session, socket } = await startedSession();
    ready(socket);

    session.beginUtterance();
    speak(session, 400);
    session.endUtterance();
    expect(session.currentState).toBe("thinking");

    socket.onmessage?.({ data: new ArrayBuffer(960) });
    expect(session.currentState).toBe("speaking");

    socket.deliver({ type: "speech_done" });
    expect(session.currentState).toBe("listening");

    session.beginUtterance();
    expect(session.currentState).toBe("recording");
  });

  it("after a reply that said nothing", async () => {
    // A tool call and no words: no audio ever arrives, and the session must
    // not wait for some.
    const { session, socket } = await startedSession();
    ready(socket);

    session.beginUtterance();
    speak(session, 400);
    session.endUtterance();
    socket.deliver({ type: "speech_done" });
    expect(session.currentState).toBe("listening");

    session.beginUtterance();
    expect(session.currentState).toBe("recording");
  });
});
