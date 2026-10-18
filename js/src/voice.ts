/**
 * The voice session (doc 03, phase 5a).
 *
 * A second, short-lived WebSocket carrying audio only. Commands and
 * confirmation cards keep arriving on the chat socket, which is the whole
 * design: voice is an input modality, not a second command channel, so a
 * confirmation card is the same card whether the user typed or spoke and there
 * is exactly one place that draws it.
 *
 * Push-to-talk, deliberately, before hands-free. It has no VAD edge cases, it
 * works on a phone the day it ships, and the button press doubles as the user
 * gesture iOS Safari requires before any audio can start. Hands-free is 5b.
 */

import {
  VOICE_SAMPLE_RATE,
  type VoiceClientMessage,
  type VoiceEndReason,
  type VoiceServerMessage,
} from "@mihe-dev/protocol";

import { MicrophoneCapture, SpeakerQueue, pcmLevel } from "./audio";

export type VoiceState =
  | "idle"
  | "connecting"
  /** Connected, microphone closed, waiting for the user to press. */
  | "listening"
  /** The button is held down and audio is going up. */
  | "recording"
  /** The utterance is committed and the model has not answered yet. */
  | "thinking"
  | "speaking"
  | "error";

export type VoiceEvent =
  | { type: "state"; state: VoiceState }
  | {
      type: "transcript";
      role: "user" | "assistant";
      text: string;
      final: boolean;
    }
  | {
      type: "error";
      code: string;
      message: string;
      /** True when the session survived and the user can simply try again. */
      recoverable: boolean;
      fallbackToChat: boolean;
    }
  /** The duration ceiling is near. The session is still running. */
  | { type: "ending_soon"; secondsRemaining: number }
  /**
   * The session finished the way it was meant to — the minutes ran out, or
   * nobody spoke. Deliberately not an `error`: the chat socket is untouched and
   * the transcript is already in the conversation, so the user has lost
   * nothing and should not be told they have.
   */
  | { type: "ended"; reason: VoiceEndReason; message: string };

export interface VoiceSessionOptions {
  /** Voice socket URL, already carrying the single-use token. */
  url: string;
  /**
   * Hands-free: the microphone stays open, the provider decides when an
   * utterance ends, and the user can talk over the assistant.
   *
   * The trade is echo. Under push-to-talk the microphone is shut except while
   * the button is held, so the assistant physically cannot hear itself; here
   * it can, and browser echo cancellation is the only thing between the two.
   * On a laptop that is usually enough. On a phone with the speaker beside the
   * microphone it may not be, and the failure is the assistant answering its
   * own last sentence.
   */
  handsFree?: boolean;
  onEvent: (event: VoiceEvent) => void;
  /**
   * How loud each side is, 0 to 1, as it happens: the user's voice as it is
   * captured, the assistant's as it plays. Deliberately not a `VoiceEvent`:
   * it fires tens of times a second, and whatever listens should move a ring
   * rather than re-render a component tree.
   */
  onLevel?: (source: "user" | "assistant", level: number) => void;
  /** Injectable for tests. */
  socketFactory?: (url: string) => VoiceSocketLike;
}

/** The slice of `WebSocket` a voice session uses. */
export interface VoiceSocketLike {
  binaryType: string;
  send(data: string | ArrayBuffer): void;
  close(): void;
  onopen: ((event: unknown) => void) | null;
  onclose: ((event: unknown) => void) | null;
  onerror: ((event: unknown) => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
}

export class VoiceSession {
  private socket: VoiceSocketLike | null = null;
  private state: VoiceState = "idle";
  private mic: MicrophoneCapture;
  private speaker: SpeakerQueue;
  /**
   * Audio captured since a held press began, not yet sent.
   *
   * A press on a draggable orb is ambiguous for its first moment: it may be
   * the start of speech or the start of a drag. Holding the frames here means
   * neither answer costs anything. Confirmed, they go up in order and the first
   * word survives. Discarded, they never leave the browser, because the voice
   * socket has no way to take back audio it has been sent.
   */
  private held: ArrayBuffer[] | null = null;
  private stopped = false;
  /**
   * Milliseconds of audio captured since the last commit.
   *
   * Counted rather than timed from the button press, because those differ:
   * the microphone graph delivers in render quanta, so a press held for
   * exactly the floor produces slightly less audio than the clock suggests.
   * The provider measures the buffer, so we measure the buffer too.
   */
  private utteranceMs = 0;
  /** The assistant's line so far, joined from streamed transcript deltas. */
  private assistantLine = "";
  /** Reports playback position while speaking, for barge-in truncation. */
  private playbackTimer: ReturnType<typeof setInterval> | null = null;
  /**
   * The provider's shortest acceptable utterance, learned at `ready`.
   *
   * Defaults high enough to be safe before the runtime has told us, since
   * guessing low means the first press of a session is the one that fails.
   */
  private minUtteranceMs = 150;

