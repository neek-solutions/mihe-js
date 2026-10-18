/**
 * @mihe-dev/react — an app-aware AI assistant for React apps.
 *
 * Three things to wire up:
 *
 * 1. Wrap your app in `<AssistantProvider>` and render `<AssistantWidget />`.
 * 2. Call `useAssistantScreen` on each page so the assistant knows where the
 *    user is.
 * 3. Call `useAssistantComponent` on the elements it should be able to point
 *    at, and `useAssistantAction` for anything it should be able to run.
 *
 * The assistant reasons; your app executes. It can only navigate to screens
 * you registered, point at components you declared, and run actions you
 * handled — there is no path by which it drives your UI directly.
 */

export {
  AssistantProvider,
  useAssistant,
  SDK_VERSION,
  ASSISTANT_PANEL_ID,
} from "./provider";
export type {
  AssistantContextValue,
  AssistantProviderProps,
  ChatMessage,
  VoiceControls,
} from "./provider";

export { VoiceSession, voiceUrl } from "@mihe-dev/js";
export type { VoiceEvent, VoiceState, VoiceSessionOptions } from "@mihe-dev/js";

export { MicrophoneCapture, SpeakerQueue, toPcm16, fromPcm16 } from "@mihe-dev/js";

export { AssistantWidget, AssistantPanel } from "./widget";
export { MiheMark } from "./mark";
export type { AssistantWidgetProps, AssistantPanelProps } from "./widget";
export type { OrbCorner, OrbVoiceMode } from "./orb";

export {
  useAssistantScreen,
  useAssistantComponent,
  useAssistantAction,
  useAssistantTabs,
  useAssistantTable,
  useAssistantChart,
  useAssistantValues,
  useAssistantTrigger,
  useAssistantPrompt,
} from "./hooks";
export type {
  AssistantChart,
  AssistantQueryParam,
  AssistantTable,
  AssistantTableColumn,
  AssistantTableQuery,
  AssistantTabs,
  AssistantTriggerProps,
} from "./hooks";

export { AssistantStore } from "@mihe-dev/js";
export type {
  ActionHandler,
  ComponentDeclaration,
  ScreenDeclaration,
  ChartDeclaration,
  TableDeclaration,
  TableRow,
  ViewControlDeclaration,
} from "@mihe-dev/js";

export { AssistantClient } from "@mihe-dev/js";
export type {
  ClientEvent,
  ClientOptions,
  ConnectionState,
  ProposalPayload,
} from "@mihe-dev/js";

export { executeCommand } from "@mihe-dev/js";
export { formatContextReport } from "@mihe-dev/js";
export type { ContextReport } from "@mihe-dev/js";
export type { CommandContext, CommandResult } from "@mihe-dev/js";

export { HighlightEngine, COMPONENT_ATTRIBUTE } from "@mihe-dev/js";

export { PROTOCOL_VERSION, VOICE_SAMPLE_RATE } from "@mihe-dev/protocol";
