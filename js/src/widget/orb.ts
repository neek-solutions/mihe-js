/**
 * The orb: the widget as a circle, and voice shown in the circle itself
 * (amendment 61). The React SDK's `orb.tsx` in plain DOM; its comments carry
 * the reasoning, and the behaviour is the same:
 *
 * | Mode         | Tap                      | Hold                     | Drag past 8px            |
 * |--------------|--------------------------|--------------------------|--------------------------|
 * | Idle         | menu, or chat            | nothing                  | moves it, if draggable   |
 * | Menu open    | closes it                | nothing                  | nothing                  |
 * | Hands-free   | ends the session         | nothing                  | moves it, if draggable   |
 * | Push-to-talk | nothing                  | records, release sends   | discards, then moves it  |
 *
 * Two things the orb still shows with the panel closed: the confirmation
 * card, from the proposal payload, and refusals and errors, in a bubble.
 *
 * The orb button is built once and updated, never replaced, because a press
 * in progress holds pointer capture on it.
 */

import type { VoiceMode, WidgetCorner } from "@mihe-dev/protocol";

import type { Mihe, MiheState } from "../mihe";
import { confirmationCard } from "./card";
import { h, replace, setAttrs } from "./dom";
import { chatIcon, micIcon, waveIcon } from "./icons";
import { launcherFace } from "./launcher";

export const ORB_SIZE = 56;
export const MARGIN = 20;
const DRAG_THRESHOLD = 8;
/** How long a press is held on the device before it counts as speech. */
const HOLD_WINDOW_MS = 150;

const POSITION_KEY = "mihe:orb-position";
const HINT_KEY = "mihe:hold-hint-done";

/** Where a dragged orb rests: a side, and how far down the viewport. */
interface Rest {
  side: "left" | "right";
  /** Top of the orb as a fraction of the viewport's height, so it survives a resize. */
  y: number;
}

export interface OrbOptions {
  heading: string;
  draggable: boolean;
  corner: WidgetCorner;
  voiceModes: VoiceMode[];
  /** Drawn in the orb in place of the uploaded icon or the mark. Cloned. */
  launcherIcon?: Node;
  /** Distance from the viewport's bottom and side edges, in pixels. */
  offset: { bottom: number; side: number };
}

type MenuKey = "chat" | VoiceMode;

interface Press {
  x: number;
  y: number;
  offsetX: number;
  offsetY: number;
  dragging: boolean;
  recording: "held" | "live" | null;
  timer: ReturnType<typeof setTimeout> | null;
}

