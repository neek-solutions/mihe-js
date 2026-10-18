/**
 * The chat UI, in two pieces so host apps can take as much or as little as
 * they want:
 *
 * - `AssistantWidget` — a floating launcher and panel. Drop it in, done.
 * - `AssistantPanel` — just the conversation, unpositioned. Put it in a
 *   sidebar, a drawer, a modal, a settings tab.
 * - Neither, and `useAssistant()` instead — every piece of state the panel
 *   renders is on that hook, so a fully custom UI needs nothing from here.
 *
 * Opening and closing lives in the provider rather than in the widget, so a
 * button, a command palette, a keyboard shortcut, or a plain div in the host
 * app can drive it. See `useAssistantTrigger`.
 *
 * Styled with inline styles rather than a stylesheet: this mounts inside
 * someone else's app, and a stylesheet would either leak into their page or
 * be overridden by it. Inline styles are the one approach that cannot do
 * either.
 *
 * The confirmation card is the part to read carefully. It renders `label`,
 * `description`, and `input` from the proposal payload, which the runtime
 * copies from its registry — never from the assistant's prose. Text smuggled
 * into a product name or a document therefore cannot change what a user is
 * shown they are about to approve.
 */

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";

import { ConfirmationCard } from "./card";
import { LAUNCHER_BG, LAUNCHER_INK, LauncherIcon } from "./launcher-icon";
import type { WidgetSettings } from "@mihe-dev/protocol";

import { Orb, type OrbCorner, type OrbVoiceMode } from "./orb";
import { ASSISTANT_PANEL_ID, useAssistant, type VoiceControls } from "./provider";
import type { VoiceState } from "@mihe-dev/js";

export { ASSISTANT_PANEL_ID };
// Still importable from here, where they lived before `card.tsx`.
export { formatValue, humanizeKey } from "./card";

export interface AssistantPanelProps {
  /**
   * Header title, and the launcher's accessible name.
   *
   * Left out, it is the assistant's name from the app's settings — the same
   * one the model introduces itself by — so the header and its own words
   * cannot disagree, and renaming it is a setting rather than a deploy of this
   * app. Pass it to override that; `"Assistant"` is the fallback before the
   * handshake answers.
   */
  title?: string;
  /** Placeholder for the input. */
  placeholder?: string;
  /**
   * Show the header's close button. Off by default for the standalone panel,
   * since a panel embedded in a sidebar usually has nothing to close.
   */
  showClose?: boolean;
  /** Merged over the panel's own styles, for sizing and positioning. */
  style?: CSSProperties;
  /**
   * Show the microphone and hands-free buttons beside the input, when voice
   * is on for the app. True by default. The orb turns them off: in that form
   * voice lives in the orb, and two ways into it would be one too many.
   */
  showVoice?: boolean;
}

export interface AssistantWidgetProps extends AssistantPanelProps {
  /**
   * Render the floating launcher button. Turn it off when the host app has
   * its own trigger, so the user does not get two.
   */
  showLauncher?: boolean;
  /** Open on first mount. */
  defaultOpen?: boolean;
  /**
   * What the launcher button shows, drawn inside its 52px circle.
   *
   * Left out, it is the icon uploaded in the dashboard (the app's settings),
   * so changing it needs no deploy of this app; with none uploaded, it is the
   * Mihe mark. Pass it to override both.
   */
  launcherIcon?: ReactNode;
  /*
   * The four below are settings in the dashboard (amendment 61), delivered
   * with the handshake, so a product person changes them without a deploy.
   * Pass one to override the setting in this app's code.
   */
  /**
   * `"orb"`, the default: a circle that opens a menu of chat and voice, and
   * shows voice in itself so the page stays visible (amendment 61).
   * `"classic"`: a launcher that opens the panel, with voice inside it.
   */
  form?: "orb" | "classic";
  /** Orb only. Let the user drag it to either side; it remembers where. */
  draggable?: boolean;
  /** Orb only. Where it sits until dragged. */
  corner?: OrbCorner;
  /**
   * Orb only. Which voice modes its menu offers, when voice is on for the
   * app. With none, or voice off, tapping the orb opens chat directly.
   *
   * Narrows the app's setting and never widens it: a mode the app has not
   * allowed is refused by the runtime, so offering it would be a button that
   * fails.
   */
  voiceModes?: OrbVoiceMode[];
}

const DEFAULT_VOICE_MODES: OrbVoiceMode[] = ["hands-free", "hold"];

