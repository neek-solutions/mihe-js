/**
 * `<mihe-assistant>`: the widget as a web component, for any page and any
 * framework (doc 08). The orb by default, or the classic launcher and panel,
 * or just the panel inside a container of the host's.
 *
 * ```ts
 * import { createMihe, mountWidget } from "@mihe-dev/js";
 * const mihe = createMihe({ … });
 * mountWidget(mihe);                                           // floating
 * mountWidget(mihe, { layout: "inline", container: sidebar }); // in a sidebar
 * ```
 *
 * Or in HTML, connected by script:
 *
 * ```html
 * <mihe-assistant form="classic" corner="bottom-left"></mihe-assistant>
 * <script type="module">
 *   defineMiheAssistant();
 *   document.querySelector("mihe-assistant").mihe = createMihe({ … });
 * </script>
 * ```
 *
 * Everything renders in a shadow root, so the host page's CSS cannot reach
 * it. One consequence: the panel's id is inside the shadow root, so a host
 * trigger's `aria-controls` cannot point at it.
 *
 * The class is defined when `defineMiheAssistant` first runs, never on
 * import: importing must work where `HTMLElement` does not exist, such as a
 * server render, and must not register anything a page did not ask for.
 */

import type { VoiceMode, WidgetCorner, WidgetForm, WidgetSettings } from "@mihe-dev/protocol";

import type { Mihe } from "../mihe";
import { h, replace, setAttrs } from "./dom";
import { launcherFace } from "./launcher";
import { Orb } from "./orb";
import { DEFAULT_VOICE_MODES, Panel } from "./panel";
import { STYLES } from "./styles";

export const ELEMENT_NAME = "mihe-assistant";

export interface WidgetOptions {
  /**
   * `"floating"`, the default: the orb or launcher, and a panel over the
   * page. `"inline"`: the panel alone, filling the element, for a sidebar or
   * a drawer the host app owns.
   */
  layout?: "floating" | "inline";
  /** Header title, and the launcher's accessible name. The app's assistant name otherwise. */
  title?: string;
  placeholder?: string;
  /** Show the orb or launcher. Off when the host app has its own trigger. */
  showLauncher?: boolean;
  /** Open on first mount. */
  defaultOpen?: boolean;
  /** Inline only: a close button in the header. */
  showClose?: boolean;
  /** Drawn in the orb or launcher in place of the uploaded icon. Cloned. */
  launcherIcon?: Node;
  /**
   * How far the orb, launcher and floating panel sit from the bottom and side
   * edges, in pixels; 20 by default. For a page with its own floating widget
   * in the same corner, such as a support chat: lift Mihe above it rather
   * than stacking the two.
   */
  offset?: { bottom?: number; side?: number };
  /*
   * The four below are settings in the dashboard (amendment 61), delivered
   * with the handshake. One passed here overrides the setting, except that
   * voice modes only narrow it: the runtime refuses a mode the app has not
   * allowed.
   */
  form?: WidgetForm;
  draggable?: boolean;
  corner?: WidgetCorner;
  voiceModes?: VoiceMode[];
}

/** `<mihe-assistant>`, once defined. */
export interface MiheAssistantElement extends HTMLElement {
  /** The assistant it draws. Setting it connects the element. */
  mihe: Mihe | null;
  /** Merged over the element's attributes. */
  options: WidgetOptions;
}

/** A setting passed in code, the app's setting otherwise, the SDK's default last. */
function resolve(options: WidgetOptions, settings: WidgetSettings | null) {
  const allowed = settings?.voiceModes ?? DEFAULT_VOICE_MODES;
  return {
    form: options.form ?? settings?.form ?? "orb",
    draggable: options.draggable ?? settings?.draggable ?? false,
    corner: options.corner ?? settings?.corner ?? "bottom-right",
    voiceModes: options.voiceModes ? options.voiceModes.filter((mode) => allowed.includes(mode)) : allowed,
  };
}

