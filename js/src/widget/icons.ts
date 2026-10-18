/** The orb menu's icons, the same strokes as the React SDK's. */

import { svg } from "./dom";

function icon(...children: SVGElement[]): SVGElement {
  return svg(
    "svg",
    {
      viewBox: "0 0 20 20",
      width: 18,
      height: 18,
      fill: "none",
      stroke: "currentColor",
      "stroke-width": 1.7,
      "stroke-linecap": "round",
      "stroke-linejoin": "round",
      "aria-hidden": "true",
    },
    ...children,
  );
}

export const chatIcon = () =>
  icon(svg("path", { d: "M4 4.5h12a1.5 1.5 0 0 1 1.5 1.5v7a1.5 1.5 0 0 1-1.5 1.5H9l-4 3v-3H4A1.5 1.5 0 0 1 2.5 13V6A1.5 1.5 0 0 1 4 4.5Z" }));

export const micIcon = () =>
  icon(
    svg("rect", { x: 7, y: 2.5, width: 6, height: 10, rx: 3 }),
    svg("path", { d: "M4.5 9.5a5.5 5.5 0 0 0 11 0M10 15v2.5" }),
  );

export const waveIcon = () => icon(svg("path", { d: "M3 10v0M6.5 7v6M10 4v12M13.5 7v6M17 10v0" }));
