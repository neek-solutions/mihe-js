/**
 * The highlight and focus engine (spec §12).
 *
 * Draws an overlay over a registered element rather than mutating the
 * element's own styles. Two reasons: the host app's CSS is not ours to touch,
 * and an overlay cannot leave residue if the SDK unmounts mid-tutorial.
 *
 * Elements are found by the `data-mihe-component` attribute that
 * `useAssistantComponent` spreads onto them. Never by CSS selector or
 * position — the assistant points at things the app has declared, and at
 * nothing else.
 */

export const COMPONENT_ATTRIBUTE = "data-mihe-component";

const OVERLAY_ID = "mihe-highlight";
const PADDING = 6;

/**
 * Whether clicking this element does something, rather than merely selecting
 * it. Buttons and links act; inputs and containers receive.
 *
 * Read from the element rather than from the registry's `ComponentType`
 * because the overlay is drawn over whatever the app spread the attribute
 * onto, which is not always the element the declaration describes — a label
 * carrying the props for the input beside it, for instance.
 */
function activates(element: HTMLElement | null): boolean {
  if (!element) return false;
  if (element.closest("button, a[href], [role='button'], [role='link']")) return true;
  return false;
}

export function findComponent(componentKey: string): HTMLElement | null {
  return document.querySelector<HTMLElement>(
    `[${COMPONENT_ATTRIBUTE}="${CSS.escape(componentKey)}"]`,
  );
}

export class HighlightEngine {
  private overlay: HTMLElement | null = null;
  private caption: HTMLElement | null = null;
  private target: HTMLElement | null = null;
  private tracking = false;
  private observer: MutationObserver | null = null;
  private frame = 0;

  /** Draw attention to a component. Returns false if it is not on the page. */
  highlight(componentKey: string, message?: string): boolean {
    const target = findComponent(componentKey);
    if (!target) return false;

    this.target = target;
    this.ensureOverlay();
    this.setCaption(message);
    this.position();
    this.startTracking();

    target.scrollIntoView({ behavior: "smooth", block: "center" });
    return true;
  }

  /** Move keyboard focus into a component, highlighting it too. */
  focus(componentKey: string, message?: string): boolean {
    const target = findComponent(componentKey);
    if (!target) return false;

    this.highlight(componentKey, message);
    // A wrapper may be registered rather than the input itself; focus the
    // first focusable descendant when the element cannot take focus.
    const focusable =
      target.matches("input, textarea, select, button, [tabindex]")
        ? target
        : target.querySelector<HTMLElement>(
            "input, textarea, select, button, [tabindex]",
          );
    focusable?.focus();
    return true;
  }

  scrollTo(componentKey: string): boolean {
    const target = findComponent(componentKey);
    if (!target) return false;
    target.scrollIntoView({ behavior: "smooth", block: "center" });
    return true;
  }

  clear(): void {
    this.stopTracking();
    this.overlay?.remove();
    this.overlay = null;
    this.caption = null;
    this.target = null;
  }

  private ensureOverlay(): void {
    if (this.overlay) return;

    const overlay = document.createElement("div");
    overlay.id = OVERLAY_ID;
    // `pointer-events: none` is load-bearing: the highlight must never
    // intercept the click it is asking the user to make.
    Object.assign(overlay.style, {
      position: "fixed",
      zIndex: "2147483000",
      pointerEvents: "none",
      border: "2px solid #4f7cff",
      borderRadius: "8px",
      boxShadow: "0 0 0 9999px rgba(15, 23, 42, 0.45)",
      transition: "top 120ms ease, left 120ms ease, width 120ms ease, height 120ms ease",
    } satisfies Partial<CSSStyleDeclaration>);

    const caption = document.createElement("div");
    Object.assign(caption.style, {
      position: "absolute",
      left: "0",
      top: "100%",
      marginTop: "8px",
      maxWidth: "260px",
      padding: "8px 10px",
      borderRadius: "8px",
      background: "#0f172a",
      color: "#f8fafc",
      font: "500 13px/1.4 system-ui, -apple-system, sans-serif",
      display: "none",
    } satisfies Partial<CSSStyleDeclaration>);

    overlay.appendChild(caption);
    document.body.appendChild(overlay);

    this.overlay = overlay;
    this.caption = caption;
  }

