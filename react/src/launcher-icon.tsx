/**
 * What the launcher and the orb show: the customer's uploaded icon, or the
 * Mihe mark on the brand's warm ink.
 */

import { useState, type CSSProperties } from "react";

import { MiheMark } from "./mark";

// The default launcher is the brand: warm ink, a light figure, verdigris arcs
// (the dashboard's dark-mode values, docs/README.md amendment 57).
export const LAUNCHER_BG = "#221f1b";
export const LAUNCHER_INK = "#eae7e4";
export const LAUNCHER_VOICE = "#5ac8cd";

/**
 * The uploaded icon, or the Mihe mark.
 *
 * The uploaded image fills the circle, so what the dashboard's preview shows
 * is what a user sees. If it cannot load (a host page whose
 * Content-Security-Policy does not allow the storage's domain, say), the
 * launcher falls back to the mark instead of becoming an empty circle.
 */
export function LauncherIcon({ url }: { url: string | null }) {
  const [failed, setFailed] = useState<string | null>(null);

  if (url && failed !== url) {
    return (
      <img
        src={url}
        alt=""
        draggable={false}
        onError={() => setFailed(url)}
        style={styles.launcherImage}
      />
    );
  }
  return <MiheMark size={34} body={LAUNCHER_INK} voice={LAUNCHER_VOICE} />;
}

const styles = {
  launcherImage: {
    width: "100%",
    height: "100%",
    objectFit: "cover",
    display: "block",
  },
} satisfies Record<string, CSSProperties>;
