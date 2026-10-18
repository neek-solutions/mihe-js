/**
 * The approval surface for a proposed action, shared by the panel and the orb.
 *
 * It renders `label`, `description` and `input` from the proposal payload,
 * which the runtime copies from its registry, never from the assistant's
 * prose. Text smuggled into a product name or a document therefore cannot
 * change what a user is shown they are about to approve.
 */

import type { CSSProperties } from "react";

import { formatValue, humanizeKey, type ProposalPayload } from "@mihe-dev/js";

export { formatValue, humanizeKey };

const FONT = "system-ui, -apple-system, 'Segoe UI', sans-serif";

/**
 * The approval surface for a proposed action.
 *
 * High-risk actions require this tap — the runtime refuses a spoken or typed
 * "yes" for them — so this component is a security boundary, not decoration.
 */
export function ConfirmationCard({
  proposal,
  onRespond,
}: {
  proposal: ProposalPayload;
  onRespond: (proposalId: string, confirmed: boolean) => void;
}) {
  const entries = Object.entries(proposal.input ?? {});

  return (
    <div style={styles.card} role="group" aria-label={`Confirm: ${proposal.label}`}>
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

      <p style={styles.cardDescription}>{proposal.description}</p>

      {entries.length > 0 && (
        <dl style={styles.cardInput}>
          {entries.map(([key, value]) => (
            <div key={key} style={styles.cardRow}>
              <dt style={styles.cardKey}>{humanizeKey(key)}</dt>
              <dd style={styles.cardValue}><InputValue value={value} /></dd>
            </div>
          ))}
        </dl>
      )}

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
          onClick={() => onRespond(proposal.proposalId, true)}
          style={styles.primaryButton}
        >
          Confirm
        </button>
      </div>
    </div>
  );
}

/** Lists stay separate so a user can check each line before approving. */
function InputValue({ value }: { value: unknown }) {
  if (Array.isArray(value) && value.length > 0) {
    return (
      <ol style={styles.inputList}>
        {value.map((item, index) => (
          <li key={index}><InputValue value={item} /></li>
        ))}
      </ol>
    );
  }
  return <span style={styles.inputText}>{formatValue(value)}</span>;
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
  cardDescription: { margin: "0 0 10px", color: "#475569", fontSize: 13 },
  cardInput: { margin: "0 0 12px", display: "flex", flexDirection: "column", gap: 8, maxHeight: "40vh", overflowY: "auto" },
  cardRow: { display: "flex", flexWrap: "wrap", gap: 8, fontSize: 13 },
  cardKey: { color: "#64748b", minWidth: 90, margin: 0 },
  cardValue: { margin: 0, fontWeight: 500, overflowWrap: "anywhere", minWidth: 0, flex: "1 1 160px" },
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
