/**
 * The widget's stylesheet, inside its shadow root.
 *
 * The shadow root is what keeps the host page out: a Tailwind reset or a
 * site's `button { … }` cannot select anything in here, and nothing here can
 * select the page. Inherited properties still cross the boundary, which is
 * why `:host` resets them all.
 *
 * Theming is through custom properties set on the element, the one styling
 * hook a shadow root lets through by design:
 *
 * ```css
 * mihe-assistant { --mihe-accent: #0a7d5a; --mihe-radius: 10px; }
 * ```
 *
 * The values match the React widget's.
 */

export const LAUNCHER_BG = "#221f1b";
export const LAUNCHER_INK = "#eae7e4";
export const LAUNCHER_VOICE = "#5ac8cd";

export const STYLES = `
:host {
  all: initial;
  --mihe-accent: #4f7cff;
  --mihe-radius: 14px;
  --mihe-font: system-ui, -apple-system, 'Segoe UI', sans-serif;
  --mihe-z: 2147482000;
}
:host([layout="inline"]) { display: block; width: 100%; height: 100%; }
*, *::before, *::after { box-sizing: border-box; }
[hidden] { display: none !important; }
button { font: inherit; color: inherit; margin: 0; }

.panel {
  display: flex; flex-direction: column; width: 100%; height: 100%;
  background: #fff; color: #0f172a;
  border-radius: var(--mihe-radius); border: 1px solid #e2e8f0;
  box-shadow: 0 20px 50px rgba(15,23,42,0.22);
  font: 14px/1.5 var(--mihe-font); overflow: hidden;
}
.floating {
  position: fixed; bottom: 20px;
  width: min(380px, calc(100vw - 40px)); height: min(560px, calc(100vh - 40px));
  z-index: var(--mihe-z);
}
.floating.right { right: 20px; }
.floating.left { left: 20px; }
.header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 12px 14px; border-bottom: 1px solid #e2e8f0; font-weight: 600;
}
.header-title { display: flex; align-items: center; gap: 8px; }
.status-dot { width: 8px; height: 8px; border-radius: 50%; display: inline-block; background: #f59e0b; }
.status-dot.open { background: #22c55e; }
.icon-button { border: none; background: transparent; cursor: pointer; font-size: 14px; color: #64748b; }
.transcript { flex: 1; overflow-y: auto; padding: 14px; display: flex; flex-direction: column; gap: 10px; }
.empty { color: #64748b; margin: 0; }
.bubble-user, .bubble-assistant { max-width: 85%; padding: 8px 12px; white-space: pre-wrap; overflow-wrap: anywhere; }
.bubble-user { align-self: flex-end; background: var(--mihe-accent); color: #fff; border-radius: 12px 12px 2px 12px; }
.bubble-assistant { align-self: flex-start; background: #f1f5f9; border-radius: 12px 12px 12px 2px; }
.thinking { color: #64748b; font-style: italic; }
.sources { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; padding-top: 8px; border-top: 1px solid #e2e8f0; }
.source { font-size: 11px; color: #475569; background: #f1f5f9; padding: 2px 8px; border-radius: 999px; }
.source a { color: inherit; text-decoration: none; }
.error { background: #fef2f2; color: #991b1b; padding: 8px 10px; border-radius: 8px; font-size: 13px; }
.notice { color: #64748b; font-size: 13px; text-align: center; }
.voice-notice { background: #f1f5f9; color: #475569; padding: 8px 10px; border-radius: 8px; font-size: 13px; }
.composer { display: flex; gap: 8px; padding: 12px; border-top: 1px solid #e2e8f0; }
.input {
  flex: 1; min-width: 0; padding: 9px 12px; border-radius: 8px; border: 1px solid #cbd5e1;
  font: 14px var(--mihe-font); color: #0f172a; background: #fff; outline: none;
}
.send {
  padding: 9px 16px; border-radius: 8px; border: none; background: var(--mihe-accent);
  color: #fff; cursor: pointer; font: 600 13px var(--mihe-font);
}
.send:disabled { opacity: 0.6; cursor: default; }
.mic {
  width: 38px; border-radius: 8px; border: 1px solid #cbd5e1; background: #fff; cursor: pointer;
  font-size: 16px; user-select: none; -webkit-user-select: none; touch-action: none;
}
.mic.live { border-color: var(--mihe-accent); }
.mic.recording { border-color: #dc2626; background: #fef2f2; }
.hands-free {
  width: 30px; border-radius: 8px; border: 1px solid #cbd5e1; background: #fff; color: #475569;
  cursor: pointer; font-size: 15px; user-select: none; -webkit-user-select: none;
}
.pulse {
  display: block; width: 12px; height: 12px; margin: 0 auto; border-radius: 50%;
  background: var(--mihe-accent); animation: mihe-pulse 2s ease-in-out infinite;
}
.pulse.fast { animation-duration: 0.8s; }
@keyframes mihe-pulse { 0%, 100% { transform: scale(1); opacity: 1; } 50% { transform: scale(0.6); opacity: 0.45; } }

.card {
  border: 1px solid #e2e8f0; border-radius: 10px; padding: 12px; background: #fff; color: #0f172a;
  box-shadow: 0 2px 8px rgba(15,23,42,0.06); font: 14px/1.5 var(--mihe-font);
}
.card-header { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 6px; }
.risk { font-size: 11px; font-weight: 600; padding: 2px 8px; border-radius: 999px; white-space: nowrap; background: #fef3c7; color: #92400e; }
.risk-high { background: #fee2e2; color: #991b1b; }
.card-description { margin: 0 0 10px; color: #475569; font-size: 13px; }
.card-input { margin: 0 0 12px; display: flex; flex-direction: column; gap: 8px; max-height: 40vh; overflow-y: auto; }
.card-row { display: flex; flex-wrap: wrap; gap: 8px; font-size: 13px; }
.card-key { color: #64748b; min-width: 90px; margin: 0; }
.card-value { margin: 0; font-weight: 500; overflow-wrap: anywhere; min-width: 0; flex: 1 1 160px; }
.input-list { margin: 0; padding-left: 20px; display: grid; gap: 8px; }
.input-text { white-space: pre-wrap; }
.card-actions { display: flex; gap: 8px; justify-content: flex-end; }
.button-secondary {
  padding: 7px 14px; border-radius: 8px; border: 1px solid #cbd5e1; background: #fff;
  cursor: pointer; font: 500 13px var(--mihe-font);
}
.button-primary {
  padding: 7px 14px; border-radius: 8px; border: none; background: var(--mihe-accent); color: #fff;
  cursor: pointer; font: 600 13px var(--mihe-font);
}

.launcher {
  position: fixed; right: 20px; bottom: 20px; width: 52px; height: 52px; border-radius: 50%;
  border: none; padding: 0; display: grid; place-items: center; overflow: hidden;
  background: ${LAUNCHER_BG}; color: ${LAUNCHER_INK}; cursor: pointer;
  box-shadow: 0 8px 24px rgba(15,23,42,0.25); z-index: var(--mihe-z);
}
.launcher-image { width: 100%; height: 100%; object-fit: cover; display: block; }

.orb {
  position: fixed; width: 56px; height: 56px; padding: 0; border: none; border-radius: 50%;
  background: ${LAUNCHER_BG}; color: ${LAUNCHER_INK}; box-shadow: 0 8px 24px rgba(15,23,42,0.25);
  z-index: var(--mihe-z); cursor: pointer; transition: left 180ms ease, top 180ms ease;
  touch-action: none; user-select: none; -webkit-user-select: none; -webkit-touch-callout: none;
  -webkit-tap-highlight-color: transparent;
}
.orb.dragging { cursor: grabbing; transition: none; }
.orb:disabled { cursor: default; }
.face { position: absolute; inset: 0; display: grid; place-items: center; border-radius: 50%; overflow: hidden; pointer-events: none; }
.ring {
  position: absolute; inset: -6px; border-radius: 50%; border: 2px solid ${LAUNCHER_VOICE};
  pointer-events: none; transform-origin: center; will-change: transform;
}
.ring.idle { border-color: transparent; }
.ring.recording { border-color: #e5484d; border-width: 3px; }
.ring.thinking, .ring.connecting { border-style: dashed; }
.ring.listening { animation: mihe-orb-breathe 2.4s ease-in-out infinite; }
.ring.thinking { animation: mihe-orb-spin 1.2s linear infinite; }
.ring.connecting { animation: mihe-orb-spin 2.4s linear infinite; }
@keyframes mihe-orb-breathe { 0%, 100% { opacity: 0.55; } 50% { opacity: 1; } }
@keyframes mihe-orb-spin { to { rotate: 360deg; } }
.stop {
  position: fixed; width: 44px; height: 44px; border-radius: 50%; border: 1px solid rgba(15,23,42,0.12);
  background: #fff; box-shadow: 0 4px 14px rgba(15,23,42,0.18); display: grid; place-items: center;
  cursor: pointer; z-index: var(--mihe-z);
}
.stop-square { width: 12px; height: 12px; border-radius: 2px; background: #0f172a; }
.popover {
  position: fixed; max-width: min(340px, calc(100vw - 40px)); z-index: calc(var(--mihe-z) + 1);
  display: flex; flex-direction: column; gap: 8px; font: 14px/1.45 var(--mihe-font);
}
.popover.cards { width: 320px; }
.menu-item {
  display: inline-flex; align-items: center; gap: 10px; min-height: 44px; padding: 0 16px 0 6px;
  border-radius: 999px; border: 1px solid rgba(15,23,42,0.1); background: #fff; color: #0f172a;
  box-shadow: 0 6px 18px rgba(15,23,42,0.16); cursor: pointer; font: 500 14px var(--mihe-font);
}
.menu-icon {
  display: grid; place-items: center; width: 34px; height: 34px; border-radius: 50%;
  background: ${LAUNCHER_BG}; color: ${LAUNCHER_VOICE};
}
.orb-bubble {
  padding: 8px 12px; border-radius: 12px; background: #fff; color: #0f172a;
  border: 1px solid rgba(15,23,42,0.1); box-shadow: 0 6px 18px rgba(15,23,42,0.16);
}
.orb-bubble.error { background: #fef2f2; color: #991b1b; border-color: #fecaca; }

@media (prefers-reduced-motion: reduce) {
  .pulse, .ring { animation: none !important; }
  .ring { transform: none !important; }
  .orb { transition: none; }
}
`;
