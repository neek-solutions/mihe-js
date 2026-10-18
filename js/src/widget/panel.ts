/**
 * The conversation: transcript, confirmation cards, composer, and in the
 * classic form the microphone.
 *
 * Built once and updated. The composer and the microphone buttons in
 * particular are never rebuilt: a rebuilt input loses what the user was
 * typing, and a push-to-talk button replaced mid-press loses its pointer
 * capture, so the release lands elsewhere and the microphone stays open.
 */

import type { VoiceMode } from "@mihe-dev/protocol";

import { ASSISTANT_PANEL_ID, type Mihe, type MiheState, type VoiceControls } from "../mihe";
import { confirmationCard } from "./card";
import { h, replace, setAttrs } from "./dom";

export const DEFAULT_VOICE_MODES: VoiceMode[] = ["hands-free", "hold"];

export interface PanelOptions {
  /** Header title; the assistant's name from the app's settings otherwise. */
  title?: string;
  placeholder?: string;
  showClose: boolean;
  /** The microphone beside the input. Off when the orb owns voice. */
  showVoice: boolean;
}

export class Panel {
  readonly root: HTMLElement;
  private readonly heading: Text;
  private readonly dot: HTMLElement;
  private readonly closeButton: HTMLButtonElement;
  private readonly transcript: HTMLElement;
  private readonly input: HTMLInputElement;
  private readonly sendButton: HTMLButtonElement;
  private readonly voiceControl: VoiceControl;
  /** What the transcript was last drawn from, so it is redrawn only on change. */
  private drawn: unknown[] = [];

  constructor(
    private readonly mihe: Mihe,
    private options: PanelOptions,
  ) {
    this.heading = document.createTextNode("");
    this.dot = h("span", { class: "status-dot", attrs: { "aria-hidden": "true" } });
    this.closeButton = h(
      "button",
      {
        class: "icon-button",
        attrs: { type: "button", "aria-label": "Close assistant" },
        on: { click: () => this.mihe.close() },
      },
      "✕",
    );
    this.transcript = h("div", { class: "transcript" });
    this.input = h("input", {
      class: "input",
      attrs: { "aria-label": "Message" },
      on: { input: () => this.syncSend(this.mihe.getState()) },
    });
    this.sendButton = h("button", { class: "send", attrs: { type: "submit" } }, "Send");
    this.voiceControl = new VoiceControl(mihe);

    const composer = h(
      "form",
      {
        class: "composer",
        on: {
          submit: (event) => {
            event.preventDefault();
            this.mihe.send(this.input.value);
            this.input.value = "";
            this.syncSend(this.mihe.getState());
          },
        },
      },
      this.voiceControl.root,
      this.input,
      this.sendButton,
    );

    this.root = h(
      "section",
      { class: "panel", attrs: { id: ASSISTANT_PANEL_ID } },
      h("header", { class: "header" }, h("div", { class: "header-title" }, this.dot, this.heading), this.closeButton),
      this.transcript,
      composer,
    );
  }

  setOptions(options: PanelOptions): void {
    this.options = options;
  }

  update(state: MiheState): void {
    const heading = this.options.title ?? state.assistantName ?? "Assistant";
    this.heading.data = heading;
    this.root.setAttribute("aria-label", heading);
    this.dot.classList.toggle("open", state.connection === "open");
    this.closeButton.hidden = !this.options.showClose;
    this.input.placeholder = this.options.placeholder ?? "Ask me anything about this app…";
    this.input.disabled = state.connection !== "open";
    this.syncSend(state);

    // The modes the app allows. Offering one it does not would be a button
    // the runtime refuses.
    const modes = state.widgetSettings?.voiceModes ?? DEFAULT_VOICE_MODES;
    const showVoice = this.options.showVoice && state.voice.available && modes.length > 0;
    this.voiceControl.root.hidden = !showVoice;
    if (showVoice) {
      this.voiceControl.update(state.voice, state.connection !== "open", modes);
    }

    const inputs = [
      state.messages,
      state.proposals,
      state.voice.state === "connecting",
      state.voice.notice,
      state.lastError,
      state.connection,
    ];
    if (inputs.every((value, index) => value === this.drawn[index])) return;
    this.drawn = inputs;
    this.drawTranscript(state);
  }

  private syncSend(state: MiheState): void {
    this.sendButton.disabled = state.busy || !this.input.value.trim() || state.connection !== "open";
  }

  private drawTranscript(state: MiheState): void {
    replace(
      this.transcript,
      state.messages.length === 0 &&
        h(
          "p",
          { class: "empty" },
          "Ask where something is, what a screen does, or for help getting something done.",
        ),
      ...state.messages.map((message) =>
        h(
          "div",
          { class: message.role === "user" ? "bubble-user" : "bubble-assistant" },
          message.text,
          message.streaming && message.text === "" && h("span", { class: "thinking" }, "thinking…"),
          message.sources && message.sources.length > 0 &&
            // Titles only. The snippet is what the model read, not something
            // a reader needs.
            h(
              "div",
              { class: "sources" },
              ...message.sources.map((source) =>
                h(
                  "span",
                  { class: "source" },
                  source.url && /^https?:\/\//i.test(source.url)
                    ? h("a", { attrs: { href: source.url, target: "_blank", rel: "noreferrer noopener" } }, source.title)
                    : source.title,
                ),
              ),
            ),
        ),
      ),
      ...state.proposals.map((proposal) => confirmationCard(proposal, this.mihe.respondToProposal)),
      // Setting up a voice session takes a moment, and the microphone stays
      // shut until it finishes (amendment 32). Without a word here the user
      // talks into a session that is not listening yet.
      state.voice.state === "connecting" && h("div", { class: "voice-notice" }, "Setting up the microphone…"),
      state.voice.notice && h("div", { class: "voice-notice" }, state.voice.notice),
      state.lastError && h("div", { class: "error" }, state.lastError),
      state.connection !== "open" &&
        h("div", { class: "notice" }, state.connection === "closed" ? "Disconnected." : "Connecting…"),
    );
    this.transcript.scrollTo?.({ top: this.transcript.scrollHeight, behavior: "smooth" });
  }
}

