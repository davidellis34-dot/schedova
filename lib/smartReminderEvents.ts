type SmartReminderListener = () => void;

const listeners = new Set<SmartReminderListener>();

export function notifySmartRemindersChanged() {
  listeners.forEach((listener) => listener());
}

export function subscribeToSmartReminderChanges(
  listener: SmartReminderListener,
): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