  constructor(private readonly options: VoiceSessionOptions) {
    this.speaker = new SpeakerQueue((level) => options.onLevel?.("assistant", level));
    this.mic = new MicrophoneCapture((pcm) => this.sendAudio(pcm));
  }

  get currentState(): VoiceState {
    return this.state;
  }

  /**
   * Open the socket and the audio devices.
   *
   * Must be called from a user gesture. Both the microphone permission prompt
   * and iOS Safari's audio unlock require one, and a session started from an
   * effect will connect happily and then be silent in both directions with no
   * error anywhere.
   */
  async start(): Promise<void> {
    if (this.socket) return;
    this.stopped = false;
    this.setState("connecting");

    try {
      // Devices before the socket: a user who declines the microphone prompt
      // should not have consumed their single-use voice token, because the
      // next attempt would then fail for a second, unrelated reason.
      await this.mic.start();
      await this.speaker.start();
    } catch (cause) {
      this.emit({
        type: "error",
        code: "microphone_unavailable",
        message:
          cause instanceof Error && cause.name === "NotAllowedError"
            ? "Microphone access was declined, so voice cannot start."
            : "No microphone is available.",
        // No microphone means no voice at all, so this one really is the end.
        recoverable: false,
        fallbackToChat: true,
      });
      this.setState("error");
      return;
    }

    const factory =
      this.options.socketFactory ??
      ((url: string) => new WebSocket(url) as unknown as VoiceSocketLike);

    const socket = factory(this.options.url);
    socket.binaryType = "arraybuffer";
    this.socket = socket;

    socket.onmessage = (event) => {
      if (typeof event.data === "string") {
        this.handleControl(event.data);
      } else if (event.data instanceof ArrayBuffer) {
        this.speaker.enqueue(event.data);
        // The runtime never says `speaking`; the first audio of a reply is how
        // the client knows. Without this a push-to-talk session sat in
        // `thinking` after its first answer, `speech_done` only moves
        // `speaking` on, and every later press was refused.
        if (this.state === "thinking") this.setState("speaking");
      }
    };

    socket.onclose = () => {
      // No reconnect, unlike the chat socket. A voice token is single use and
      // a provider session is not resumable, so reconnecting would mean a new
      // session with none of this one's context — better to end cleanly and
      // let the user press the button again.
      void this.stop();
    };

    socket.onerror = () => {
      // `onclose` always follows.
    };
  }

  /**
   * The user pressed the button. Push-to-talk only.
   *
   * With `hold`, capture starts but nothing is sent, and the assistant is not
   * interrupted, until `confirmUtterance`. `discardUtterance` drops it
   * instead. For a control where a press might turn out to be a drag.
   */
  beginUtterance(options?: { hold?: boolean }): void {
    if (this.options.handsFree) return;
    if (this.state !== "listening" && this.state !== "speaking") return;

    this.utteranceMs = 0;

    if (options?.hold) {
      this.held = [];
      this.mic.unmute();
      this.setState("recording");
      return;
    }

    this.interruptPlayback();
    this.mic.unmute();
    this.setState("recording");
  }

  /** A held press was speech after all: send what was captured, and carry on. */
  confirmUtterance(): void {
    const held = this.held;
    if (!held) return;
    this.held = null;
    this.interruptPlayback();
    for (const pcm of held) this.sendAudio(pcm);
  }

  /** A held press was a drag: drop what was captured, and send nothing. */
  discardUtterance(): void {
    if (!this.held) return;
    this.held = null;
    this.mic.mute();
    this.utteranceMs = 0;
    this.options.onLevel?.("user", 0);
    this.setState(this.speaker.speaking ? "speaking" : "listening");
  }

