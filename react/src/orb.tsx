/**
 * The orb: the widget as a circle, and voice shown in the circle itself
 * (amendment 61).
 *
 * Tapping it opens a small menu, chat and whichever voice modes the app
 * allows, or goes straight to chat when chat is the only one. Chat opens the
 * panel. Voice stays in the orb, which is the point of it: with the panel out
 * of the way, the user watches their own page being navigated, highlighted and
 * changed, instead of reading about it in a transcript.
 *
 * Two things the orb must still show, because collapsing the panel is not a
 * licence to hide them:
 *
 * - **The confirmation card**, anchored to the orb, rendered from the proposal
 *   payload exactly as the panel renders it. High-risk actions need that tap
 *   in every mode.
 * - **Refusals and errors**, in a bubble above it.
 *
 * Live captions are not shown. Streamed transcript text never kept pace with
 * the voice, and a caption that lags what you hear reads as broken. Finished
 * lines still land in the conversation, and `voice.caption` is still exposed
 * for a host that wants to draw its own.
 *
 * Tap, hold and drag share one element, so a press is read like this:
 *
 * | Mode         | Tap                      | Hold                     | Drag past 8px            |
 * |--------------|--------------------------|--------------------------|--------------------------|
 * | Idle         | menu, or chat            | nothing                  | moves it, if draggable   |
 * | Menu open    | closes it                | nothing                  | nothing                  |
 * | Hands-free   | ends the session         | nothing                  | moves it, if draggable   |
 * | Push-to-talk | nothing                  | records, release sends   | discards, then moves it  |
 *
 * Push-to-talk records from the moment the finger goes down, so the first word
 * is not lost. On a draggable orb the first 150ms are held on the device
 * rather than sent: still, they are sent and recording carries on; moved, they
 * are dropped and never leave the browser.
 */

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";

import type { VoiceMode, WidgetCorner } from "@mihe-dev/protocol";

import { ConfirmationCard } from "./card";
import { LAUNCHER_BG, LAUNCHER_INK, LAUNCHER_VOICE, LauncherIcon } from "./launcher-icon";
import { useAssistant } from "./provider";

/** The voice modes an app can offer. The protocol's type, under the SDK's name. */
export type OrbVoiceMode = VoiceMode;

/** Which corner the orb sits in until someone drags it. */
export type OrbCorner = WidgetCorner;

export interface OrbProps {
  heading: string;
  launcherIcon?: ReactNode;
  draggable: boolean;
  corner: OrbCorner;
  voiceModes: OrbVoiceMode[];
  /** Hide the orb itself, for a host app with its own trigger. */
  showOrb: boolean;
  /** The panel, positioned by the orb on whichever side it sits. */
  renderPanel: (style: CSSProperties) => ReactNode;
}

const SIZE = 56;
const MARGIN = 20;
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

