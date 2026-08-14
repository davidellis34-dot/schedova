import AsyncStorage from "@react-native-async-storage/async-storage";

export type FirstBookingActivationState = {
  completed: boolean;
  dismissedUntil: string | null;
  updatedAt: string | null;
};

const FIRST_BOOKING_ACTIVATION_STORAGE_PREFIX =
  "schedova_first_booking_activation_v1_";
const FIRST_BOOKING_DISMISSAL_COOLDOWN_MS = 3 * 24 * 60 * 60 * 1000;

const EMPTY_FIRST_BOOKING_ACTIVATION_STATE: FirstBookingActivationState = {
  completed: false,
  dismissedUntil: null,
  updatedAt: null,
};

function getStorageKey(userId: string) {
  return `${FIRST_BOOKING_ACTIVATION_STORAGE_PREFIX}${userId}`;
}

function normalizeTimestamp(value: unknown) {
  if (typeof value !== "string" || !value.trim()) return null;
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) ? value : null;
}

function normalizeState(value: unknown): FirstBookingActivationState {
  if (!value || typeof value !== "object") {
    return { ...EMPTY_FIRST_BOOKING_ACTIVATION_STATE };
  }

  const parsed = value as Partial<FirstBookingActivationState>;

  return {
    completed: parsed.completed === true,
    dismissedUntil: normalizeTimestamp(parsed.dismissedUntil),
    updatedAt: normalizeTimestamp(parsed.updatedAt),
  };
}

export async function getFirstBookingActivationState(
  userId?: string | null,
): Promise<FirstBookingActivationState> {
  if (!userId) {
    return { ...EMPTY_FIRST_BOOKING_ACTIVATION_STATE };
  }

  try {
    const raw = await AsyncStorage.getItem(getStorageKey(userId));
    return normalizeState(raw ? JSON.parse(raw) : null);
  } catch {
    return { ...EMPTY_FIRST_BOOKING_ACTIVATION_STATE };
  }
}

export async function hasHandledFirstBookingActivation(
  userId?: string | null,
) {
  const state = await getFirstBookingActivationState(userId);
  const dismissedUntil = state.dismissedUntil
    ? new Date(state.dismissedUntil).getTime()
    : 0;

  return state.completed || dismissedUntil > Date.now();
}

async function saveFirstBookingActivationState(
  userId: string,
  update: Partial<FirstBookingActivationState>,
) {
  const current = await getFirstBookingActivationState(userId);
  const next: FirstBookingActivationState = {
    ...current,
    ...update,
    updatedAt: new Date().toISOString(),
  };

  await AsyncStorage.setItem(getStorageKey(userId), JSON.stringify(next));
  return next;
}

export async function markFirstBookingActivationCompleted(userId: string) {
  return saveFirstBookingActivationState(userId, {
    completed: true,
    dismissedUntil: null,
  });
}

export async function markFirstBookingActivationDismissed(userId: string) {
  return saveFirstBookingActivationState(userId, {
    completed: false,
    dismissedUntil: new Date(
      Date.now() + FIRST_BOOKING_DISMISSAL_COOLDOWN_MS,
    ).toISOString(),
  });
}

export async function resetFirstBookingActivationState(userId: string) {
  await AsyncStorage.removeItem(getStorageKey(userId));
}