  /**
   * Pressing while the assistant is talking is an interruption. Split out so a
   * held press does not cut the assistant off before it is known to be speech.
   */
  private interruptPlayback(): void {
    // Stop the playback the user has clearly stopped listening to, and tell
    // the runtime how much of it they actually heard so the model's history
    // matches their memory of the conversation.
    if (this.speaker.speaking) {
      this.sendControl({
        type: "playback",
        data: { ms: this.speaker.heardMs() },
      });
      this.speaker.flush();
    }
  }

  /** The user released the button. Push-to-talk only. */
  endUtterance(): void {
    if (this.options.handsFree) return;
    if (this.state !== "recording") return;
    // Released before anyone decided: a press that never moved is speech.
    this.confirmUtterance();
    this.mic.mute();
    this.options.onLevel?.("user", 0);

    // A tap, not speech. Committing this comes back from the provider as
    // "buffer too small", which is a true statement about something the user
    // should never have been able to send — so it is caught here instead, and
    // again in the runtime, which is the authority for clients that are not
    // this one.
    if (this.utteranceMs < this.minUtteranceMs) {
      this.emit({
        type: "error",
        code: "utterance_too_short",
        message: "Hold the button while you speak.",
        recoverable: true,
        fallbackToChat: false,
      });
      this.setState("listening");
      return;
    }

    this.sendControl({ type: "commit" });
    this.setState("thinking");
  }

  async stop(): Promise<void> {
    if (this.stopped) return;
    this.stopped = true;

    if (this.playbackTimer !== null) {
      clearInterval(this.playbackTimer);
      this.playbackTimer = null;
    }

    this.sendControl({ type: "end" });
    this.socket?.close();
    this.socket = null;

    await Promise.all([this.mic.stop(), this.speaker.stop()]);
    this.setState("idle");
  }

  // ------------------------------------------------------------- internals

  private handleControl(raw: string): void {
    let message: VoiceServerMessage;
    try {
      message = JSON.parse(raw) as VoiceServerMessage;
    } catch {
      return;
    }

    switch (message.type) {
      case "ready":
        // Tolerating an absent value keeps a newer SDK working against an older
        // runtime, where guessing low would fail the first press of a session.
        this.minUtteranceMs = message.data.minUtteranceMs ?? this.minUtteranceMs;

        // Hands-free opens the microphone here and not in `start`, and the
        // difference is a whole class of bug. Unmuting early meant capturing
        // from before the socket existed until the provider accepted its
        // configuration — a second or two of the room — and every frame after
        // the socket opened was sent, queued behind a relay still sitting in
        // `wait_for_ready`. It arrived in one burst the moment the loop began
        // reading, the provider's VAD read the burst as an utterance, and the
        // session answered something nobody said. Reliably at the start of a
        // session and never afterwards, because it can only happen once.
        //
        // The runtime already holds this rule for its own upstream: nothing is
        // sent until the provider has accepted the configuration. This is the
        // client keeping the same rule.
        //
        // Still open for the whole session once it opens — there is no press
        // to open it on, and opening per detected utterance would clip the
        // first word, which is usually the one carrying the intent.
        if (this.options.handsFree) this.mic.unmute();

        this.setState("listening");
        break;

      case "transcript": {
        // The runtime forwards the provider's deltas as they arrive, a few
        // characters each, so the line so far is built here. Emitting the raw
        // delta made the caption show only the latest fragment, which read as
        // gibberish flickering over the orb.
        let text = message.data.text;
        if (message.data.role === "assistant") {
          if (message.data.final) {
            this.assistantLine = "";
          } else {
            this.assistantLine += text;
            text = this.assistantLine;
          }
        }
        this.emit({
          type: "transcript",
          role: message.data.role,
          text,
          final: message.data.final,
        });
        break;
      }

      case "status":
        // A status of `listening` means one thing: the user interrupted. The
        // queued audio has to go, or the assistant carries on out of the
        // speaker after being cut off — and the runtime has already truncated
        // its history to what was heard, so the two would disagree about the
        // conversation.
        //
        // This is safe only because a *finished* reply arrives as
        // `speech_done` instead. The relay used to send both, and flushing on
        // a completed response threw away everything still queued — heard as
        // every answer breaking off part-way through.
        if (
          message.data.state === "listening" &&
          this.speaker.speaking
        ) {
          this.speaker.flush();
        }
        // An interrupted line may never be marked final, and its leftovers
        // must not prefix the next reply's caption.
        if (message.data.state === "listening") this.assistantLine = "";

        // The server's view of the session, except while the button is down —
        // the client knows about a press before the server does, and letting a
        // status frame overwrite `recording` makes the button flicker.
        if (this.state !== "recording") {
          this.setState(
            message.data.state === "reconnecting"
              ? "connecting"
              : message.data.state,
          );
        }
        break;

      case "speech_done":
        // From `thinking` too: a reply can finish with no audio at all, a tool
        // call and nothing said, and the session must still take the next
        // press.
        if (this.state === "speaking" || this.state === "thinking") {
          this.setState("listening");
        }
        break;

      case "ending_soon":
        this.emit({
          type: "ending_soon",
          secondsRemaining: message.data.secondsRemaining,
        });
        break;

      case "ended":
        this.emit({
          type: "ended",
          reason: message.data.reason,
          message: message.data.message,
        });
        // `stop` leaves the state `idle`, which is the point: the microphone
        // button goes back to its resting look rather than the failed one, and
        // pressing it again starts a fresh session on the same conversation.
        void this.stop();
        break;

      case "error":
        this.emit({
          type: "error",
          code: message.data.code,
          message: message.data.message,
          recoverable: message.data.recoverable,
          fallbackToChat: message.data.fallbackToChat,
        });
        // A recoverable error is one operation failing, not the call ending.
        // Tearing the session down here was the bug: a mistimed press hung up
        // on the user and made them start over.
        if (!message.data.recoverable) {
          this.setState("error");
          void this.stop();
        }
        break;
    }
  }