function readRest(): Rest | null {
  try {
    const raw = window.localStorage.getItem(POSITION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Rest;
    if ((parsed.side === "left" || parsed.side === "right") && typeof parsed.y === "number") {
      return parsed;
    }
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

function useViewport(): { width: number; height: number } {
  const read = () => ({
    width: typeof window === "undefined" ? 1024 : window.innerWidth,
    height: typeof window === "undefined" ? 768 : window.innerHeight,
  });
  const [size, setSize] = useState(read);
  useEffect(() => {
    const onResize = () => setSize(read());
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  return size;
}

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(query.matches);
    const onChange = () => setReduced(query.matches);
    query.addEventListener?.("change", onChange);
    return () => query.removeEventListener?.("change", onChange);
  }, []);
  return reduced;
}

export function Orb({
  heading,
  launcherIcon,
  draggable,
  corner,
  voiceModes,
  showOrb,
  renderPanel,
}: OrbProps) {
  const {
    isOpen,
    open,
    voice,
    proposals,
    respondToProposal,
    lastError,
    connection,
    launcherIconUrl,
  } = useAssistant();

  const viewport = useViewport();
  const reducedMotion = usePrefersReducedMotion();

  const [menuOpen, setMenuOpen] = useState(false);
  const [rest, setRest] = useState<Rest | null>(null);
  const [drag, setDrag] = useState<{ left: number; top: number } | null>(null);
  const [showHint, setShowHint] = useState(false);

  const orbRef = useRef<HTMLButtonElement>(null);
  const ringRef = useRef<HTMLSpanElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // Read after mount, not during render: storage is a browser thing, and a
  // server-rendered first paint must match the client's.
  useEffect(() => {
    if (draggable) setRest(readRest());
    setShowHint(!hintDone());
  }, [draggable]);

  const voiceLive = voice.state !== "idle" && voice.state !== "error";
  const handsFree = voiceLive && voice.handsFree;
  const holdToTalk = voiceLive && !voice.handsFree;

  const allowed = voice.available ? voiceModes : [];
  const menuItems: { key: "chat" | OrbVoiceMode; label: string }[] = [
    { key: "chat", label: "Chat" },
    ...(allowed.includes("hands-free") ? [{ key: "hands-free" as const, label: "Talk" }] : []),
    ...(allowed.includes("hold") ? [{ key: "hold" as const, label: "Hold to talk" }] : []),
  ];

  // ------------------------------------------------------------ position

  const restingLeft = (side: "left" | "right") =>
    side === "left" ? MARGIN : viewport.width - MARGIN - SIZE;
  const clampTop = (top: number) =>
    Math.min(Math.max(MARGIN, top), Math.max(MARGIN, viewport.height - MARGIN - SIZE));

  const side: "left" | "right" = drag
    ? drag.left + SIZE / 2 < viewport.width / 2
      ? "left"
      : "right"
    : (rest?.side ?? (corner === "bottom-left" ? "left" : "right"));

  const left = drag ? drag.left : restingLeft(side);
  const top = drag
    ? drag.top
    : clampTop(rest ? rest.y * viewport.height : viewport.height - MARGIN - SIZE);

  /** Which way is into the page, from the orb. */
  const inward = side === "right" ? -1 : 1;
  /** Whether things open above the orb, or below it when it sits high. */
  const above = top + SIZE / 2 > viewport.height / 2;

  // ------------------------------------------------------------ the ring

  // Follows the voice level without re-rendering: a level arrives tens of
  // times a second, and each one only needs to move one element.
  useEffect(() => {
    if (!voiceLive || reducedMotion) {
      if (ringRef.current) ringRef.current.style.transform = "scale(1)";
      return;
    }
    let target = 0;
    let current = 0;
    let frame = 0;
    const unsubscribe = voice.onLevel((source, level) => {
      // Only the side whose turn it is moves the ring.
      if (source === "user" && (voice.state === "recording" || voice.handsFree)) target = level;
      if (source === "assistant") target = level;
    });
    const tick = () => {
      // Quick to rise, slow to fall, which reads as breathing rather than
      // flicker.
      current += (target - current) * (target > current ? 0.45 : 0.12);
      target *= 0.92;
      if (ringRef.current) {
        ringRef.current.style.transform = `scale(${1 + current * 0.38})`;
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => {
      unsubscribe();
      cancelAnimationFrame(frame);
    };
  }, [voiceLive, reducedMotion, voice]);

  // ------------------------------------------------------------ the hint

  // "Hold to talk" stays until the first recording that reached the model,
  // which is the moment a recording goes to `thinking`.
  const previousState = useRef(voice.state);
  useEffect(() => {
    if (previousState.current === "recording" && voice.state === "thinking") {
      markHintDone();
      setShowHint(false);
    }
    previousState.current = voice.state;
  }, [voice.state]);

  // ------------------------------------------------------------ the bubble

  const bubble: { text: string; tone: "quiet" | "error" } | null =
    voice.state === "connecting"
      ? { text: "Setting up the microphone…", tone: "quiet" }
      : lastError && (voiceLive || voice.state === "error")
        ? { text: lastError, tone: "error" }
        : voice.notice
          ? { text: voice.notice, tone: "quiet" }
          : holdToTalk && showHint && voice.state === "listening"
            ? { text: "Hold to talk", tone: "quiet" }
            : null;

  // ------------------------------------------------------------ the menu

  useEffect(() => {
    if (!menuOpen) return;
    // Focus moves into the menu so the arrow keys and Esc work at once.
    const first = menuRef.current?.querySelector<HTMLButtonElement>("button");
    first?.focus();
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!menuRef.current?.contains(target) && !orbRef.current?.contains(target)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [menuOpen]);

  const choose = (key: "chat" | OrbVoiceMode) => {
    setMenuOpen(false);
    if (key === "chat") {
      open();
    } else {
      // Entering a voice mode asks for the microphone now, so the browser's
      // permission prompt does not swallow the first hold.
      voice.start({ handsFree: key === "hands-free", openPanel: false });
    }
  };

  const onMenuKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const buttons = Array.from(
      menuRef.current?.querySelectorAll<HTMLButtonElement>("button") ?? [],
    );
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (event.key === "Escape") {
      event.preventDefault();
      setMenuOpen(false);
      orbRef.current?.focus();
    } else if (event.key === "ArrowDown" || event.key === "ArrowRight") {
      event.preventDefault();
      buttons[(index + 1) % buttons.length]?.focus();
    } else if (event.key === "ArrowUp" || event.key === "ArrowLeft") {
      event.preventDefault();
      buttons[(index - 1 + buttons.length) % buttons.length]?.focus();
    }
  };

  // ------------------------------------------------------------ the orb itself

  const tap = useCallback(() => {
    if (menuOpen) {
      setMenuOpen(false);
      return;
    }
    if (handsFree) {
      // Tapping stops rather than pauses: a hands-free session is billed for
      // every second it is open, so a pause that kept it open would still cost.
      voice.stop();
      return;
    }
    if (holdToTalk) return; // a tap in push-to-talk is too short to be speech
    if (menuItems.length === 1) open();
    else setMenuOpen(true);
  }, [menuOpen, handsFree, holdToTalk, menuItems.length, open, voice]);

  const press = useRef<{
    x: number;
    y: number;
    offsetX: number;
    offsetY: number;
    dragging: boolean;
    recording: "held" | "live" | null;
    timer: ReturnType<typeof setTimeout> | null;
  } | null>(null);

  const onPointerDown = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0) return;
    event.currentTarget.setPointerCapture?.(event.pointerId);

    const state = {
      x: event.clientX,
      y: event.clientY,
      offsetX: event.clientX - left,
      offsetY: event.clientY - top,
      dragging: false,
      recording: null as "held" | "live" | null,
      timer: null as ReturnType<typeof setTimeout> | null,
    };
    press.current = state;

    if (holdToTalk && (voice.state === "listening" || voice.state === "speaking")) {
      if (draggable) {
        // Held on the device until it is clear this is speech, not a drag.
        voice.press({ hold: true });
        state.recording = "held";
        state.timer = setTimeout(() => {
          if (press.current === state && !state.dragging) {
            voice.confirm();
            state.recording = "live";
          }
        }, HOLD_WINDOW_MS);
      } else {
        voice.press();
        state.recording = "live";
      }
    }
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const state = press.current;
    if (!state || !draggable || menuOpen) return;
    // Once a recording is live, the finger is holding a microphone, not the orb.
    if (state.recording === "live") return;

    const moved = Math.hypot(event.clientX - state.x, event.clientY - state.y);
    if (!state.dragging && moved > DRAG_THRESHOLD) {
      state.dragging = true;
      if (state.recording === "held") {
        if (state.timer) clearTimeout(state.timer);
        voice.discard();
        state.recording = null;
      }
    }
    if (state.dragging) {
      setDrag({
        left: Math.min(
          Math.max(0, event.clientX - state.offsetX),
          viewport.width - SIZE,
        ),
        top: Math.min(Math.max(0, event.clientY - state.offsetY), viewport.height - SIZE),
      });
    }
  };

  const finish = (cancelled: boolean) => {
    const state = press.current;
    press.current = null;
    if (!state) return;
    if (state.timer) clearTimeout(state.timer);

    if (state.dragging && drag) {
      // Snap to the nearer side, and keep the height.
      const next: Rest = {
        side: drag.left + SIZE / 2 < viewport.width / 2 ? "left" : "right",
        y: clampTop(drag.top) / viewport.height,
      };
      setRest(next);
      writeRest(next);
      setDrag(null);
      return;
    }
    setDrag(null);

    if (state.recording) {
      // Released: a held press that never moved is speech too.
      voice.release();
      return;
    }
    if (!cancelled) tap();
  };

  const onKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (event.repeat) return;
    if (holdToTalk && event.key === " ") {
      event.preventDefault();
      if (voice.state === "listening" || voice.state === "speaking") voice.press();
      return;
    }
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      tap();
    }
    if (event.key === "Escape" && voiceLive) {
      event.preventDefault();
      voice.stop();
    }
  };

  const onKeyUp = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (holdToTalk && event.key === " ") {
      event.preventDefault();
      voice.release();
    }
  };

  // Chat open: the panel takes the orb's place, on the orb's side.
  if (isOpen) {
    return (
      <>
        {renderPanel({
          position: "fixed",
          bottom: MARGIN,
          [side]: MARGIN,
          width: `min(380px, calc(100vw - ${MARGIN * 2}px))`,
          height: `min(560px, calc(100vh - ${MARGIN * 2}px))`,
          zIndex: 2147482000,
        })}
      </>
    );
  }

  if (!showOrb) return null;

  const ringState = !voiceLive
    ? "idle"
    : voice.state === "connecting"
      ? "connecting"
      : voice.state === "thinking"
        ? "thinking"
        : voice.state === "recording"
          ? "recording"
          : voice.state === "speaking"
            ? "speaking"
            : "listening";

  const label = handsFree
    ? `Stop talking to ${heading}`
    : holdToTalk
      ? voice.state === "recording"
        ? "Release to send"
        : "Hold to talk"
      : menuItems.length === 1
        ? `Open ${heading}`
        : `${heading}: choose chat or voice`;

  // Floating things open beside the orb, towards the page and away from the
  // nearer edge, so nothing is drawn off-screen wherever it has been dragged.
  const popover: CSSProperties = {
    position: "fixed",
    [side]: MARGIN,
    ...(above
      ? { bottom: viewport.height - top + 12 }
      : { top: top + SIZE + 12 }),
    maxWidth: `min(340px, calc(100vw - ${MARGIN * 2}px))`,
    zIndex: 2147482001,
  };

  return (
    <>
      <style>{ORB_KEYFRAMES}</style>

      {menuOpen && (
        <div
          ref={menuRef}
          role="menu"
          aria-label={heading}
          onKeyDown={onMenuKeyDown}
          style={{
            ...popover,
            display: "flex",
            flexDirection: above ? "column-reverse" : "column",
            alignItems: side === "right" ? "flex-end" : "flex-start",
            gap: 8,
          }}
        >
          {menuItems.map((item) => (
            <button
              key={item.key}
              type="button"
              role="menuitem"
              onClick={() => choose(item.key)}
              style={styles.menuItem}
            >
              <span aria-hidden="true" style={styles.menuIcon}>
                {item.key === "chat" ? <ChatIcon /> : item.key === "hold" ? <MicIcon /> : <WaveIcon />}
              </span>
              {item.label}
            </button>
          ))}
        </div>
      )}

      {!menuOpen && proposals.length > 0 && (
        // The card, out of the orb. The session waits for this tap, and the
        // card is the same component the panel draws, from the same payload.
        <div style={{ ...popover, display: "flex", flexDirection: "column", gap: 8, width: 320 }}>
          {proposals.map((proposal) => (
            <ConfirmationCard
              key={proposal.proposalId}
              proposal={proposal}
              onRespond={respondToProposal}
            />
          ))}
        </div>
      )}

      {!menuOpen && proposals.length === 0 && bubble && (
        <div
          role="status"
          aria-live="polite"
          style={{
            ...popover,
            ...styles.bubble,
            ...(bubble.tone === "error" ? styles.bubbleError : null),
          }}
        >
          {bubble.text}
        </div>
      )}

      <button
        ref={orbRef}
        type="button"
        aria-label={label}
        aria-haspopup={menuItems.length > 1 && !voiceLive ? "menu" : undefined}
        aria-expanded={menuItems.length > 1 && !voiceLive ? menuOpen : undefined}
        aria-pressed={holdToTalk ? voice.state === "recording" : undefined}
        aria-busy={voice.state === "connecting"}
        disabled={connection !== "open" && !voiceLive}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={() => finish(false)}
        onPointerCancel={() => finish(true)}
        onKeyDown={onKeyDown}
        onKeyUp={onKeyUp}
        onContextMenu={(event) => event.preventDefault()}
        style={{
          ...styles.orb,
          left,
          top,
          cursor: drag ? "grabbing" : "pointer",
          transition: drag ? "none" : "left 180ms ease, top 180ms ease",
        }}
      >
        <span
          ref={ringRef}
          aria-hidden="true"
          className={`mihe-orb-ring mihe-orb-${ringState}`}
          style={{
            ...styles.ring,
            ...(ringState === "idle" ? styles.ringIdle : null),
            ...(ringState === "recording" ? styles.ringRecording : null),
            ...(ringState === "thinking" || ringState === "connecting"
              ? styles.ringDashed
              : null),
          }}
        />
        <span style={styles.face}>{launcherIcon ?? <LauncherIcon url={launcherIconUrl} />}</span>
      </button>

      {voiceLive && (
        // Always a visible way out that is not a gesture. It ends the
        // session in either mode.
        <button
          type="button"
          aria-label="End voice"
          onClick={() => voice.stop()}
          style={{
            ...styles.stop,
            left: left + (inward === -1 ? -52 : SIZE + 8),
            top: top + (SIZE - 44) / 2,
          }}
        >
          <span aria-hidden="true" style={styles.stopSquare} />
        </button>
      )}
    </>
  );
}