function readRest(): Rest | null {
  try {
    const raw = window.localStorage.getItem(POSITION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Rest;
    if ((parsed.side === "left" || parsed.side === "right") && typeof parsed.y === "number") return parsed;
  } catch {
    // Private windows and blocked storage: fall back to the corner.
  }
  return null;
}

function writeRest(rest: Rest): void {
  try {
    window.localStorage.setItem(POSITION_KEY, JSON.stringify(rest));
  } catch {
    // Remembering is a convenience; forgetting is fine.
  }
}

function hintDone(): boolean {
  try {
    return window.localStorage.getItem(HINT_KEY) === "1";
  } catch {
    return false;
  }
}

function markHintDone(): void {
  try {
    window.localStorage.setItem(HINT_KEY, "1");
  } catch {
    // Shown again next time, which is harmless.
  }
}

export class Orb {
  /** Everything the orb draws, as siblings in the shadow root. */
  readonly root: HTMLElement;
  private readonly button: HTMLButtonElement;
  private readonly ring: HTMLElement;
  private readonly face: HTMLElement;
  private readonly stop: HTMLButtonElement;
  private readonly menu: HTMLElement;
  private readonly cards: HTMLElement;
  private readonly bubble: HTMLElement;

  private options!: OrbOptions;
  private state!: MiheState;
  private menuOpen = false;
  private rest: Rest | null = null;
  private drag: { left: number; top: number } | null = null;
  private showHint = !hintDone();
  private press: Press | null = null;
  private previousVoiceState: string = "idle";
  private faceKey: unknown = undefined;
  private drawnProposals: unknown = undefined;
  private drawnViews: unknown = undefined;
  private failedIcon: string | null = null;
  private ringFrame = 0;
  private stopLevel: (() => void) | null = null;
  private readonly reducedMotion =
    typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
  private readonly cleanups: (() => void)[] = [];

  constructor(private readonly mihe: Mihe) {
    this.ring = h("span", { class: "ring idle", attrs: { "aria-hidden": "true" } });
    this.face = h("span", { class: "face" });
    this.button = h(
      "button",
      {
        class: "orb",
        attrs: { type: "button" },
        on: {
          pointerdown: (event) => this.onPointerDown(event),
          pointermove: (event) => this.onPointerMove(event),
          pointerup: () => this.finish(false),
          pointercancel: () => this.finish(true),
          keydown: (event) => this.onKeyDown(event),
          keyup: (event) => this.onKeyUp(event),
          contextmenu: (event) => event.preventDefault(),
        },
      },
      this.ring,
      this.face,
    );
    // Always a visible way out that is not a gesture.
    this.stop = h(
      "button",
      {
        class: "stop",
        attrs: { type: "button", "aria-label": "End voice" },
        on: { click: () => this.mihe.voice.stop() },
      },
      h("span", { class: "stop-square", attrs: { "aria-hidden": "true" } }),
    );
    this.menu = h("div", { class: "popover", attrs: { role: "menu" }, on: { keydown: (event) => this.onMenuKeyDown(event) } });
    this.cards = h("div", { class: "popover cards" });
    this.bubble = h("div", { class: "popover orb-bubble", attrs: { role: "status", "aria-live": "polite" } });
    this.root = h("div", {}, this.menu, this.cards, this.bubble, this.button, this.stop);

    const onResize = () => this.render();
    window.addEventListener("resize", onResize);
    this.cleanups.push(() => window.removeEventListener("resize", onResize));

    const onOutside = (event: PointerEvent) => {
      if (!this.menuOpen) return;
      const path = event.composedPath();
      if (!path.includes(this.menu) && !path.includes(this.button)) this.setMenu(false);
    };
    document.addEventListener("pointerdown", onOutside);
    this.cleanups.push(() => document.removeEventListener("pointerdown", onOutside));
  }

  update(state: MiheState, options: OrbOptions): void {
    if (this.options?.draggable !== options.draggable) {
      this.rest = options.draggable ? readRest() : null;
    }
    // "Hold to talk" stays until the first recording that reached the model.
    if (this.previousVoiceState === "recording" && state.voice.state === "thinking") {
      markHintDone();
      this.showHint = false;
    }
    this.previousVoiceState = state.voice.state;
    this.state = state;
    this.options = options;
    this.render();
  }

  destroy(): void {
    this.stopRing();
    if (this.press?.timer) clearTimeout(this.press.timer);
    for (const cleanup of this.cleanups) cleanup();
  }

  // ---- what the orb is doing --------------------------------------------

  private get voiceLive() {
    const state = this.state.voice.state;
    return state !== "idle" && state !== "error";
  }

  private get handsFree() {
    return this.voiceLive && this.state.voice.handsFree;
  }

  private get holdToTalk() {
    return this.voiceLive && !this.state.voice.handsFree;
  }

  private menuItems(): { key: MenuKey; label: string }[] {
    const allowed = this.state.voice.available ? this.options.voiceModes : [];
    return [
      { key: "chat", label: "Chat" },
      ...(allowed.includes("hands-free") ? [{ key: "hands-free" as const, label: "Talk" }] : []),
      ...(allowed.includes("hold") ? [{ key: "hold" as const, label: "Hold to talk" }] : []),
    ];
  }

  // ---- position ----------------------------------------------------------

  private viewport() {
    return { width: window.innerWidth, height: window.innerHeight };
  }

  private clampTop(top: number): number {
    const { height } = this.viewport();
    const lowest = height - this.options.offset.bottom - ORB_SIZE;
    return Math.min(Math.max(MARGIN, top), Math.max(MARGIN, lowest));
  }

  /** The side the orb sits on, which is also where the panel opens. */
  side(): "left" | "right" {
    const { width } = this.viewport();
    if (this.drag) return this.drag.left + ORB_SIZE / 2 < width / 2 ? "left" : "right";
    return this.rest?.side ?? (this.options?.corner === "bottom-left" ? "left" : "right");
  }

  private position() {
    const { width, height } = this.viewport();
    const side = this.side();
    const edge = this.options.offset.side;
    const left = this.drag ? this.drag.left : side === "left" ? edge : width - edge - ORB_SIZE;
    const top = this.drag
      ? this.drag.top
      : this.clampTop(this.rest ? this.rest.y * height : height - this.options.offset.bottom - ORB_SIZE);
    return { side, left, top, above: top + ORB_SIZE / 2 > height / 2 };
  }

  // ---- drawing -----------------------------------------------------------

  private render(): void {
    if (!this.state) return;
    const { voice, proposals, lastError, connection } = this.state;
    const { heading } = this.options;
    const { side, left, top, above } = this.position();
    const items = this.menuItems();
    const voiceLive = this.voiceLive;

    // The orb.
    const label = this.handsFree
      ? `Stop talking to ${heading}`
      : this.holdToTalk
        ? voice.state === "recording"
          ? "Release to send"
          : "Hold to talk"
        : items.length === 1
          ? `Open ${heading}`
          : `${heading}: choose chat or voice`;
    const menuish = items.length > 1 && !voiceLive;
    setAttrs(this.button, {
      "aria-label": label,
      "aria-haspopup": menuish ? "menu" : undefined,
      "aria-expanded": menuish ? String(this.menuOpen) : undefined,
      "aria-pressed": this.holdToTalk ? String(voice.state === "recording") : undefined,
      "aria-busy": String(voice.state === "connecting"),
    });
    this.button.disabled = connection !== "open" && !voiceLive;
    this.button.style.left = `${left}px`;
    this.button.style.top = `${top}px`;
    this.button.classList.toggle("dragging", this.drag !== null);

    const ringState = !voiceLive
      ? "idle"
      : (["connecting", "thinking", "recording", "speaking"] as const).find((s) => s === voice.state) ?? "listening";
    this.ring.className = `ring ${ringState}`;
    this.syncRing();

    const faceKey = [this.options.launcherIcon, this.state.launcherIconUrl, this.failedIcon];
    if (!sameList(faceKey, this.faceKey)) {
      this.faceKey = faceKey;
      replace(
        this.face,
        launcherFace(this.options.launcherIcon, this.state.launcherIconUrl, this.failedIcon, (url) => {
          this.failedIcon = url;
          this.render();
        }),
      );
    }

    this.stop.hidden = !voiceLive;
    this.stop.style.left = `${left + (side === "right" ? -52 : ORB_SIZE + 8)}px`;
    this.stop.style.top = `${top + (ORB_SIZE - 44) / 2}px`;

    // Floating things open beside the orb, towards the page and away from
    // the nearer edge, so nothing is drawn off-screen wherever it was dragged.
    const { height } = this.viewport();
    for (const popover of [this.menu, this.cards, this.bubble]) {
      popover.style.left = side === "left" ? `${this.options.offset.side}px` : "";
      popover.style.right = side === "right" ? `${this.options.offset.side}px` : "";
      popover.style.bottom = above ? `${height - top + 12}px` : "";
      popover.style.top = above ? "" : `${top + ORB_SIZE + 12}px`;
    }

    // The menu.
    this.menu.hidden = !this.menuOpen;
    this.menu.setAttribute("aria-label", heading);
    this.menu.style.flexDirection = above ? "column-reverse" : "column";
    this.menu.style.alignItems = side === "right" ? "flex-end" : "flex-start";
    if (this.menuOpen && this.menu.childElementCount !== items.length) {
      replace(
        this.menu,
        ...items.map((item) =>
          h(
            "button",
            { class: "menu-item", attrs: { type: "button", role: "menuitem" }, on: { click: () => this.choose(item.key) } },
            h(
              "span",
              { class: "menu-icon", attrs: { "aria-hidden": "true" } },
              item.key === "chat" ? chatIcon() : item.key === "hold" ? micIcon() : waveIcon(),
            ),
            item.label,
          ),
        ),
      );
    }

    // The card, out of the orb. The session waits for this tap, and it is
    // the same card the panel draws, from the same payload.
    this.cards.hidden = this.menuOpen || proposals.length === 0;
    // A card is redrawn when the list changes, and when its view arrives (amendment 99).
    if (proposals !== this.drawnProposals || this.state.cardViews !== this.drawnViews) {
      this.drawnProposals = proposals;
      this.drawnViews = this.state.cardViews;
      replace(this.cards, ...proposals.map((p) => confirmationCard(p, this.mihe.respondToProposal, this.state.cardViews[p.proposalId])));
    }

    const bubble: { text: string; tone: "quiet" | "error" } | null =
      voice.state === "connecting"
        ? { text: "Setting up the microphone…", tone: "quiet" }
        : lastError && (voiceLive || voice.state === "error")
          ? { text: lastError, tone: "error" }
          : voice.notice
            ? { text: voice.notice, tone: "quiet" }
            : this.holdToTalk && this.showHint && voice.state === "listening"
              ? { text: "Hold to talk", tone: "quiet" }
              : null;
    this.bubble.hidden = this.menuOpen || proposals.length > 0 || bubble === null;
    this.bubble.classList.toggle("error", bubble?.tone === "error");
    if (this.bubble.textContent !== (bubble?.text ?? "")) this.bubble.textContent = bubble?.text ?? "";
  }

  /**
   * The ring follows the voice level without a redraw: a level arrives tens
   * of times a second, and each one only moves one element.
   */
  private syncRing(): void {
    const wanted = this.voiceLive && !this.reducedMotion;
    if (wanted === (this.stopLevel !== null)) return;
    if (!wanted) {
      this.stopRing();
      return;
    }
    let target = 0;
    let current = 0;
    this.stopLevel = this.mihe.voice.onLevel((source, level) => {
      const voice = this.mihe.getState().voice;
      // Only the side whose turn it is moves the ring.
      if (source === "user" && (voice.state === "recording" || voice.handsFree)) target = level;
      if (source === "assistant") target = level;
    });
    const tick = () => {
      // Quick to rise, slow to fall, which reads as breathing, not flicker.
      current += (target - current) * (target > current ? 0.45 : 0.12);
      target *= 0.92;
      this.ring.style.transform = `scale(${1 + current * 0.38})`;
      this.ringFrame = requestAnimationFrame(tick);
    };
    this.ringFrame = requestAnimationFrame(tick);
  }

  private stopRing(): void {
    this.stopLevel?.();
    this.stopLevel = null;
    cancelAnimationFrame(this.ringFrame);
    this.ring.style.transform = "scale(1)";
  }

  // ---- the menu ----------------------------------------------------------

  private setMenu(open: boolean): void {
    this.menuOpen = open;
    if (!open) replace(this.menu);
    this.render();
    // Focus moves into the menu so the arrow keys and Esc work at once.
    if (open) this.menu.querySelector("button")?.focus();
  }

  private choose(key: MenuKey): void {
    this.setMenu(false);
    if (key === "chat") {
      this.mihe.open();
    } else {
      // Entering a voice mode asks for the microphone now, so the browser's
      // permission prompt does not swallow the first hold.
      this.mihe.voice.start({ handsFree: key === "hands-free", openPanel: false });
    }
  }

  private onMenuKeyDown(event: KeyboardEvent): void {
    const buttons = Array.from(this.menu.querySelectorAll("button"));
    const active = (this.root.getRootNode() as Document | ShadowRoot).activeElement;
    const index = buttons.indexOf(active as HTMLButtonElement);
    if (event.key === "Escape") {
      event.preventDefault();
      this.setMenu(false);
      this.button.focus();
    } else if (event.key === "ArrowDown" || event.key === "ArrowRight") {
      event.preventDefault();
      buttons[(index + 1) % buttons.length]?.focus();
    } else if (event.key === "ArrowUp" || event.key === "ArrowLeft") {
      event.preventDefault();
      buttons[(index - 1 + buttons.length) % buttons.length]?.focus();
    }
  }

  // ---- the orb itself ----------------------------------------------------

  private tap(): void {
    if (this.menuOpen) {
      this.setMenu(false);
      return;
    }
    if (this.handsFree) {
      // Stops rather than pauses: a hands-free session is billed for every
      // second it is open.
      this.mihe.voice.stop();
      return;
    }
    if (this.holdToTalk) return; // a tap is too short to be speech
    if (this.menuItems().length === 1) this.mihe.open();
    else this.setMenu(true);
  }

  private onPointerDown(event: PointerEvent): void {
    if (event.button !== 0) return;
    this.button.setPointerCapture?.(event.pointerId);
    const { left, top } = this.position();
    const press: Press = {
      x: event.clientX,
      y: event.clientY,
      offsetX: event.clientX - left,
      offsetY: event.clientY - top,
      dragging: false,
      recording: null,
      timer: null,
    };
    this.press = press;

    const voice = this.mihe.getState().voice;
    if (this.holdToTalk && (voice.state === "listening" || voice.state === "speaking")) {
      if (this.options.draggable) {
        // Held on the device until it is clear this is speech, not a drag.
        voice.press({ hold: true });
        press.recording = "held";
        press.timer = setTimeout(() => {
          if (this.press === press && !press.dragging) {
            this.mihe.voice.confirm();
            press.recording = "live";
          }
        }, HOLD_WINDOW_MS);
      } else {
        voice.press();
        press.recording = "live";
      }
    }
  }

  private onPointerMove(event: PointerEvent): void {
    const press = this.press;
    if (!press || !this.options.draggable || this.menuOpen) return;
    // Once a recording is live, the finger is holding a microphone, not the orb.
    if (press.recording === "live") return;

    const moved = Math.hypot(event.clientX - press.x, event.clientY - press.y);
    if (!press.dragging && moved > DRAG_THRESHOLD) {
      press.dragging = true;
      if (press.recording === "held") {
        if (press.timer) clearTimeout(press.timer);
        this.mihe.voice.discard();
        press.recording = null;
      }
    }
    if (press.dragging) {
      const { width, height } = this.viewport();
      this.drag = {
        left: Math.min(Math.max(0, event.clientX - press.offsetX), width - ORB_SIZE),
        top: Math.min(Math.max(0, event.clientY - press.offsetY), height - ORB_SIZE),
      };
      this.render();
    }
  }

  private finish(cancelled: boolean): void {
    const press = this.press;
    this.press = null;
    if (!press) return;
    if (press.timer) clearTimeout(press.timer);

    if (press.dragging && this.drag) {
      // Snap to the nearer side, and keep the height.
      const { width, height } = this.viewport();
      this.rest = {
        side: this.drag.left + ORB_SIZE / 2 < width / 2 ? "left" : "right",
        y: this.clampTop(this.drag.top) / height,
      };
      writeRest(this.rest);
      this.drag = null;
      this.render();
      return;
    }
    this.drag = null;

    if (press.recording) {
      // Released: a held press that never moved is speech too.
      this.mihe.voice.release();
      return;
    }
    if (!cancelled) this.tap();
  }

  private onKeyDown(event: KeyboardEvent): void {
    if (event.repeat) return;
    const voice = this.mihe.getState().voice;
    if (this.holdToTalk && event.key === " ") {
      event.preventDefault();
      if (voice.state === "listening" || voice.state === "speaking") voice.press();
      return;
    }
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      this.tap();
    }
    if (event.key === "Escape" && this.voiceLive) {
      event.preventDefault();
      voice.stop();
    }
  }

  private onKeyUp(event: KeyboardEvent): void {
    if (this.holdToTalk && event.key === " ") {
      event.preventDefault();
      this.mihe.voice.release();
    }
  }
}

function sameList(a: unknown, b: unknown): boolean {
  return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((v, i) => v === b[i]);
}
