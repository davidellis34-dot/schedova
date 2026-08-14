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
  canStayOnInitialSetupChildRoute,
  ONBOARDING_BOOK_APPOINTMENT_SETUP_FLOW,
  requiresInitialSetupGate,
} = require("../lib/initialSetupRouting.ts");
const {
  allowSetupFlowRouteAccess,
  hasSetupFlowRouteAccess,
  resetSetupFlowRouteAccessForTests,
} = require("../lib/setupFlowRouteAccess.ts");

test.beforeEach(() => {
  resetSetupFlowRouteAccessForTests();
});

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

test("incomplete onboarding can keep the onboarding booking flow open", () => {
  allowSetupFlowRouteAccess({
    userId: "user-123",
    pathname: "/book-appointment",
    returnTo: "/onboarding",
    setupFlow: ONBOARDING_BOOK_APPOINTMENT_SETUP_FLOW,
  });

  assert.equal(
    canStayOnInitialSetupChildRoute({
      currentPathname: "/book-appointment",
      hasExplicitAccess: hasSetupFlowRouteAccess({
        userId: "user-123",
        pathname: "/book-appointment",
        returnTo: "/onboarding",
        setupFlow: ONBOARDING_BOOK_APPOINTMENT_SETUP_FLOW,
      }),
      unresolvedSetupRoute: "/onboarding",
    }),
    true,
  );
});

test("onboarding booking access survives until search params hydrate", () => {
  allowSetupFlowRouteAccess({
    userId: "user-123",
    pathname: "/book-appointment",
    returnTo: "/onboarding",
    setupFlow: ONBOARDING_BOOK_APPOINTMENT_SETUP_FLOW,
  });

  assert.equal(
    canStayOnInitialSetupChildRoute({
      currentPathname: "/book-appointment",
      hasExplicitAccess: hasSetupFlowRouteAccess({
        userId: "user-123",
        pathname: "/book-appointment",
        returnTo: "/onboarding",
        setupFlow: ONBOARDING_BOOK_APPOINTMENT_SETUP_FLOW,
      }),
      unresolvedSetupRoute: "/onboarding",
    }),
    true,
  );
});

test("an unrelated booking deep link still cannot bypass required setup", () => {
  assert.equal(
    canStayOnInitialSetupChildRoute({
      currentPathname: "/book-appointment",
      hasExplicitAccess: false,
      unresolvedSetupRoute: "/onboarding",
    }),
    false,
  );
});
