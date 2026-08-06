import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  ONBOARDING_FINAL_STEP,
  normalizePersistedOnboardingStep,
  ONBOARDING_FLOW_VERSION,
} from "./onboardingFlow";

export type OnboardingDraft = {
  step: number;
  businessId: string | null;
  serviceId: string | null;
  clientId: string | null;
  appointmentId: string | null;
};

export type OnboardingState = {
  flowVersion: number;
  completed: boolean;
  skipped: boolean;
  started: boolean;
  draft: OnboardingDraft;
};

type OnboardingStateUpdate = {
  completed?: boolean;
  skipped?: boolean;
  started?: boolean;
  draft?: Partial<OnboardingDraft>;
};

const ONBOARDING_STORAGE_PREFIX = "schedova_onboarding_v2_";

const EMPTY_DRAFT: OnboardingDraft = {
  step: 0,
  businessId: null,
  serviceId: null,
  clientId: null,
  appointmentId: null,
};

function getStorageKey(userId: string) {
  return `${ONBOARDING_STORAGE_PREFIX}${userId}`;
}

function normalizeState(value: unknown): OnboardingState {
  if (!value || typeof value !== "object") {
    return {
      flowVersion: ONBOARDING_FLOW_VERSION,
      completed: false,
      skipped: false,
      started: false,
      draft: { ...EMPTY_DRAFT },
    };
  }

  const parsed = value as Partial<OnboardingState>;
  const draft: Partial<OnboardingDraft> =
    parsed.draft && typeof parsed.draft === "object"
      ? parsed.draft
      : {};

  return {
    flowVersion: ONBOARDING_FLOW_VERSION,
    completed: parsed.completed === true,
    skipped: parsed.skipped === true,
    started: parsed.started === true,
    draft: {
      step: normalizePersistedOnboardingStep(draft.step, parsed.flowVersion),
      businessId: typeof draft.businessId === "string" ? draft.businessId : null,
      serviceId: typeof draft.serviceId === "string" ? draft.serviceId : null,
      clientId: typeof draft.clientId === "string" ? draft.clientId : null,
      appointmentId:
        typeof draft.appointmentId === "string" ? draft.appointmentId : null,
    },
  };
}

export async function getOnboardingState(userId: string | null | undefined) {
  if (!userId) {
    return {
      flowVersion: ONBOARDING_FLOW_VERSION,
      completed: false,
      skipped: false,
      started: false,
      draft: { ...EMPTY_DRAFT },
    };
  }

  try {
    const raw = await AsyncStorage.getItem(getStorageKey(userId));
    return normalizeState(raw ? JSON.parse(raw) : null);
  } catch {
    return {
      flowVersion: ONBOARDING_FLOW_VERSION,
      completed: false,
      skipped: false,
      started: false,
      draft: { ...EMPTY_DRAFT },
    };
  }
}

export async function saveOnboardingState(
  userId: string,
  update: OnboardingStateUpdate,
) {
  const current = await getOnboardingState(userId);
  const next: OnboardingState = {
    flowVersion: ONBOARDING_FLOW_VERSION,
    completed: update.completed ?? current.completed,
    skipped: update.skipped ?? current.skipped,
    started: update.started ?? current.started,
    draft: {
      ...current.draft,
      ...(update.draft ?? {}),
    },
  };

  await AsyncStorage.setItem(getStorageKey(userId), JSON.stringify(next));
  return next;
}

export async function hasCompletedOnboarding(userId?: string | null) {
  return (await getOnboardingState(userId)).completed;
}

export async function markOnboardingComplete(userId: string) {
  return saveOnboardingState(userId, {
    completed: true,
    skipped: false,
    started: true,
    draft: { step: ONBOARDING_FINAL_STEP },
  });
}

export async function markOnboardingSkipped(
  userId: string,
  draft: Partial<OnboardingDraft> = {},
) {
  return saveOnboardingState(userId, {
    completed: true,
    skipped: true,
    started: true,
    draft: { ...draft, step: ONBOARDING_FINAL_STEP },
  });
}

export async function resetOnboardingState(userId: string) {
  await AsyncStorage.removeItem(getStorageKey(userId));
}
