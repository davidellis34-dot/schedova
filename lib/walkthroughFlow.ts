export const WALKTHROUGH_SCREEN_COUNT = 8;

const WALKTHROUGH_STORAGE_PREFIX = "schedova_walkthrough_v1_";

export function getWalkthroughStorageKey(userId: string) {
  return `${WALKTHROUGH_STORAGE_PREFIX}${userId}`;
}

export function resolveWalkthroughResumeStep(value: unknown) {
  if (typeof value !== "number" || !Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(WALKTHROUGH_SCREEN_COUNT - 1, Math.floor(value)));
}

export function getNextWalkthroughStep(currentStep: unknown) {
  return Math.min(
    resolveWalkthroughResumeStep(currentStep) + 1,
    WALKTHROUGH_SCREEN_COUNT - 1,
  );
}

export function getPreviousWalkthroughStep(currentStep: unknown) {
  return Math.max(resolveWalkthroughResumeStep(currentStep) - 1, 0);
}

export function getWalkthroughExitRoute(
  startSetup: boolean,
  onboardingCompleted: boolean,
) {
  return startSetup && !onboardingCompleted ? "/onboarding" : "/dashboard";
}
