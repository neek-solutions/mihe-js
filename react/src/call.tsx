/**
 * A voice call, on its own (amendment 105): the mark moving with whoever is
 * speaking, one line of what's being said, any card that needs a tap, and a
 * way to end it. No transcript and no chat box: a call is a call, and what
 * was said is in the conversation for whoever opens chat afterwards.
 *
 * Rendered by the classic panel while a call is on, and placeable on its own
 * (a bar over a design canvas, say). Shows nothing while there's no call.
 *
 * The line: the words being spoken as they stream, else the last finished
 * line, held until the next begins so it doesn't blink away. The orb shows no
 * caption because streamed text lagged the voice; one line is the compromise.
 */

import { useEffect, useRef, useState, type CSSProperties } from "react";

import { ConfirmationCard } from "./card";
import { MiheMark } from "./mark";
import { useAssistant } from "./provider";

export interface AssistantCallProps {
  /** Placement and size; the call draws its own surface. */
  style?: CSSProperties;
  /** The words under the mark when nobody is speaking. Defaults by state. */
  idleText?: string;
}

/** A call is on from the moment it's asked for until it ends or fails. */
export function useCallOn(): boolean {
  const { voice } = useAssistant();
  return voice.state !== "idle" && voice.state !== "error";
}

export function AssistantCall({ style, idleText }: AssistantCallProps) {
  const { voice, proposals, cardViews, respondToProposal, lastError } = useAssistant();
  const on = voice.state !== "idle" && voice.state !== "error";
  const ringRef = useRef<HTMLSpanElement>(null);
  const [held, setHeld] = useState("");
  // A request that failed says why on its own line (amendment 106), until the next request starts:
  // the voice says "the reason is on your screen", and in a call this is the screen.
  const [failed, setFailed] = useState<string | null>(null);
  useEffect(() => { if (on && lastError) setFailed(lastError); }, [on, lastError]);
  const was = useRef(voice.state);
  useEffect(() => {
    if (voice.state === "thinking" && was.current !== "thinking") setFailed(null);
    was.current = voice.state;
  }, [voice.state]);
  useEffect(() => { if (!on) setFailed(null); }, [on]);

  // The last spoken line stays until the next one starts.
  useEffect(() => { if (voice.caption) setHeld(voice.caption); }, [voice.caption]);
  useEffect(() => { if (!on) setHeld(""); }, [on]);

  // Follows the level without re-rendering, as the orb's ring does.
  useEffect(() => {
    if (!on || matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    let target = 0, current = 0, frame = 0;
    const off = voice.onLevel((source, level) => {
      if (source === "assistant" || voice.handsFree || voice.state === "recording") target = level;
    });
    const tick = () => {
      current += (target - current) * (target > current ? 0.45 : 0.12);
      target *= 0.92;
      if (ringRef.current) ringRef.current.style.transform = `scale(${1 + current * 0.38})`;
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => { off(); cancelAnimationFrame(frame); };
  }, [on, voice]);

  if (!on) return null;

  const state =
    voice.state === "connecting" ? "Setting up the microphone…"
    : voice.state === "thinking" ? "Thinking…"
    : voice.state === "recording" ? "Listening…"
    : voice.handsFree ? (voice.state === "speaking" ? "" : "Listening, just talk")
    : "Hold to talk";
  const line = voice.caption || held || idleText || state;
  const hold = !voice.handsFree && voice.state !== "connecting";

  return (
    <div role="region" aria-label="Voice call" style={{ ...styles.call, ...style }}>
      {proposals.length > 0 && (
        <div style={styles.cards}>
          {proposals.map((p) => <ConfirmationCard key={p.proposalId} proposal={p} view={cardViews[p.proposalId]} onRespond={respondToProposal} />)}
        </div>
      )}
      {failed && <p role="alert" style={styles.failed}>{failed}</p>}
      <div style={styles.bar}>
        <span style={styles.markWrap} aria-hidden="true">
          <span ref={ringRef} style={styles.ring} />
          <MiheMark size={26} body="#0f172a" voice="#007277" />
        </span>
        {/* Announced politely, and one line: the tail of a long sentence is the part being said. */}
        <span style={styles.line} aria-live="polite" title={line}>{tail(line)}</span>
        {hold && (
          <button
            type="button"
            style={{ ...styles.hold, ...(voice.state === "recording" ? styles.holdOn : null) }}
            aria-pressed={voice.state === "recording"}
            onPointerDown={(e) => { e.currentTarget.setPointerCapture?.(e.pointerId); voice.press(); }}
            onPointerUp={() => voice.release()}
            onPointerCancel={() => voice.release()}
            onKeyDown={(e) => { if (!e.repeat && (e.key === " " || e.key === "Enter")) { e.preventDefault(); voice.press(); } }}
            onKeyUp={(e) => { if (e.key === " " || e.key === "Enter") { e.preventDefault(); voice.release(); } }}
          >
            {voice.state === "recording" ? "Release to send" : "Hold to talk"}
          </button>
        )}
        <button type="button" style={styles.end} onClick={voice.stop}>End</button>
      </div>
    </div>
  );
}

/** One line: a long sentence keeps its end, where the speaking is. */
function tail(text: string, max = 90): string {
  const t = text.replace(/\s+/g, " ").trim();
  return t.length <= max ? t : `…${t.slice(t.length - max + 1).replace(/^\S*\s/, "")}`;
}

const FONT = "system-ui, -apple-system, 'Segoe UI', sans-serif";
const styles = {
  call: { display: "flex", flexDirection: "column", gap: 8, font: `14px/1.4 ${FONT}`, color: "#0f172a" },
  cards: { display: "flex", flexDirection: "column", gap: 8 },
  bar: { display: "flex", alignItems: "center", gap: 12, padding: "8px 8px 8px 12px", borderRadius: 999, background: "#fff", border: "1px solid rgba(15,23,42,0.1)", boxShadow: "0 6px 18px rgba(15,23,42,0.16)", minWidth: 0 },
  markWrap: { position: "relative", display: "grid", placeItems: "center", width: 36, height: 36, flex: "none" },
  ring: { position: "absolute", inset: 0, borderRadius: "50%", background: "rgba(0,114,119,0.14)", transition: "transform 60ms linear" },
  line: { flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  hold: { flex: "none", minHeight: 36, padding: "0 14px", borderRadius: 999, border: "1px solid #cbd5e1", background: "#fff", cursor: "pointer", font: `600 13px ${FONT}`, userSelect: "none", touchAction: "none" },
  holdOn: { background: "#007277", borderColor: "#007277", color: "#fff" },
  failed: { margin: 0, padding: "8px 12px", borderRadius: 10, background: "#fef2f2", color: "#991b1b", border: "1px solid #fecaca", font: `13px/1.4 ${FONT}` },
  end: { flex: "none", minHeight: 36, padding: "0 16px", borderRadius: 999, border: "none", background: "#b91c1c", color: "#fff", cursor: "pointer", font: `600 13px ${FONT}` },
} satisfies Record<string, CSSProperties>;