/**
 * The microphone, in whichever of its two modes is running.
 *
 * Idle, it offers both: hold to talk, or hands-free. Once a session is live
 * only the running one is shown, with a way out.
 */
class VoiceControl {
  readonly root: HTMLElement;
  private readonly hold: HTMLButtonElement;
  private readonly handsFree: HTMLButtonElement;
  private readonly stopHandsFree: HTMLButtonElement;
  private readonly pulse: HTMLElement;

  constructor(private readonly mihe: Mihe) {
    this.hold = pushToTalk(mihe);
    this.handsFree = h(
      "button",
      {
        class: "hands-free",
        attrs: {
          type: "button",
          "aria-label": "Start hands-free voice",
          title: "Hands-free — talk without holding anything",
        },
        on: { click: () => this.mihe.voice.start({ handsFree: true }) },
      },
      "∞",
    );
    this.pulse = h("span", { class: "pulse" });
    this.stopHandsFree = h(
      "button",
      {
        class: "mic live",
        attrs: { type: "button", "aria-label": "Stop hands-free voice", "aria-pressed": "true" },
        on: { click: () => this.mihe.voice.stop() },
      },
      this.pulse,
    );
    this.root = h("span", { attrs: { style: "display: contents" } }, this.hold, this.handsFree, this.stopHandsFree);
  }

  update(voice: VoiceControls, disabled: boolean, modes: VoiceMode[]): void {
    // Connecting is not live: the microphone is shut until the provider
    // accepts its configuration, and a live-looking button invites talking
    // into a session that cannot hear yet.
    const live = voice.state !== "idle" && voice.state !== "error" && voice.state !== "connecting";
    const liveHandsFree = live && voice.handsFree;

    this.stopHandsFree.hidden = !liveHandsFree;
    this.hold.hidden = liveHandsFree || (!live && !modes.includes("hold"));
    this.handsFree.hidden = live || !modes.includes("hands-free");

    this.stopHandsFree.disabled = disabled;
    this.handsFree.disabled = disabled;
    this.stopHandsFree.title =
      voice.state === "speaking" ? "Speaking — just talk to interrupt" : "Listening — say anything";
    // Speaking and listening pulse at different rates: a hands-free user
    // cannot tell from a still icon whether the microphone is open.
    this.pulse.classList.toggle("fast", voice.state === "speaking");

    const connecting = voice.state === "connecting";
    const recording = voice.state === "recording";
    setAttrs(this.hold, {
      "aria-label": connecting
        ? "Setting up the microphone"
        : !live
          ? "Start voice"
          : recording
            ? "Release to send"
            : "Hold to speak",
      "aria-busy": connecting ? "true" : undefined,
      "aria-pressed": recording ? "true" : "false",
      title: voice.state === "thinking" ? "Thinking…" : voice.state === "speaking" ? "Speaking — press to interrupt" : undefined,
    });
    this.hold.disabled = disabled || connecting;
    this.hold.classList.toggle("recording", recording);
    this.hold.classList.toggle("live", live && !recording);
    this.hold.textContent = voice.state === "thinking" ? "…" : "\u{1F399}";
  }
}

/**
 * The push-to-talk button: hold to speak, release to send, the same gesture
 * on a mouse, a touchscreen and a keyboard.
 *
 * - **Pointer down, not click,** because the press begins the utterance and
 *   the release ends it. It is also the gesture iOS Safari needs before any
 *   audio, which is why the first press opens the session.
 * - **Pointer capture,** so a finger that slides off still ends the
 *   utterance on release.
 * - **Space and Enter, held,** with key repeat ignored.
 *
 * State is read at the moment of each event, never captured.
 */
function pushToTalk(mihe: Mihe): HTMLButtonElement {
  const phase = () => {
    const state = mihe.getState().voice.state;
    const connecting = state === "connecting";
    return { connecting, live: state !== "idle" && state !== "error" && !connecting };
  };
  const begin = (button: HTMLElement, pointerId?: number) => {
    const { connecting, live } = phase();
    if (connecting) return;
    if (!live) {
      mihe.voice.start();
      return;
    }
    if (pointerId !== undefined) button.setPointerCapture?.(pointerId);
    mihe.voice.press();
  };
  const end = () => {
    if (phase().live) mihe.voice.release();
  };

  const button: HTMLButtonElement = h(
    "button",
    {
      class: "mic",
      attrs: { type: "button" },
      on: {
        pointerdown: (event) => begin(button, event.pointerId),
        pointerup: end,
        pointercancel: end,
        keydown: (event) => {
          if (event.repeat) return;
          if (event.key === " " || event.key === "Enter") {
            event.preventDefault();
            begin(button);
          }
        },
        keyup: (event) => {
          if (event.key === " " || event.key === "Enter") {
            event.preventDefault();
            end();
          }
        },
      },
    },
    "\u{1F399}",
  );
  return button;
}
