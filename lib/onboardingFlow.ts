export const ONBOARDING_FLOW_VERSION = 3;
export const ONBOARDING_FINAL_STEP = 1;
export const ONBOARDING_STEP_COUNT = ONBOARDING_FINAL_STEP + 1;
export const SKIPPED_ONBOARDING_BUSINESS_NAME = "My Business";

function readTrimmedValue(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function readPersistedStep(value: unknown) {
  if (typeof value !== "number" || !Number.isFinite(value)) return 0;
  return Math.max(0, Math.floor(value));
}

export function resolveOnboardingResumeStep(value: unknown) {
  return Math.min(ONBOARDING_FINAL_STEP, readPersistedStep(value));
}

// Versions before v3 included extra setup steps for service, client,
// appointment, and SMS review. Any unfinished progress beyond the business
// step now resumes at the final "ready to finish" screen so existing accounts
// can recover without getting trapped.
export function normalizePersistedOnboardingStep(
  value: unknown,
  flowVersion: unknown,
) {
  const step = readPersistedStep(value);

  if (flowVersion === ONBOARDING_FLOW_VERSION) {
    return resolveOnboardingResumeStep(step);
  }

  return step <= 0 ? 0 : ONBOARDING_FINAL_STEP;
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
