/**
 * Building DOM without a framework, and without ever parsing a string.
 *
 * Text goes in as text nodes, so a product name holding `<img onerror=…>`
 * is shown as those characters and never runs: the card's firebreak depends
 * on it. Nothing in the widget sets `innerHTML`.
 */

type Child = Node | string | null | undefined | false;

export interface Props {
  class?: string;
  /** Set with `setAttribute`; `false` and `undefined` leave it off. */
  attrs?: Record<string, string | number | boolean | undefined>;
  on?: { [K in keyof HTMLElementEventMap]?: (event: HTMLElementEventMap[K]) => void };
}

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Props = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  if (props.class) element.className = props.class;
  setAttrs(element, props.attrs ?? {});
  for (const [type, listener] of Object.entries(props.on ?? {})) {
    element.addEventListener(type, listener as EventListener);
  }
  append(element, children);
  return element;
}

const SVG = "http://www.w3.org/2000/svg";

export function svg(tag: string, attrs: Record<string, string | number>, ...children: Node[]): SVGElement {
  const element = document.createElementNS(SVG, tag);
  for (const [name, value] of Object.entries(attrs)) element.setAttribute(name, String(value));
  for (const child of children) element.appendChild(child);
  return element;
}

export function setAttrs(element: Element, attrs: Record<string, string | number | boolean | undefined>): void {
  for (const [name, value] of Object.entries(attrs)) {
    if (value === undefined || value === false) element.removeAttribute(name);
    else element.setAttribute(name, value === true ? "" : String(value));
  }
}

export function append(element: Node, children: Child[]): void {
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    element.appendChild(typeof child === "string" ? document.createTextNode(child) : child);
  }
}

/** Replace an element's children. */
export function replace(element: Node, ...children: Child[]): void {
  while (element.firstChild) element.removeChild(element.firstChild);
  append(element, children);
}