/**
 * A prop where one was passed, the app's setting where one arrived, the
 * SDK's default otherwise. Voice modes intersect instead of overriding.
 */
function resolveWidget(
  props: Pick<AssistantWidgetProps, "form" | "draggable" | "corner" | "voiceModes">,
  settings: WidgetSettings | null,
) {
  const allowed = settings?.voiceModes ?? DEFAULT_VOICE_MODES;
  return {
    form: props.form ?? settings?.form ?? "orb",
    draggable: props.draggable ?? settings?.draggable ?? false,
    corner: props.corner ?? settings?.corner ?? "bottom-right",
    voiceModes: props.voiceModes
      ? props.voiceModes.filter((mode) => allowed.includes(mode))
      : allowed,
  };
}

/**
 * The batteries-included option: the orb by default, or the classic launcher
 * and floating panel.
 */
export function AssistantWidget({
  showLauncher = true,
  defaultOpen = false,
  title,
  launcherIcon,
  form: formProp,
  draggable: draggableProp,
  corner: cornerProp,
  voiceModes: voiceModesProp,
  ...panelProps
}: AssistantWidgetProps) {
  const { isOpen, open, assistantName, launcherIconUrl, widgetSettings } = useAssistant();
  const { form, draggable, corner, voiceModes } = resolveWidget(
    {
      form: formProp,
      draggable: draggableProp,
      corner: cornerProp,
      voiceModes: voiceModesProp,
    },
    widgetSettings,
  );
  const heading = title ?? assistantName ?? "Assistant";

  // `defaultOpen` is honoured once, on mount. After that the provider owns
  // the state, so a host trigger and this prop cannot fight over it.
  const applied = useRef(false);
  useEffect(() => {
    if (applied.current) return;
    applied.current = true;
    if (defaultOpen) open();
  }, [defaultOpen, open]);

  if (form === "orb") {
    return (
      <Orb
        heading={heading}
        launcherIcon={launcherIcon}
        draggable={draggable}
        corner={corner}
        voiceModes={voiceModes}
        showOrb={showLauncher}
        renderPanel={(position) => (
          <AssistantPanel
            title={heading}
            showClose
            {...panelProps}
            showVoice={false}
            style={{ ...position, ...panelProps.style }}
          />
        )}
      />
    );
  }

  if (!isOpen) {
    if (!showLauncher) return null;
    return (
      <button
        type="button"
        onClick={open}
        aria-label={`Open ${heading}`}
        aria-controls={ASSISTANT_PANEL_ID}
        aria-expanded={false}
        style={styles.launcher}
      >
        {launcherIcon ?? <LauncherIcon url={launcherIconUrl} />}
      </button>
    );
  }

  return (
    <AssistantPanel
      title={heading}
      showClose
      {...panelProps}
      style={{ ...styles.floating, ...panelProps.style }}
    />
  );
}

/**
 * The conversation on its own: transcript, confirmation cards, composer.
 *
 * Unpositioned, so it fills whatever the host app puts it in.
 */