function ChatIcon() {
  return (
    <svg viewBox="0 0 20 20" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round">
      <path d="M4 4.5h12a1.5 1.5 0 0 1 1.5 1.5v7a1.5 1.5 0 0 1-1.5 1.5H9l-4 3v-3H4A1.5 1.5 0 0 1 2.5 13V6A1.5 1.5 0 0 1 4 4.5Z" />
    </svg>
  );
}

function MicIcon() {
  return (
    <svg viewBox="0 0 20 20" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round">
      <rect x="7" y="2.5" width="6" height="10" rx="3" />
      <path d="M4.5 9.5a5.5 5.5 0 0 0 11 0M10 15v2.5" />
    </svg>
  );
}

function WaveIcon() {
  return (
    <svg viewBox="0 0 20 20" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round">
      <path d="M3 10v0M6.5 7v6M10 4v12M13.5 7v6M17 10v0" />
    </svg>
  );
}

/*
 * Inline styles cannot declare keyframes, so the few the ring needs are here.
 * Reduced motion drops them: a colour and the dashed border still say what
 * the ring would have shown moving.
 */
const ORB_KEYFRAMES = `
@keyframes mihe-orb-breathe { 0%, 100% { opacity: 0.55; } 50% { opacity: 1; } }
@keyframes mihe-orb-spin { to { rotate: 360deg; } }
.mihe-orb-listening { animation: mihe-orb-breathe 2.4s ease-in-out infinite; }
.mihe-orb-thinking { animation: mihe-orb-spin 1.2s linear infinite; }
.mihe-orb-connecting { animation: mihe-orb-spin 2.4s linear infinite; }
@media (prefers-reduced-motion: reduce) {
  .mihe-orb-ring { animation: none !important; transform: none !important; }
}
`;

