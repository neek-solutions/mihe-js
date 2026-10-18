/**
 * What the launcher and the orb show: the host's own icon, the customer's
 * uploaded icon, or the Mihe mark on the brand's warm ink.
 */

import { h } from "./dom";
import { miheMark } from "./mark";
import { LAUNCHER_INK, LAUNCHER_VOICE } from "./styles";

/**
 * The uploaded image fills the circle, so what the dashboard's preview shows
 * is what a user sees. If it cannot load (a Content-Security-Policy that does
 * not allow the storage's domain, say), it falls back to the mark instead of
 * an empty circle: `onFail` is told which URL failed, and the next draw skips
 * it.
 */
export function launcherFace(
  override: Node | undefined,
  url: string | null,
  failed: string | null,
  onFail: (url: string) => void,
): Node {
  if (override) return override.cloneNode(true);
  if (url && url !== failed) {
    return h("img", {
      class: "launcher-image",
      attrs: { src: url, alt: "", draggable: "false" },
      on: { error: () => onFail(url) },
    });
  }
  return miheMark(34, LAUNCHER_INK, LAUNCHER_VOICE);
}
