type SmsBalanceListener = () => void;

const smsBalanceListeners = new Set<SmsBalanceListener>();

export function emitSmsBalanceUpdated() {
  for (const listener of smsBalanceListeners) {
    listener();
  }
}

export function subscribeToSmsBalanceEvents(listener: SmsBalanceListener) {
  smsBalanceListeners.add(listener);

  return () => {
    smsBalanceListeners.delete(listener);
  };
}
