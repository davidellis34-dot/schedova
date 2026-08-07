export type PushRegistrationPhase =
  | "idle"
  | "skipped"
  | "checking-permission"
  | "permission-denied"
  | "generating-device-token"
  | "generating-expo-token"
  | "persisting-token"
  | "registered"
  | "registration-failed";

export type PushRegistrationState = {
  userId: string | null;
  source: string | null;
  phase: PushRegistrationPhase;
  permissionStatus: string | null;
  permissionsGranted: boolean | null;
  canAskAgain: boolean | null;
  deviceId: string | null;
  nativeToken: string | null;
  expoPushToken: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  updatedAt: string | null;
};

export type PushRegistrationWarning = {
  action: "open-settings" | "retry" | null;
  message: string;
  title: string;
};

type PushRegistrationListener = (state: PushRegistrationState) => void;

const EMPTY_PUSH_REGISTRATION_STATE: PushRegistrationState = {
  userId: null,
  source: null,
  phase: "idle",
  permissionStatus: null,
  permissionsGranted: null,
  canAskAgain: null,
  deviceId: null,
  nativeToken: null,
  expoPushToken: null,
  errorCode: null,
  errorMessage: null,
  updatedAt: null,
};

let currentPushRegistrationState = { ...EMPTY_PUSH_REGISTRATION_STATE };
const pushRegistrationListeners = new Set<PushRegistrationListener>();

export function getPushRegistrationState() {
  return currentPushRegistrationState;
}

export function publishPushRegistrationState(
  nextState: Partial<PushRegistrationState>,
) {
  currentPushRegistrationState = {
    ...currentPushRegistrationState,
    ...nextState,
    updatedAt: nextState.updatedAt || new Date().toISOString(),
  };

  for (const listener of pushRegistrationListeners) {
    listener(currentPushRegistrationState);
  }

  return currentPushRegistrationState;
}

export function resetPushRegistrationState() {
  currentPushRegistrationState = { ...EMPTY_PUSH_REGISTRATION_STATE };
}

export function resetPushRegistrationStateForTests() {
  resetPushRegistrationState();
  pushRegistrationListeners.clear();
}

export function subscribeToPushRegistrationState(
  listener: PushRegistrationListener,
) {
  pushRegistrationListeners.add(listener);

  return () => {
    pushRegistrationListeners.delete(listener);
  };
}

export function getPushRegistrationWarning(
  state: PushRegistrationState,
): PushRegistrationWarning | null {
  if (state.phase === "permission-denied") {
    return {
      action: state.canAskAgain === false ? "open-settings" : "retry",
      title: "Notifications are off",
      message:
        state.canAskAgain === false
          ? "Turn notifications on in Settings so you don't miss client replies."
          : "Allow notifications so Schedova can alert you when a client replies.",
    };
  }

  if (state.phase === "registration-failed") {
    return {
      action: "retry",
      title: "Notifications need attention",
      message:
        state.errorMessage ||
        "Schedova could not register this device for client reply alerts.",
    };
  }

  return null;
}