/** Options written as attributes, for a widget placed in HTML. */
function fromAttributes(element: HTMLElement): WidgetOptions {
  const read = (name: string) => element.getAttribute(name) ?? undefined;
  const flag = (name: string) => (element.hasAttribute(name) ? read(name) !== "false" : undefined);
  const modes = read("voice-modes");
  return {
    layout: read("layout") as WidgetOptions["layout"],
    // Not `title`, which every element already has as its tooltip.
    title: read("heading"),
    placeholder: read("placeholder"),
    showLauncher: flag("show-launcher"),
    defaultOpen: flag("default-open"),
    showClose: flag("show-close"),
    form: read("form") as WidgetForm | undefined,
    draggable: flag("draggable"),
    corner: read("corner") as WidgetCorner | undefined,
    offset:
      read("offset-bottom") === undefined && read("offset-side") === undefined
        ? undefined
        : {
            bottom: read("offset-bottom") === undefined ? undefined : Number(read("offset-bottom")),
            side: read("offset-side") === undefined ? undefined : Number(read("offset-side")),
          },
    voiceModes: modes === undefined ? undefined : (modes.split(/[\s,]+/).filter(Boolean) as VoiceMode[]),
  };
}

function withoutUndefined(options: WidgetOptions): WidgetOptions {
  return Object.fromEntries(Object.entries(options).filter(([, value]) => value !== undefined));
}