const FONT = "system-ui, -apple-system, 'Segoe UI', sans-serif";

const styles = {
  orb: {
    position: "fixed",
    width: SIZE,
    height: SIZE,
    padding: 0,
    border: "none",
    borderRadius: "50%",
    background: LAUNCHER_BG,
    color: LAUNCHER_INK,
    boxShadow: "0 8px 24px rgba(15,23,42,0.25)",
    zIndex: 2147482000,
    // Holding a finger down must record, not select text or open a menu.
    touchAction: "none",
    userSelect: "none",
    WebkitUserSelect: "none",
    WebkitTouchCallout: "none",
    WebkitTapHighlightColor: "transparent",
  } as CSSProperties,
  face: {
    position: "absolute",
    inset: 0,
    display: "grid",
    placeItems: "center",
    borderRadius: "50%",
    overflow: "hidden",
    pointerEvents: "none",
  },
  // Around the icon, not the icon itself: an uploaded icon could be anything.
  ring: {
    position: "absolute",
    inset: -6,
    borderRadius: "50%",
    border: `2px solid ${LAUNCHER_VOICE}`,
    pointerEvents: "none",
    transformOrigin: "center",
    willChange: "transform",
  },
  ringIdle: { borderColor: "transparent" },
  ringRecording: { borderColor: "#e5484d", borderWidth: 3 },
  ringDashed: { borderStyle: "dashed" },
  stop: {
    position: "fixed",
    width: 44,
    height: 44,
    borderRadius: "50%",
    border: "1px solid rgba(15,23,42,0.12)",
    background: "#fff",
    boxShadow: "0 4px 14px rgba(15,23,42,0.18)",
    display: "grid",
    placeItems: "center",
    cursor: "pointer",
    zIndex: 2147482000,
  },
  stopSquare: { width: 12, height: 12, borderRadius: 2, background: "#0f172a" },
  menuItem: {
    display: "inline-flex",
    alignItems: "center",
    gap: 10,
    minHeight: 44,
    padding: "0 16px 0 6px",
    borderRadius: 999,
    border: "1px solid rgba(15,23,42,0.1)",
    background: "#fff",
    color: "#0f172a",
    boxShadow: "0 6px 18px rgba(15,23,42,0.16)",
    cursor: "pointer",
    font: `500 14px ${FONT}`,
  },
  menuIcon: {
    display: "grid",
    placeItems: "center",
    width: 34,
    height: 34,
    borderRadius: "50%",
    background: LAUNCHER_BG,
    color: LAUNCHER_VOICE,
  },
  bubble: {
    padding: "8px 12px",
    borderRadius: 12,
    background: "#fff",
    color: "#0f172a",
    border: "1px solid rgba(15,23,42,0.1)",
    boxShadow: "0 6px 18px rgba(15,23,42,0.16)",
    font: `14px/1.45 ${FONT}`,
  },
  bubbleError: { background: "#fef2f2", color: "#991b1b", borderColor: "#fecaca" },
} satisfies Record<string, CSSProperties>;
