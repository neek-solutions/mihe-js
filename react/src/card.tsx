/**
 * The approval surface for a proposed action, shared by the panel and the orb.
 *
 * What it says comes from the card's view (amendment 99): the app's own
 * description of the input that will run, or the registry's display hints,
 * or, with neither, every field of the input by its key. Never the
 * assistant's prose, so text smuggled into a product name or a document
 * cannot change what a user is shown they are about to approve.
 */

import type { CSSProperties } from "react";

import { formatValue, hintedView, humanizeKey, type CardLine, type CardView, type ProposalPayload } from "@mihe-dev/js";

export { formatValue, humanizeKey };

const FONT = "system-ui, -apple-system, 'Segoe UI', sans-serif";

/**
 * The approval surface for a proposed action.
 *
 * High-risk actions require this tap — the runtime refuses a spoken or typed
 * "yes" for them — so this component is a security boundary, not decoration.
 * While the app is still describing it, Confirm is disabled: nobody confirms
 * a card whose words are about to change.
 */
export function ConfirmationCard({
  proposal,
  view = hintedView(proposal),
  onRespond,
}: {
  proposal: ProposalPayload;
  view?: CardView | "pending";
  onRespond: (proposalId: string, confirmed: boolean) => void;
}) {
  const pending = view === "pending";
  const v = pending ? null : view;
  const description = v && v.source !== "plain"
    ? <details style={styles.more}><summary style={{ cursor: "pointer" }}>More about this</summary><p style={{ ...styles.cardDescription, margin: "6px 0 0" }}>{proposal.description}</p></details>
    : <p style={styles.cardDescription}>{proposal.description}</p>;

  return (
    <div style={styles.card} role="group" aria-label={`Confirm: ${proposal.label}`} aria-busy={pending || undefined}>
      <div style={styles.cardHeader}>
        <strong>{proposal.label}</strong>
        <span
          style={{
            ...styles.riskBadge,
            background: proposal.risk === "high" ? "#fee2e2" : "#fef3c7",
            color: proposal.risk === "high" ? "#991b1b" : "#92400e",
          }}
        >
          {proposal.risk === "high" ? "Needs care" : "Confirm"}
        </span>
      </div>

      {pending && <p style={styles.cardDescription}>Checking the details…</p>}
      {v?.summary && <p style={styles.summary}>{v.summary}</p>}
      {v?.source === "plain" && description}

      {v && v.lines.length > 0 && (
        <dl style={styles.cardInput}>
          {v.lines.map((line, index) => <Line key={index} line={line} />)}
        </dl>
      )}

      {v?.note && <p style={styles.note}>{v.note}</p>}
      {v && v.source !== "plain" && description}

      <div style={styles.cardActions}>
        <button
          type="button"
          onClick={() => onRespond(proposal.proposalId, false)}
          style={styles.secondaryButton}
        >
          Cancel
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={() => { if (!pending) onRespond(proposal.proposalId, true); }}
          style={{ ...styles.primaryButton, ...(proposal.risk === "high" ? styles.dangerButton : {}), ...(pending ? { opacity: 0.5, cursor: "default" } : {}) }}
        >
          {v?.confirmLabel ?? "Confirm"}
        </button>
      </div>
    </div>
  );
}

/** One line: its label, then pictures, what it was and what it becomes, and any list (each entry checkable on its own). */
function Line({ line }: { line: CardLine }) {
  // With pictures: the pictures on the left, what they are beside them, so rows line up whatever the names.
  if (line.images?.length) {
    return (
      <div style={styles.mediaRow}>
        <span style={{ ...styles.images, marginBottom: 0, flex: "none", maxWidth: 140 }}>
          {line.images.map((im, i) => <img key={i} src={im.src} alt={im.alt ?? ""} loading="lazy" referrerPolicy="no-referrer" style={styles.image} />)}
        </span>
        <span style={styles.mediaText}>
          {line.label && <dt style={{ ...styles.cardKey, minWidth: 0, color: "#0f172a", fontWeight: 600 }}>{line.label}</dt>}
          <dd style={{ ...styles.cardValue, fontWeight: line.label ? 400 : 600, flex: "none" }}><Value line={line} /></dd>
        </span>
      </div>
    );
  }
  return (
    <div style={styles.cardRow}>
      {line.label && <dt style={styles.cardKey}>{line.label}</dt>}
      <dd style={line.label ? styles.cardValue : { ...styles.cardValue, flexBasis: "100%" }}>
        <Value line={line} />
      </dd>
    </div>
  );
}

/** What a line says: what it was, what it becomes, and any list. */
function Value({ line }: { line: CardLine }) {
  return (
    <>
        {line.before !== undefined && <><s style={styles.before}>{line.before}</s><span style={styles.before} aria-label="becomes"> → </span></>}
        {line.text !== undefined && <span style={styles.inputText}>{line.text}</span>}
        {!!line.items?.length && (
          <ol style={styles.inputList}>
            {line.items.map((item, index) => <li key={index}><span style={styles.inputText}>{item}</span></li>)}
          </ol>
        )}
    </>
  );
}

const styles = {
  card: {
    border: "1px solid #e2e8f0",
    borderRadius: 10,
    padding: 12,
    background: "#fff",
    boxShadow: "0 2px 8px rgba(15,23,42,0.06)",
  },
  cardHeader: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
    marginBottom: 6,
  },
  riskBadge: {
    fontSize: 11,
    fontWeight: 600,
    padding: "2px 8px",
    borderRadius: 999,
    whiteSpace: "nowrap",
  },
  summary: { margin: "0 0 10px", fontSize: 14, fontWeight: 600, color: "#0f172a" },
  note: { margin: "0 0 12px", fontSize: 12, color: "#64748b" },
  more: { margin: "0 0 12px", fontSize: 12, color: "#64748b" },
  cardDescription: { margin: "0 0 10px", color: "#475569", fontSize: 13 },
  cardInput: { margin: "0 0 12px", display: "flex", flexDirection: "column", gap: 8, maxHeight: "40vh", overflowY: "auto" },
  cardRow: { display: "flex", flexWrap: "wrap", gap: 8, fontSize: 13 },
  cardKey: { color: "#64748b", minWidth: 90, margin: 0 },
  cardValue: { margin: 0, fontWeight: 500, overflowWrap: "anywhere", minWidth: 0, flex: "1 1 160px" },
  images: { display: "flex", flexWrap: "wrap", gap: 4, marginBottom: 4 },
  mediaRow: { display: "flex", gap: 10, alignItems: "flex-start", fontSize: 13 },
  mediaText: { display: "flex", flexDirection: "column", gap: 2, minWidth: 0, flex: 1 },
  image: { width: 44, height: 44, objectFit: "cover", borderRadius: 6, background: "#f1f5f9" },
  before: { color: "#94a3b8", fontWeight: 400 },
  inputList: { margin: 0, paddingLeft: 20, display: "grid", gap: 8 },
  inputText: { whiteSpace: "pre-wrap" },
  cardActions: { display: "flex", gap: 8, justifyContent: "flex-end" },
  secondaryButton: {
    padding: "7px 14px",
    borderRadius: 8,
    border: "1px solid #cbd5e1",
    background: "#fff",
    cursor: "pointer",
    font: `500 13px ${FONT}`,
  },
  dangerButton: { background: "#dc2626" },
  primaryButton: {
    padding: "7px 14px",
    borderRadius: 8,
    border: "none",
    background: "#4f7cff",
    color: "#fff",
    cursor: "pointer",
    font: `600 13px ${FONT}`,
  },
} satisfies Record<string, CSSProperties>;
