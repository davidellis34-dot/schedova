type ClientMessageListener = () => void;

const clientMessageListeners = new Set<ClientMessageListener>();

export function emitClientMessageReceived() {
  for (const listener of clientMessageListeners) {
    listener();
  }
}

export function subscribeToClientMessageEvents(listener: ClientMessageListener) {
  clientMessageListeners.add(listener);

  return () => {
    clientMessageListeners.delete(listener);
  };
}