  private setCaption(message?: string): void {
    if (!this.caption) return;
    if (message) {
      this.caption.textContent = message;
      this.caption.style.display = "block";
    } else {
      this.caption.textContent = "";
      this.caption.style.display = "none";
    }
  }

  private position = (): void => {
    if (!this.overlay || !this.target) return;

    // The element may have unmounted since the highlight was drawn.
    if (!this.target.isConnected) {
      this.clear();
      return;
    }

    const rect = this.target.getBoundingClientRect();
    Object.assign(this.overlay.style, {
      top: `${rect.top - PADDING}px`,
      left: `${rect.left - PADDING}px`,
      width: `${rect.width + PADDING * 2}px`,
      height: `${rect.height + PADDING * 2}px`,
    });
  };

  /** Coalesced, because a MutationObserver can fire many times per render. */
  private reposition = (): void => {
    if (this.frame) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      this.position();
    });
  };

  /** Escape is the universal "get this off my screen". */
  private onKeyDown = (event: KeyboardEvent): void => {
    if (event.key === "Escape") this.clear();
  };

  /**
   * Any click outside the target dismisses.
   *
   * The overlay dims the whole page, so it reads as a modal — but it is
   * `pointer-events: none`, so clicks reach the app underneath. Without this
   * the user clicks away, the app responds, and the dim stays: it looks
   * dismissible and is not. Clicks on the target itself are left alone, since
   * that is the click the highlight is asking for and the app's own handler
   * usually removes the highlight's reason for existing anyway.
   */
  /**
   * A click ends the highlight, with one exception that has an exception.
   *
   * Clicking away dismisses it: the user has moved on and a ring around
   * something they are no longer looking at is clutter.
   *
   * Clicking *inside* the target does not, because the target is often an
   * input the user has just been asked to fill — losing the marker the moment
   * they click into the field would undo the pointing.
   *
   * But if the target is something clicking *activates* — a button, a link —
   * then the click was the action, and the highlight has done its job. Without
   * this the ring survives the thing it pointed at: the assistant highlighted
   * "Receive Stock", the user clicked, the form opened, and the outline stayed
   * behind the dialog pointing at a button nobody needed any more.
   */
  private onPointerDown = (event: Event): void => {
    const node = event.target;
    const inside = node instanceof Node && this.target?.contains(node);
    if (inside && !activates(this.target)) return;
    this.clear();
  };

  /**
   * Keep the overlay glued to its target, and remove it when the target goes.
   *
   * Scroll and resize are listened to rather than polled; `capture: true` on
   * scroll catches scrolling inside containers, not just the window.
   *
   * The MutationObserver is what makes the overlay mortal. `position` already
   * clears when the target has left the DOM, but it only ran on scroll and
   * resize — so a highlighted element that unmounted while the page sat still
   * (a form closing after submit, say) left the overlay stranded over the page
   * with no way to dismiss it.
   */
  private startTracking(): void {
    if (this.tracking) return;
    this.tracking = true;
    window.addEventListener("scroll", this.position, { passive: true, capture: true });
    window.addEventListener("resize", this.position, { passive: true });
    window.addEventListener("keydown", this.onKeyDown);
    // Capture, so the app's own handlers cannot stop it from reaching us.
    window.addEventListener("pointerdown", this.onPointerDown, { capture: true });

    this.observer = new MutationObserver(this.reposition);
    this.observer.observe(document.body, { childList: true, subtree: true });
  }

  private stopTracking(): void {
    if (!this.tracking) return;
    this.tracking = false;
    window.removeEventListener("scroll", this.position, { capture: true });
    window.removeEventListener("resize", this.position);
    window.removeEventListener("keydown", this.onKeyDown);
    window.removeEventListener("pointerdown", this.onPointerDown, { capture: true });

    this.observer?.disconnect();
    this.observer = null;
    if (this.frame) {
      cancelAnimationFrame(this.frame);
      this.frame = 0;
    }
  }
}
