/**
 * @mihe-dev/js — an app-aware AI assistant for any web app (doc 08).
 *
 * Three things to wire up:
 *
 * 1. `createMihe({ url, publicKey, getUserToken, navigate })` once, at boot.
 * 2. `mihe.setScreen(…)` on each page so the assistant knows where the user
 *    is, keeping the returned function for when they leave.
 * 3. `mihe.registerComponent(…)` on the elements it should be able to point
 *    at, and `mihe.registerAction(…)` for anything it should be able to run.
 *
 * Then `mountWidget(mihe)` for the orb, or draw your own UI from
 * `mihe.getState()`.
 *
 * The assistant reasons; your app executes. It can only navigate to screens
 * you registered, point at components you declared, and run actions you
 * handled — there is no path by which it drives your UI directly.
 */

export { Mihe, createMihe, SDK_VERSION, ASSISTANT_PANEL_ID } from "./mihe";
export type { ChatMessage, MiheOptions, MiheState, VoiceControls } from "./mihe";

export {
  chartDeclaration,
  chartSignature,
  tableDeclaration,
  tableSignature,
  tabsDeclaration,
  tabsSignature,
} from "./declarations";
export type {
  AssistantChart,
  AssistantQueryParam,
  AssistantTable,
  AssistantTableColumn,
  AssistantTableQuery,
  AssistantTabs,
} from "./declarations";

export { mountWidget, defineMiheAssistant, ELEMENT_NAME } from "./widget/element";
export type { MiheAssistantElement, MountedWidget, WidgetOptions } from "./widget/element";
export { formatValue, humanizeKey } from "./widget/format";

export { VoiceSession, voiceUrl } from "./voice";
export type { VoiceEvent, VoiceState, VoiceSessionOptions } from "./voice";

export { MicrophoneCapture, SpeakerQueue, toPcm16, fromPcm16 } from "./audio";

export { AssistantStore } from "./store";
export type {
  ActionHandler,
  ComponentDeclaration,
  ScreenDeclaration,
  ChartDeclaration,
  TableDeclaration,
  TableRow,
  ViewControlDeclaration,
} from "./store";

export { AssistantClient } from "./client";
export type {
  ClientEvent,
  ClientOptions,
  ConnectionState,
  ProposalPayload,
} from "./client";

export { executeCommand } from "./commands";
export type { CommandContext, CommandResult } from "./commands";
export { formatContextReport } from "./debug";
export type { ContextReport } from "./debug";

export { HighlightEngine, COMPONENT_ATTRIBUTE } from "./highlight";

export { PROTOCOL_VERSION, VOICE_SAMPLE_RATE } from "@mihe-dev/protocol";
