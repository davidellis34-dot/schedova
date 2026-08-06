import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  getWalkthroughStorageKey,
  resolveWalkthroughResumeStep,
  WALKTHROUGH_SCREEN_COUNT,
} from "./walkthroughFlow";

export type WalkthroughState = {
  completed: boolean;
  started: boolean;
  step: number;
};

type WalkthroughStateUpdate = Partial<WalkthroughState>;

const EMPTY_WALKTHROUGH_STATE: WalkthroughState = {
  completed: false,
  started: false,
  step: 0,
};

function normalizeWalkthroughState(value: unknown): WalkthroughState {
  if (!value || typeof value !== "object") {
    return { ...EMPTY_WALKTHROUGH_STATE };
  }

  const parsed = value as Partial<WalkthroughState>;

  return {
    completed: parsed.completed === true,
    started: parsed.started === true,
    step: resolveWalkthroughResumeStep(parsed.step),
  };
}

export async function getWalkthroughState(userId?: string | null) {
  if (!userId) return { ...EMPTY_WALKTHROUGH_STATE };

  try {
    const raw = await AsyncStorage.getItem(getWalkthroughStorageKey(userId));
    return normalizeWalkthroughState(raw ? JSON.parse(raw) : null);
  } catch {
    return { ...EMPTY_WALKTHROUGH_STATE };
  }
}

export async function saveWalkthroughState(
  userId: string,
  update: WalkthroughStateUpdate,
) {
  const current = await getWalkthroughState(userId);
  const next: WalkthroughState = {
    completed: update.completed ?? current.completed,
    started: update.started ?? current.started,
    step: resolveWalkthroughResumeStep(update.step ?? current.step),
  };

  await AsyncStorage.setItem(getWalkthroughStorageKey(userId), JSON.stringify(next));
  return next;
}

export async function hasCompletedWalkthrough(userId?: string | null) {
  return (await getWalkthroughState(userId)).completed;
}

export async function markWalkthroughComplete(userId: string) {
  return saveWalkthroughState(userId, {
    completed: true,
    started: true,
    step: WALKTHROUGH_SCREEN_COUNT - 1,
  });
}

export async function resetWalkthroughState(userId: string) {
  await AsyncStorage.removeItem(getWalkthroughStorageKey(userId));
}