export function AssistantPanel({
  title,
  placeholder = "Ask me anything about this app…",
  showClose = false,
  style,
  showVoice = true,
}: AssistantPanelProps) {
  const {
    messages,
    proposals,
    busy,
    connection,
    lastError,
    send,
    respondToProposal,
    close,
    voice,
    assistantName,
    widgetSettings,
  } = useAssistant();
  // The modes the app allows. Offering one it does not would be a button the
  // runtime refuses.
  const voiceModes = widgetSettings?.voiceModes ?? DEFAULT_VOICE_MODES;
  // Explicit prop, then the app's own setting, then a name that is at least
  // not blank. The panel resolves it again rather than trusting the widget to,
  // because it is exported on its own for host apps that place it themselves.
  const heading = title ?? assistantName ?? "Assistant";
  const [draft, setDraft] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages, proposals]);

  const submit = () => {
    send(draft);
    setDraft("");
  };

  return (
    <section
      id={ASSISTANT_PANEL_ID}
      style={{ ...styles.panel, ...style }}
      aria-label={heading}
    >
      <header style={styles.header}>
        <div style={styles.headerTitle}>
          <span
            aria-hidden="true"
            style={{
              ...styles.statusDot,
              background: connection === "open" ? "#22c55e" : "#f59e0b",
            }}
          />
          {heading}
        </div>
        {showClose && (
          <button
            type="button"
            onClick={close}
            aria-label="Close assistant"
            style={styles.iconButton}
          >
            ✕
          </button>
        )}
      </header>

      <div ref={scrollRef} style={styles.transcript}>
        {messages.length === 0 && (
          <p style={styles.empty}>
            Ask where something is, what a screen does, or for help getting
            something done.
          </p>
        )}

        {messages.map((message) => (
          <div
            key={message.id}
            style={message.role === "user" ? styles.userBubble : styles.assistantBubble}
          >
            {message.text}
            {message.streaming && message.text === "" && (
              <span style={styles.thinking}>thinking…</span>
            )}
            {message.sources && message.sources.length > 0 && (
              <div style={styles.sources}>
                {/* Titles only. The snippet is what the model read, not
                    something a reader needs, and pasting document text into a
                    chat bubble is how a "source" turns into a wall. */}
                {message.sources.map((source) => (
                  <span key={source.sourceId + source.title} style={styles.source}>
                    {source.url ? (
                      <a
                        href={source.url}
                        target="_blank"
                        rel="noreferrer noopener"
                        style={styles.sourceLink}
                      >
                        {source.title}
                      </a>
                    ) : (
                      source.title
                    )}
                  </span>
                ))}
              </div>
            )}
          </div>
        ))}

        {proposals.map((proposal) => (
          <ConfirmationCard
            key={proposal.proposalId}
            proposal={proposal}
            onRespond={respondToProposal}
          />
        ))}

        {voice.state === "connecting" && (
          // Setting up a voice session takes a moment — the socket, the
          // microphone permission, and the provider accepting its
          // configuration — and the microphone stays shut until it finishes
          // (amendment 32). Without a word here the user talks into a session
          // that is not listening yet and concludes it is broken.
          <div style={styles.voiceNotice}>Setting up the microphone…</div>
        )}

        {voice.notice && (
          <div style={styles.voiceNotice}>{voice.notice}</div>
        )}

        {lastError && <div style={styles.error}>{lastError}</div>}

        {connection !== "open" && (
          <div style={styles.notice}>
            {connection === "closed"
              ? "Disconnected."
              : "Connecting…"}
          </div>
        )}
      </div>

      <form
        style={styles.composer}
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        {showVoice && voice.available && voiceModes.length > 0 && (
          <VoiceControl
            voice={voice}
            disabled={connection !== "open"}
            allowHold={voiceModes.includes("hold")}
            allowHandsFree={voiceModes.includes("hands-free")}
          />
        )}
        <input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder={placeholder}
          aria-label="Message"
          style={styles.input}
          disabled={connection !== "open"}
        />
        <button
          type="submit"
          disabled={busy || !draft.trim() || connection !== "open"}
          style={styles.send}
        >
          Send
        </button>
      </form>
    </section>
  );
}

const PULSE_KEYFRAMES = `
@keyframes mihe-pulse {
  0%, 100% { transform: scale(1); opacity: 1; }
  50% { transform: scale(0.6); opacity: 0.45; }
}
@media (prefers-reduced-motion: reduce) {
  .mihe-pulse { animation: none !important; }
}
`;

/**
 * The microphone, in whichever of its two modes is running.
 *
 * Idle, it offers both: tap to hold-and-talk, or switch to hands-free. Once a
 * session is live the two behave differently enough to be different controls —
 * one is held, the other is a state you are in — so only the running one is
 * shown, with a way out.
 */
function VoiceControl({
  voice,
  disabled,
  allowHold,
  allowHandsFree,
}: {
  voice: VoiceControls;
  disabled: boolean;
  allowHold: boolean;
  allowHandsFree: boolean;
}) {
  // Connecting is excluded deliberately. A hands-free session that is still
  // being set up used to render the pulsing live button, which says "the
  // microphone is open" — the one thing that is not yet true, and the reason
  // someone talks into a session that cannot hear them.
  const live =
    voice.state !== "idle" && voice.state !== "error" && voice.state !== "connecting";

  if (live && voice.handsFree) {
    return (
      <>
        {/* Inline styles cannot declare keyframes. Reduced motion is honoured
            because a pulse is decoration here — the title and aria-label carry
            the same information for anyone who does not want movement. */}
        <style>{PULSE_KEYFRAMES}</style>
        <button
        type="button"
        aria-label="Stop hands-free voice"
        aria-pressed
        disabled={disabled}
        onClick={voice.stop}
        style={{ ...styles.mic, ...styles.micLive }}
        title={
          voice.state === "speaking"
            ? "Speaking — just talk to interrupt"
            : "Listening — say anything"
        }
      >
        <span
          className="mihe-pulse"
          style={{
            ...styles.pulse,
            // Speaking and listening both pulse, at different rates, because
            // the one thing a hands-free user cannot tell from a static icon
            // is whether the microphone is actually open.
            animationDuration: voice.state === "speaking" ? "0.8s" : "2s",
          }}
        />
        </button>
      </>
    );
  }

  if (live) {
    return (
      <PushToTalk
        state={voice.state}
        onStart={() => voice.start()}
        onPress={voice.press}
        onRelease={voice.release}
        disabled={disabled}
      />
    );
  }

  return (
    <>
      {allowHold && (
        <PushToTalk
          state={voice.state}
          onStart={() => voice.start()}
          onPress={voice.press}
          onRelease={voice.release}
          disabled={disabled}
        />
      )}
      {allowHandsFree && (
        <button
          type="button"
          aria-label="Start hands-free voice"
          disabled={disabled}
          onClick={() => voice.start({ handsFree: true })}
          style={styles.handsFree}
          title="Hands-free — talk without holding anything"
        >
          {"\u221E"}
        </button>
      )}
    </>
  );
}