/** Register `<mihe-assistant>`. Safe to call more than once. */
export function defineMiheAssistant(): void {
  if (typeof customElements === "undefined" || customElements.get(ELEMENT_NAME)) return;

  class Element extends HTMLElement implements MiheAssistantElement {
    static observedAttributes = [
      "layout",
      "heading",
      "placeholder",
      "show-launcher",
      "default-open",
      "show-close",
      "form",
      "draggable",
      "corner",
      "voice-modes",
      "offset-bottom",
      "offset-side",
    ];

    private assistant: Mihe | null = null;
    private ownOptions: WidgetOptions = {};
    private unsubscribe: (() => void) | null = null;
    private shadow: ShadowRoot | null = null;
    private panel: Panel | null = null;
    private orb: Orb | null = null;
    private launcher: HTMLButtonElement | null = null;
    private launcherKey: unknown[] = [];
    private failedIcon: string | null = null;
    private openedByDefault = false;

    get mihe(): Mihe | null {
      return this.assistant;
    }

    set mihe(value: Mihe | null) {
      if (value === this.assistant) return;
      this.disconnectAssistant();
      this.assistant = value;
      if (this.isConnected) this.connectAssistant();
    }

    get options(): WidgetOptions {
      return this.ownOptions;
    }

    set options(value: WidgetOptions) {
      this.ownOptions = { ...value };
      this.render();
    }

    connectedCallback(): void {
      if (!this.shadow) {
        this.shadow = this.attachShadow({ mode: "open" });
        this.shadow.appendChild(h("style", {}, STYLES));
      }
      this.connectAssistant();
    }

    disconnectedCallback(): void {
      this.disconnectAssistant();
    }

    attributeChangedCallback(): void {
      this.render();
    }

    private connectAssistant(): void {
      if (!this.assistant || this.unsubscribe || !this.shadow) return;
      const mihe = this.assistant;
      this.panel = new Panel(mihe, { showClose: true, showVoice: true });
      this.shadow.appendChild(this.panel.root);
      this.unsubscribe = mihe.subscribe(() => this.render());
      // Honoured once. After that the assistant owns open and closed, so a
      // host trigger and this option cannot fight over it.
      if (this.resolved().defaultOpen && !this.openedByDefault) {
        this.openedByDefault = true;
        mihe.open();
      }
      this.render();
    }

    private disconnectAssistant(): void {
      this.unsubscribe?.();
      this.unsubscribe = null;
      this.orb?.destroy();
      for (const part of [this.panel?.root, this.orb?.root, this.launcher]) part?.remove();
      this.panel = null;
      this.orb = null;
      this.launcher = null;
      this.launcherKey = [];
    }

    private resolved(): WidgetOptions {
      return { ...withoutUndefined(fromAttributes(this)), ...withoutUndefined(this.ownOptions) };
    }

    private render(): void {
      const mihe = this.assistant;
      if (!mihe || !this.shadow || !this.panel) return;
      const state = mihe.getState();
      const options = this.resolved();
      const widget = resolve(options, state.widgetSettings);
      const heading = options.title ?? state.assistantName ?? "Assistant";
      const offset = { bottom: options.offset?.bottom ?? 20, side: options.offset?.side ?? 20 };
      const showLauncher = options.showLauncher ?? true;
      const panel = this.panel;

      if (options.layout === "inline") {
        // For `:host([layout="inline"])`. Set only when missing, because
        // setting an observed attribute calls back into this render.
        if (this.getAttribute("layout") !== "inline") this.setAttribute("layout", "inline");
        panel.setOptions({
          title: options.title,
          placeholder: options.placeholder,
          showClose: options.showClose ?? false,
          showVoice: true,
        });
        panel.root.classList.remove("floating", "left", "right");
        panel.root.removeAttribute("style");
        panel.root.hidden = false;
        panel.update(state);
        this.hideOrb();
        if (this.launcher) this.launcher.hidden = true;
        return;
      }

      if (widget.form === "orb") {
        if (this.launcher) this.launcher.hidden = true;
        if (!this.orb) {
          this.orb = new Orb(mihe);
          this.shadow.appendChild(this.orb.root);
        }
        this.orb.update(state, {
          heading,
          draggable: widget.draggable,
          corner: widget.corner,
          voiceModes: widget.voiceModes,
          launcherIcon: options.launcherIcon,
          offset,
        });
        // Chat open: the panel takes the orb's place, on the orb's side.
        // Voice is the orb's, so the panel has no microphone.
        this.orb.root.hidden = state.isOpen || !showLauncher;
        this.showPanel(state.isOpen, this.orb.side(), offset, {
          title: options.title,
          placeholder: options.placeholder,
          showClose: true,
          showVoice: false,
        });
        return;
      }

      this.hideOrb();
      this.showPanel(state.isOpen, "right", offset, {
        title: options.title,
        placeholder: options.placeholder,
        showClose: true,
        showVoice: true,
      });
      const launcher = this.drawLauncher(heading, options.launcherIcon, state.launcherIconUrl);
      launcher.hidden = state.isOpen || !showLauncher;
      launcher.style.bottom = `${offset.bottom}px`;
      launcher.style.right = `${offset.side}px`;
    }

    private showPanel(
      open: boolean,
      side: "left" | "right",
      offset: { bottom: number; side: number },
      options: ConstructorParameters<typeof Panel>[1],
    ) {
      const panel = this.panel!;
      panel.root.hidden = !open;
      panel.root.classList.add("floating");
      panel.root.style.bottom = `${offset.bottom}px`;
      panel.root.style.left = side === "left" ? `${offset.side}px` : "";
      panel.root.style.right = side === "right" ? `${offset.side}px` : "";
      // The panel keeps to the viewport however far it is lifted.
      panel.root.style.height = `min(560px, calc(100vh - ${offset.bottom + 20}px))`;
      panel.setOptions(options);
      panel.update(this.assistant!.getState());
    }

    private hideOrb(): void {
      if (this.orb) this.orb.root.hidden = true;
    }

    private drawLauncher(heading: string, icon: Node | undefined, url: string | null): HTMLButtonElement {
      if (!this.launcher) {
        this.launcher = h("button", {
          class: "launcher",
          attrs: { type: "button", "aria-controls": "mihe-panel", "aria-expanded": "false" },
          on: { click: () => this.assistant?.open() },
        });
        this.shadow!.appendChild(this.launcher);
      }
      setAttrs(this.launcher, { "aria-label": `Open ${heading}` });
      const key = [icon, url, this.failedIcon];
      if (key.some((value, index) => value !== this.launcherKey[index])) {
        this.launcherKey = key;
        replace(
          this.launcher,
          launcherFace(icon, url, this.failedIcon, (failed) => {
            this.failedIcon = failed;
            this.render();
          }),
        );
      }
      return this.launcher;
    }
  }

  customElements.define(ELEMENT_NAME, Element);
}

export interface MountedWidget {
  element: MiheAssistantElement;
  /** Remove the widget. The assistant stays connected. */
  unmount: () => void;
}

/**
 * Put the widget on the page: floating over it by default, or inline in
 * `container` with `layout: "inline"`.
 */
export function mountWidget(
  mihe: Mihe,
  options: WidgetOptions & { container?: Element } = {},
): MountedWidget {
  defineMiheAssistant();
  const { container, ...widget } = options;
  const element = document.createElement(ELEMENT_NAME) as MiheAssistantElement;
  element.options = widget;
  element.mihe = mihe;
  (container ?? document.body).appendChild(element);
  return { element, unmount: () => element.remove() };
}