  private sendAudio(pcm: ArrayBuffer): void {
    // Hands-free sends throughout: the provider's VAD is what decides where an
    // utterance begins, and it cannot do that on audio it never receives.
    if (!this.options.handsFree && this.state !== "recording") return;
    if (this.held) {
      this.held.push(pcm);
      this.options.onLevel?.("user", pcmLevel(pcm));
      return;
    }
    this.options.onLevel?.("user", pcmLevel(pcm));
    // Two bytes per sample, one channel.
    this.utteranceMs += (pcm.byteLength * 1000) / (2 * VOICE_SAMPLE_RATE);
    try {
      this.socket?.send(pcm);
    } catch {
      // A send on a closing socket throws; `onclose` handles the rest.
    }
  }

  private sendControl(message: VoiceClientMessage): void {
    try {
      this.socket?.send(JSON.stringify(message));
    } catch {
      // Same.
    }
  }

  private setState(state: VoiceState): void {
    if (this.state === state) return;
    this.state = state;
    this.reportPlaybackWhileSpeaking();
    this.options.onEvent({ type: "state", state });
  }

  /**
   * Tell the runtime how much of the current reply has actually been heard,
   * a few times a second, for as long as the assistant is speaking.
   *
   * Push-to-talk does not need this: the interruption *is* a button press, so
   * the position can be measured at exactly that moment. Hands-free has no
   * such moment on this side — the provider notices the user talking, upstream
   * — so the runtime has to already hold a recent figure when it truncates.
   *
   * Without it, truncation falls back to nothing and the model's history keeps
   * the whole reply, including the part the user cut off. It then answers
   * follow-ups about words nobody heard.
   *
   * Four frames a second of small JSON, against fifty of audio.
   */
  private reportPlaybackWhileSpeaking(): void {
    const shouldReport =
      Boolean(this.options.handsFree) && this.state === "speaking";

    if (!shouldReport) {
      if (this.playbackTimer !== null) {
        clearInterval(this.playbackTimer);
        this.playbackTimer = null;
      }
      return;
    }

    if (this.playbackTimer !== null) return;

    this.playbackTimer = setInterval(() => {
      if (!this.speaker.speaking) return;
      this.sendControl({
        type: "playback",
        data: { ms: this.speaker.heardMs() },
      });
    }, 250);
  }

  private emit(event: VoiceEvent): void {
    this.options.onEvent(event);
  }
}

/**
 * Derive the voice socket URL from the chat socket URL.
 *
 * One `url` prop for the whole SDK rather than two: the two sockets are always
 * served by the same runtime, and a second prop would be a second thing to get
 * wrong in every integration for no configurability anyone wants.
 */
export function voiceUrl(
  chatUrl: string,
  token: string,
  handsFree = false,
): string {
  const base = chatUrl.replace(/\/v1\/ws\/?$/, "/v1/voice");
  const separator = base.includes("?") ? "&" : "?";
  const mode = handsFree ? "&handsFree=true" : "";
  return `${base}${separator}token=${encodeURIComponent(token)}${mode}`;
}