/**
 * The push-to-talk button.
 *
 * Hold to speak, release to send — the same gesture on a mouse, a touchscreen,
 * and a keyboard. Three details are doing real work:
 *
 * - **`onPointerDown` rather than `onClick`**, because the press has to begin
 *   the utterance and the release has to end it. It is also the user gesture
 *   iOS Safari requires before any audio can start, which is why the first
 *   press opens the session rather than an effect doing it on mount.
 * - **`setPointerCapture`**, so a finger that slides off the button while
 *   speaking still ends the utterance on release. Without it the pointer-up
 *   lands on whatever is underneath and the microphone stays open.
 * - **Space and Enter**, held rather than tapped, so the button is usable
 *   without a pointer at all. `repeat` is ignored, because a held key fires
 *   `keydown` continuously.
 */
function PushToTalk({
  state,
  onStart,
  onPress,
  onRelease,
  disabled,
}: {
  state: VoiceState;
  onStart: () => void;
  onPress: () => void;
  onRelease: () => void;
  disabled: boolean;
}) {
  const connecting = state === "connecting";
  // Connecting is not idle and not ready: the session exists but the
  // microphone is shut until the provider accepts its configuration. Treating
  // it as live meant the button looked armed and swallowed presses.
  const live = state !== "idle" && state !== "error" && !connecting;
  const recording = state === "recording";

  const begin = (event: { currentTarget: HTMLElement; pointerId?: number }) => {
    if (connecting) return;
    if (!live) {
      onStart();
      return;
    }
    if (event.pointerId !== undefined) {
      event.currentTarget.setPointerCapture?.(event.pointerId);
    }
    onPress();
  };

  return (
    <button
      type="button"
      aria-label={
        connecting
          ? "Setting up the microphone"
          : !live
            ? "Start voice"
            : recording
              ? "Release to send"
              : "Hold to speak"
      }
      aria-busy={connecting}
      aria-pressed={recording}
      disabled={disabled || connecting}
      style={{
        ...styles.mic,
        ...(recording ? styles.micRecording : null),
        ...(live && !recording ? styles.micLive : null),
      }}
      onPointerDown={begin}
      onPointerUp={() => live && onRelease()}
      onPointerCancel={() => live && onRelease()}
      onKeyDown={(event) => {
        if (event.repeat) return;
        if (event.key === " " || event.key === "Enter") {
          event.preventDefault();
          begin(event as unknown as { currentTarget: HTMLElement });
        }
      }}
      onKeyUp={(event) => {
        if (live && (event.key === " " || event.key === "Enter")) {
          event.preventDefault();
          onRelease();
        }
      }}
      title={
        state === "thinking"
          ? "Thinking…"
          : state === "speaking"
            ? "Speaking — press to interrupt"
            : undefined
      }
    >
      {state === "thinking" ? "…" : "\u{1F399}"}
    </button>
  );
}


const FONT = "system-ui, -apple-system, 'Segoe UI', sans-serif";


