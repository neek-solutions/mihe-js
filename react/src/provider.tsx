/**
 * `AssistantProvider` — the React binding of `Mihe` (doc 08).
 *
 * Everything the assistant does — the session, the screen publishing, the
 * commands, the cards, voice — lives in `@mihe-dev/js`. This file only holds one
 * `Mihe` for the tree and reads its state with `useSyncExternalStore`, so
 * the React SDK and the JavaScript one cannot behave differently.
 */

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";

import {
  Mihe,
  type AssistantStore,
  type MiheOptions,
  type MiheState,
} from "@mihe-dev/js";

export { SDK_VERSION, ASSISTANT_PANEL_ID } from "@mihe-dev/js";
export type { ChatMessage, VoiceControls } from "@mihe-dev/js";

export interface AssistantContextValue extends MiheState {
  store: AssistantStore;
  send: (text: string) => void;
  respondToProposal: (proposalId: string, confirmed: boolean) => void;
  open: () => void;
  close: () => void;
  toggle: () => void;
}

const AssistantContext = createContext<AssistantContextValue | null>(null);

export interface AssistantProviderProps extends MiheOptions {
  children: ReactNode;
}

export function AssistantProvider({
  url,
  publicKey,
  getUserToken,
  navigate,
  openModal,
  onActionComplete,
  debug = false,
  children,
}: AssistantProviderProps) {
  // One for the life of the tree. Constructing it has no effects; the
  // session opens in the effect below, so StrictMode's double mount opens
  // and closes it rather than leaking one.
  const [mihe] = useState(() => new Mihe({ url, publicKey, getUserToken, debug }));

  // Callbacks are read at call time, so a caller passing inline arrow
  // functions — which almost everyone does — does not rebuild the session on
  // every render. None of these reconnects.
  mihe.update({ getUserToken, navigate, openModal, onActionComplete });

  // The session outlives renders; only a genuine identity change rebuilds it.
  useEffect(() => {
    mihe.update({ url, publicKey, debug });
    mihe.connect();
    return () => mihe.disconnect();
  }, [mihe, url, publicKey, debug]);

  const state = useSyncExternalStore(mihe.subscribe, mihe.getState, mihe.getState);

  const value = useMemo<AssistantContextValue>(
    () => ({
      ...state,
      store: mihe.store,
      send: mihe.send,
      respondToProposal: mihe.respondToProposal,
      open: mihe.open,
      close: mihe.close,
      toggle: mihe.toggle,
    }),
    [mihe, state],
  );

  return <AssistantContext.Provider value={value}>{children}</AssistantContext.Provider>;
}

export function useAssistant(): AssistantContextValue {
  const value = useContext(AssistantContext);
  if (!value) {
    throw new Error(
      "useAssistant must be used inside <AssistantProvider>. Wrap your app in it.",
    );
  }
  return value;
}

/** Non-throwing variant, for hooks that should no-op outside the provider. */
export function useOptionalAssistant(): AssistantContextValue | null {
  return useContext(AssistantContext);
}
