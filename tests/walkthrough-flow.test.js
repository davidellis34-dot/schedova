const test = require("node:test");
const assert = require("node:assert/strict");

const {
  getWalkthroughExitRoute,
  getWalkthroughStorageKey,
  getNextWalkthroughStep,
  getPreviousWalkthroughStep,
  resolveWalkthroughResumeStep,
  WALKTHROUGH_SCREEN_COUNT,
} = require("../lib/walkthroughFlow.ts");
const {
  requiresInitialSetupGate,
} = require("../lib/initialSetupRouting.ts");

test("walkthrough resumes only at a valid screen", () => {
  assert.equal(resolveWalkthroughResumeStep(0), 0);
  assert.equal(resolveWalkthroughResumeStep(4), 4);
  assert.equal(resolveWalkthroughResumeStep(99), WALKTHROUGH_SCREEN_COUNT - 1);
  assert.equal(resolveWalkthroughResumeStep(-1), 0);
  assert.equal(resolveWalkthroughResumeStep("4"), 0);
});

test("walkthrough navigation stays within the eight-screen introduction", () => {
  assert.equal(getPreviousWalkthroughStep(0), 0);
  assert.equal(getPreviousWalkthroughStep(3), 2);
  assert.equal(getNextWalkthroughStep(3), 4);
  assert.equal(
    getNextWalkthroughStep(WALKTHROUGH_SCREEN_COUNT - 1),
    WALKTHROUGH_SCREEN_COUNT - 1,
  );
});

test("walkthrough storage is isolated for each signed-in account", () => {
  assert.notEqual(
    getWalkthroughStorageKey("account-a"),
    getWalkthroughStorageKey("account-b"),
  );
});

test("walkthrough exits to the right next step", () => {
  assert.equal(getWalkthroughExitRoute(true, false), "/onboarding");
  assert.equal(getWalkthroughExitRoute(false, false), "/dashboard");
  assert.equal(getWalkthroughExitRoute(true, true), "/dashboard");
});

test("deep links remain behind required first-run setup", () => {
  assert.equal(requiresInitialSetupGate("/walkthrough"), true);
  assert.equal(requiresInitialSetupGate("/onboarding"), true);
  assert.equal(
    requiresInitialSetupGate({
      pathname: "/country-region",
      params: { next: "/walkthrough" },
    }),
    true,
  );
  assert.equal(requiresInitialSetupGate("/dashboard"), false);
});
