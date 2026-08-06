export const ONBOARDING_FLOW_VERSION = 2;
export const ONBOARDING_FINAL_STEP = 5;
export const SKIPPED_ONBOARDING_BUSINESS_NAME = "My Business";

function readTrimmedValue(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

export function resolveOnboardingResumeStep(value: unknown) {
  if (typeof value !== "number" || !Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(ONBOARDING_FINAL_STEP, Math.floor(value)));
}

// Version 1 included a welcome page before Business and had no SMS review.
// Map an unfinished saved draft to the equivalent step in the six-step flow.
export function normalizePersistedOnboardingStep(
  value: unknown,
  flowVersion: unknown,
) {
  const step = resolveOnboardingResumeStep(value);

  if (flowVersion === ONBOARDING_FLOW_VERSION) {
    return step;
  }

  if (step <= 1) return 0;
  if (step === 2) return 1;
  if (step === 3) return 2;
  if (step === 4) return 3;
  return 5;
}

// Stored record IDs are the duplicate-prevention boundary for setup. A saved
// draft always updates that record on a retry instead of inserting another one.
export function shouldCreateOnboardingRecord(existingId: string | null | undefined) {
  return !String(existingId || "").trim();
}

export function getOnboardingBusinessValidationError(input: {
  businessName?: unknown;
}) {
  return readTrimmedValue(input.businessName)
    ? ""
    : "Enter a business name or choose Skip for now.";
}

export function buildSkippedOnboardingBusinessPayload(input: {
  businessName?: unknown;
  businessType?: unknown;
}) {
  const businessName = readTrimmedValue(input.businessName);
  const businessType = readTrimmedValue(input.businessType);

  return {
    business_name: businessName || SKIPPED_ONBOARDING_BUSINESS_NAME,
    category: businessType || null,
  };
}