const styles = {
  launcher: {
    position: "fixed",
    right: 20,
    bottom: 20,
    width: 52,
    height: 52,
    borderRadius: "50%",
    border: "none",
    padding: 0,
    display: "grid",
    placeItems: "center",
    overflow: "hidden",
    background: LAUNCHER_BG,
    color: LAUNCHER_INK,
    cursor: "pointer",
    boxShadow: "0 8px 24px rgba(15,23,42,0.25)",
    zIndex: 2147482000,
  },
  // Unpositioned: fills its container. `floating` adds the corner placement.
  panel: {
    display: "flex",
    width: "100%",
    height: "100%",
    flexDirection: "column",
    background: "#fff",
    color: "#0f172a",
    borderRadius: 14,
    border: "1px solid #e2e8f0",
    boxShadow: "0 20px 50px rgba(15,23,42,0.22)",
    font: `14px/1.5 ${FONT}`,
    overflow: "hidden",
  },
  floating: {
    position: "fixed",
    right: 20,
    bottom: 20,
    width: "min(380px, calc(100vw - 40px))",
    height: "min(560px, calc(100vh - 40px))",
    zIndex: 2147482000,
  },
  header: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "12px 14px",
    borderBottom: "1px solid #e2e8f0",
    fontWeight: 600,
  },
  headerTitle: { display: "flex", alignItems: "center", gap: 8 },
  statusDot: { width: 8, height: 8, borderRadius: "50%", display: "inline-block" },
  iconButton: {
    border: "none",
    background: "transparent",
    cursor: "pointer",
    fontSize: 14,
    color: "#64748b",
  },
  transcript: {
    flex: 1,
    overflowY: "auto",
    padding: 14,
    display: "flex",
    flexDirection: "column",
    gap: 10,
  },
  empty: { color: "#64748b", margin: 0 },
  userBubble: {
    alignSelf: "flex-end",
    maxWidth: "85%",
    background: "#4f7cff",
    color: "#fff",
    padding: "8px 12px",
    borderRadius: "12px 12px 2px 12px",
    whiteSpace: "pre-wrap",
  },
  assistantBubble: {
    alignSelf: "flex-start",
    maxWidth: "85%",
    background: "#f1f5f9",
    padding: "8px 12px",
    borderRadius: "12px 12px 12px 2px",
    whiteSpace: "pre-wrap",
  },
  thinking: { color: "#64748b", fontStyle: "italic" },
  sources: {
    display: "flex",
    flexWrap: "wrap",
    gap: 6,
    marginTop: 8,
    paddingTop: 8,
    borderTop: "1px solid #e2e8f0",
  },
  source: {
    fontSize: 11,
    color: "#475569",
    background: "#f1f5f9",
    padding: "2px 8px",
    borderRadius: 999,
  },
  sourceLink: { color: "inherit", textDecoration: "none" },
  error: {
    background: "#fef2f2",
    color: "#991b1b",
    padding: "8px 10px",
    borderRadius: 8,
    fontSize: 13,
  },
  notice: { color: "#64748b", fontSize: 13, textAlign: "center" },
  // The shape of the error box, deliberately, in the weight of a remark. A
  // voice session ending on time is the ordinary case and the user has lost
  // nothing, so it must not be red — but it is about their session rather than
  // about the connection, so it is not the grey centred line either.
  voiceNotice: {
    background: "#f1f5f9",
    color: "#475569",
    padding: "8px 10px",
    borderRadius: 8,
    fontSize: 13,
  },
  composer: {
    display: "flex",
    gap: 8,
    padding: 12,
    borderTop: "1px solid #e2e8f0",
  },
  input: {
    flex: 1,
    padding: "9px 12px",
    borderRadius: 8,
    border: "1px solid #cbd5e1",
    font: `14px ${FONT}`,
    outline: "none",
  },
  mic: {
    width: 38,
    borderRadius: 8,
    border: "1px solid #cbd5e1",
    background: "#fff",
    cursor: "pointer",
    fontSize: 16,
    // Otherwise a long press on a phone selects the emoji and pops up the
    // copy menu instead of recording.
    userSelect: "none",
    touchAction: "none",
  },
  micLive: {
    borderColor: "#4f7cff",
  },
  micRecording: {
    borderColor: "#dc2626",
    background: "#fef2f2",
  },
  handsFree: {
    width: 30,
    borderRadius: 8,
    border: "1px solid #cbd5e1",
    background: "#fff",
    color: "#475569",
    cursor: "pointer",
    fontSize: 15,
    userSelect: "none",
  },
  pulse: {
    display: "block",
    width: 12,
    height: 12,
    margin: "0 auto",
    borderRadius: "50%",
    background: "#4f7cff",
    animationName: "mihe-pulse",
    animationIterationCount: "infinite",
    animationTimingFunction: "ease-in-out",
  },
  send: {
    padding: "9px 16px",
    borderRadius: 8,
    border: "none",
    background: "#4f7cff",
    color: "#fff",
    cursor: "pointer",
    font: `600 13px ${FONT}`,
  },
} satisfies Record<string, CSSProperties>;
