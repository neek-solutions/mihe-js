/**
 * The conversation: transcript, confirmation cards, composer; and in the
 * classic form a Talk button in the header, which shows the call in place of
 * the conversation while it lasts (amendment 105). The chat box has no
 * microphone.
 *
 * Built once and updated. The composer and the microphone buttons in
 * particular are never rebuilt: a rebuilt input loses what the user was
 * typing, and a push-to-talk button replaced mid-press loses its pointer
 * capture, so the release lands elsewhere and the microphone stays open.
 */

import type { VoiceMode } from "@mihe-dev/protocol";

import { ASSISTANT_PANEL_ID, type Mihe, type MiheState } from "../mihe";
import { confirmationCard } from "./card";
import { h, replace } from "./dom";
import { renderMarkdown } from "./markdown";
import { clipIcon } from "./icons";
import { miheMark } from "./mark";

export const DEFAULT_VOICE_MODES: VoiceMode[] = ["hands-free", "hold"];

export interface PanelOptions {
  /** Header title; the assistant's name from the app's settings otherwise. */
  title?: string;
  placeholder?: string;
  showClose: boolean;
  /** A Talk button in the header, and the call in place of the conversation while it lasts. Off when the orb owns voice. */
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
  /** The paperclip and its file input, shown only when the app describes attachments (amendment 102). */
  private readonly clip: HTMLButtonElement;
  private readonly fileInput: HTMLInputElement;
  private readonly chips: HTMLElement;
  private drawnAttachments: unknown = null;
  private readonly talk: HTMLButtonElement;
  private readonly call: CallView;
  private readonly body: HTMLElement;
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
      on: {
        input: () => this.syncSend(this.mihe.getState()),
        // A pasted screenshot attaches; pasted words paste as usual.
        paste: (event) => {
          if (!this.mihe.getState().attachAccept) return;
          const files = Array.from(event.clipboardData?.files ?? []);
          if (!files.length) return;
          event.preventDefault();
          for (const file of files) this.mihe.attach(file);
        },
      },
    });
    this.fileInput = h("input", {
      attrs: { type: "file", multiple: true, hidden: true },
      on: {
        change: () => {
          for (const file of Array.from(this.fileInput.files ?? [])) this.mihe.attach(file);
          this.fileInput.value = "";
        },
      },
    });
    this.clip = h(
      "button",
      { class: "clip", attrs: { type: "button", "aria-label": "Attach a picture", title: "Attach a picture" }, on: { click: () => this.fileInput.click() } },
      clipIcon(),
    );
    this.chips = h("ul", { class: "chips", attrs: { "aria-label": "Attached pictures" } });
    this.sendButton = h("button", { class: "send", attrs: { type: "submit" } }, "Send");
    this.talk = h("button", { class: "talk", attrs: { type: "button", title: "Talk instead of typing" }, on: { click: () => {
      const modes = this.mihe.getState().widgetSettings?.voiceModes ?? DEFAULT_VOICE_MODES;
      this.mihe.voice.start(modes.includes("hands-free") ? { handsFree: true } : undefined);
    } } }, "Talk");
    this.call = new CallView(mihe);

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
      this.clip,
      this.input,
      this.sendButton,
      // Last, so the message box stays the composer's first input.
      this.fileInput,
    );

    this.root = h(
      "section",
      { class: "panel", attrs: { id: ASSISTANT_PANEL_ID } },
      h("header", { class: "header" }, h("div", { class: "header-title" }, this.dot, this.heading), this.talk, this.closeButton),
      (this.body = h("div", { class: "panel-body" }, this.transcript, this.chips, composer)),
      this.call.root,
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
    this.clip.hidden = !state.attachAccept;
    this.clip.disabled = state.connection !== "open";
    if (state.attachAccept) this.fileInput.accept = state.attachAccept;
    if (state.attachments !== this.drawnAttachments) { this.drawnAttachments = state.attachments; this.drawChips(state); }
    this.syncSend(state);

    // The modes the app allows. Offering one it does not would be a button
    // the runtime refuses.
    const modes = state.widgetSettings?.voiceModes ?? DEFAULT_VOICE_MODES;
    const canTalk = this.options.showVoice && state.voice.available && modes.length > 0;
    const onCall = this.options.showVoice && state.voice.state !== "idle" && state.voice.state !== "error";
    this.talk.hidden = !canTalk || onCall;
    this.talk.disabled = state.connection !== "open";
    this.body.hidden = onCall;
    this.call.update(state, onCall);

    const inputs = [
      state.messages,
      state.proposals,
      state.cardViews,
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
    const reading = state.attachments.some((a) => a.status === "reading");
    const ready = state.attachments.some((a) => a.status === "ready");
    this.sendButton.disabled = state.busy || state.connection !== "open" || reading || (!this.input.value.trim() && !ready);
  }

  private drawChips(state: MiheState): void {
    this.chips.hidden = state.attachments.length === 0;
    replace(
      this.chips,
      ...state.attachments.map((a) =>
        h(
          "li",
          { class: a.status === "failed" ? "chip failed" : "chip" },
          a.previewUrl && h("img", { attrs: { src: a.previewUrl, alt: "" } }),
          h(
            "span",
            { class: "chip-text" },
            h("span", { class: "chip-name" }, a.name),
            h("span", { class: "chip-status", attrs: a.status === "failed" ? { role: "alert" } : {} }, a.status === "reading" ? "Reading…" : a.status === "ready" ? "Ready" : a.error ?? "Couldn't read it"),
          ),
          h("button", { class: "chip-remove", attrs: { type: "button", "aria-label": `Remove ${a.name}` }, on: { click: () => this.mihe.removeAttachment(a.id) } }, "✕"),
        ),
      ),
    );
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
          message.attachments && message.attachments.length > 0 &&
            h(
              "div",
              { class: "sent-pictures" },
              ...message.attachments.map((a) =>
                a.previewUrl ? h("img", { attrs: { src: a.previewUrl, alt: a.name, title: a.name } }) : h("span", { class: "sent-name" }, `📎 ${a.name}`),
              ),
            ),
          message.role === "user" ? message.text : renderMarkdown(message.text),
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
      ...state.proposals.map((proposal) => confirmationCard(proposal, this.mihe.respondToProposal, state.cardViews[proposal.proposalId])),
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
/**
 * The call in place of the conversation (amendment 105): the mark moving with
 * whoever speaks, one line of what's said (held until the next begins), any
 * card that needs a tap, hold to talk when the call isn't hands-free, and End.
 * A copy of the React SDK's `call.tsx`.
 */
export class CallView {
  readonly root: HTMLElement;
  private readonly cards: HTMLElement;
  private readonly ring: HTMLElement;
  private readonly line: HTMLElement;
  private readonly hold: HTMLButtonElement;
  private held = "";
  private failed: string | null = null;
  private lastState = "idle";
  private readonly failedLine: HTMLElement;
  private drawnCards: unknown = null;
  private stopLevel: (() => void) | null = null;

  constructor(private readonly mihe: Mihe) {
    this.cards = h("div", { class: "call-cards" });
    this.ring = h("span", { class: "call-ring" });
    this.line = h("span", { class: "call-line", attrs: { "aria-live": "polite" } });
    this.hold = pushToTalk(mihe);
    this.hold.classList.add("call-hold");
    const end = h("button", { class: "call-end", attrs: { type: "button" }, on: { click: () => this.mihe.voice.stop() } }, "End");
    const mark = h("span", { class: "call-mark", attrs: { "aria-hidden": "true" } }, this.ring, miheMark(26, "#0f172a", "#007277"));
    this.failedLine = h("p", { class: "call-failed", attrs: { role: "alert" } });
    this.root = h("div", { class: "call", attrs: { role: "region", "aria-label": "Voice call" } }, this.cards, this.failedLine, h("div", { class: "call-bar" }, mark, this.line, this.hold, end));
    this.root.hidden = true;
  }

  update(state: MiheState, on: boolean): void {
    this.root.hidden = !on;
    const v = state.voice;
    if (!on) { this.held = ""; this.failed = null; this.failedLine.hidden = true; this.stopLevel?.(); this.stopLevel = null; return; }
    // A failed request says why on its own line until the next one starts (amendment 106).
    if (v.state === "thinking" && this.lastState !== "thinking") this.failed = null;
    if (state.lastError && state.lastError !== this.failedLine.dataset.seen) { this.failed = state.lastError; this.failedLine.dataset.seen = state.lastError; }
    this.lastState = v.state;
    this.failedLine.hidden = !this.failed;
    this.failedLine.textContent = this.failed ?? "";
    if (!this.stopLevel && !matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
      this.stopLevel = this.mihe.voice.onLevel((source, level) => {
        const now = this.mihe.getState().voice;
        if (source === "assistant" || now.handsFree || now.state === "recording") this.ring.style.transform = `scale(${1 + level * 0.38})`;
      });
    }
    if (v.caption) this.held = v.caption;
    const fallback = v.state === "connecting" ? "Setting up the microphone…" : v.state === "thinking" ? "Thinking…" : v.state === "recording" ? "Listening…" : v.handsFree ? (v.state === "speaking" ? "" : "Listening, just talk") : "Hold to talk";
    const text = (v.caption || this.held || fallback).replace(/\s+/g, " ").trim();
    this.line.textContent = text.length <= 90 ? text : `…${text.slice(text.length - 89).replace(/^\S*\s/, "")}`;
    this.line.title = text;
    this.hold.hidden = v.handsFree || v.state === "connecting";
    this.hold.textContent = v.state === "recording" ? "Release to send" : "Hold to talk";
    if (state.proposals !== this.drawnCards) {
      this.drawnCards = state.proposals;
      replace(this.cards, ...state.proposals.map((p) => confirmationCard(p, this.mihe.respondToProposal, state.cardViews[p.proposalId])));
    }
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
