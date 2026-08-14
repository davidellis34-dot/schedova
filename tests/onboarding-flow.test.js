const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildSkippedOnboardingBusinessPayload,
  getOnboardingBusinessValidationError,
  normalizePersistedOnboardingStep,
  ONBOARDING_FINAL_STEP,
  ONBOARDING_FLOW_VERSION,
  ONBOARDING_STEP_COUNT,
  resolveOnboardingResumeStep,
  SKIPPED_ONBOARDING_BUSINESS_NAME,
  shouldCreateOnboardingRecord,
} = require("../lib/onboardingFlow.ts");

test("onboarding resumes at the stored valid step", () => {
  assert.equal(resolveOnboardingResumeStep(1), ONBOARDING_FINAL_STEP);
  assert.equal(resolveOnboardingResumeStep(8), ONBOARDING_FINAL_STEP);
  assert.equal(resolveOnboardingResumeStep(-2), 0);
  assert.equal(resolveOnboardingResumeStep("3"), 0);
});

test("previously partially completed onboarding accounts recover to the finish step", () => {
  assert.equal(normalizePersistedOnboardingStep(0, undefined), 0);
  assert.equal(
    normalizePersistedOnboardingStep(2, undefined),
    ONBOARDING_FINAL_STEP,
  );
  assert.equal(
    normalizePersistedOnboardingStep(4, undefined),
    ONBOARDING_FINAL_STEP,
  );
  assert.equal(
    normalizePersistedOnboardingStep(5, undefined),
    ONBOARDING_FINAL_STEP,
  );
  assert.equal(
    normalizePersistedOnboardingStep(4, ONBOARDING_FLOW_VERSION),
    ONBOARDING_FINAL_STEP,
  );
  assert.equal(ONBOARDING_STEP_COUNT, 2);
});

test("saved setup records update on retry instead of creating duplicates", () => {
  assert.equal(shouldCreateOnboardingRecord(null), true);
  assert.equal(shouldCreateOnboardingRecord(""), true);
  assert.equal(shouldCreateOnboardingRecord("existing-service-id"), false);
});

test("empty business form still validates on normal Continue", () => {
  assert.equal(
    getOnboardingBusinessValidationError({ businessName: "" }),
    "Enter a business name or choose Skip for now.",
  );
  assert.equal(
    getOnboardingBusinessValidationError({ businessName: "Elite Cuts" }),
    "",
  );
});

test("business name empty plus Skip for now uses a safe fallback business profile", () => {
  assert.deepEqual(
    buildSkippedOnboardingBusinessPayload({
      businessName: "",
      businessType: "",
    }),
    {
      business_name: SKIPPED_ONBOARDING_BUSINESS_NAME,
      category: null,
    },
  );
});

test("service type empty plus Skip for now still produces a valid business payload", () => {
  assert.deepEqual(
    buildSkippedOnboardingBusinessPayload({
      businessName: "Elite Cuts",
      businessType: "",
    }),
    {
      business_name: "Elite Cuts",
      category: null,
    },
  );
});

test("business skip payload preserves entered values without requiring them", () => {
  assert.deepEqual(
    buildSkippedOnboardingBusinessPayload({
      businessName: "Elite Cuts",
      businessType: "Barber",
    }),
    {
      business_name: "Elite Cuts",
      category: "Barber",
    },
  );
  assert.deepEqual(
    buildSkippedOnboardingBusinessPayload({
      businessName: "",
      businessType: "Barber",
    }),
    {
      business_name: SKIPPED_ONBOARDING_BUSINESS_NAME,
      category: "Barber",
    },
  );
});
