/**
 * `mountCall`: a voice call on its own, anywhere on the page (amendment 107).
 * The JavaScript counterpart of the React SDK's `AssistantCall`, drawn by the
 * same call view the classic panel shows during a call, so the two can't
 * drift: the mark moving with whoever speaks, one line of what's said (the
 * last line held until the next begins), any card that needs a tap, the
 * reason a request failed, hold to talk when the call isn't hands-free, and
 * End.
 *
 * ```ts
 * import { createMihe, mountCall } from "@mihe-dev/js";
 * const mihe = createMihe({ … });
 * const call = mountCall(mihe);                                  // a bar at the foot of the window
 * mountCall(mihe, { layout: "inline", container: toolbarSlot }); // inside an element of yours
 * talkButton.onclick = () => mihe.voice.start({ handsFree: true, openPanel: false });
 * call.unmount();
 * ```
 *
 * It shows nothing while there is no call, so it can stay mounted. It starts
 * nothing: the app starts the call, from a button of its own. Rendered in a
 * shadow root like the widget, so the page's CSS can't reach it; themed with
 * the same custom properties, set on the element.
 */

import type { Mihe } from "../mihe";
import { h } from "./dom";
import { CallView } from "./panel";
import { STYLES } from "./styles";

export interface CallOptions {
  /**
   * `"floating"`, the default: a bar at the foot of the window, centred, up to
   * 560px wide, over the page. `"inline"`: inside `container`, as wide as it,
   * placed by the page's own layout.
   */
  layout?: "floating" | "inline";
  /** Where to put it. Default `document.body`; required in effect for `"inline"`. */
  container?: Element;
}

export interface MountedCall {
  /** The element holding the call (a `<div>` with a shadow root). Theme it with `--mihe-*` custom properties. */
  element: HTMLElement;
  /** Remove it. The assistant stays connected, and a call in progress goes on until it's ended. */
  unmount: () => void;
}

export function mountCall(mihe: Mihe, options: CallOptions = {}): MountedCall {
  const layout = options.layout ?? "floating";
  const element = document.createElement("div");
  element.setAttribute("data-mihe-call", layout);
  const shadow = element.attachShadow({ mode: "open" });
  const view = new CallView(mihe);
  view.root.classList.add("standalone");
  const host = h("div", { class: layout === "floating" ? "call-host-floating" : "call-host-inline" }, view.root);
  shadow.append(h("style", {}, STYLES), host);

  const render = () => {
    const state = mihe.getState();
    const on = state.voice.state !== "idle" && state.voice.state !== "error";
    // Nothing on the page while there's no call, not even an empty box. Inline, because a page's
    // own CSS (div { display: flex }) beats the hidden attribute.
    element.style.display = on ? "" : "none";
    view.update(state, on);
  };
  const unsubscribe = mihe.subscribe(render);
  render();
  (options.container ?? document.body).appendChild(element);

  return {
    element,
    unmount: () => {
      unsubscribe();
      view.update(mihe.getState(), false);
      element.remove();
    },
  };
}
