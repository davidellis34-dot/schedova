import type { MessageBadgeRow } from "./messageBadge";

export type ClientMessageEvent = {
  accountId?: string | null;
  messages?: MessageBadgeRow[];
  source: "local" | "notification" | "realtime";
};

type ClientMessageListener = (event: ClientMessageEvent) => void;

const clientMessageListeners = new Set<ClientMessageListener>();

export function emitClientMessageEvent(event: ClientMessageEvent) {
  for (const listener of clientMessageListeners) {
    listener(event);
  }
}

export function emitClientMessageReceived(accountId?: string | null) {
  emitClientMessageEvent({ accountId, source: "notification" });
}

export function subscribeToClientMessageEvents(listener: ClientMessageListener) {
  clientMessageListeners.add(listener);

  return () => {
    clientMessageListeners.delete(listener);
  };
}
