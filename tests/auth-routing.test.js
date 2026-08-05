const test = require("node:test");
const assert = require("node:assert/strict");

const {
  resolveAuthenticatedAppBaseRoute,
} = require("../lib/authRouteDecision.ts");

test("returning user with existing business and no local setup state goes to dashboard", async () => {
  const route = resolveAuthenticatedAppBaseRoute({
    onboardingCompleted: false,
    onboardingStarted: false,
    walkthroughCompleted: false,
    walkthroughStarted: false,
    hasExistingBusinessProfile: true,
  });

  assert.equal(route, "/dashboard");
});

test("local onboarding progress still wins over business fallback", async () => {
  const route = resolveAuthenticatedAppBaseRoute({
    onboardingCompleted: false,
    onboardingStarted: true,
    walkthroughCompleted: true,
    walkthroughStarted: true,
    hasExistingBusinessProfile: true,
  });

  assert.equal(route, "/onboarding");
});

test("brand-new user with no progress and no business goes to walkthrough", async () => {
  const route = resolveAuthenticatedAppBaseRoute({
    onboardingCompleted: false,
    onboardingStarted: false,
    walkthroughCompleted: false,
    walkthroughStarted: false,
    hasExistingBusinessProfile: false,
  });

  assert.equal(route, "/walkthrough");
});

test("walkthrough-complete user without onboarding completion goes to onboarding", async () => {
  const route = resolveAuthenticatedAppBaseRoute({
    onboardingCompleted: false,
    onboardingStarted: false,
    walkthroughCompleted: true,
    walkthroughStarted: true,
    hasExistingBusinessProfile: false,
  });

  assert.equal(route, "/onboarding");
});

test("completed onboarding always wins", async () => {
  const route = resolveAuthenticatedAppBaseRoute({
    onboardingCompleted: true,
    onboardingStarted: true,
    walkthroughCompleted: true,
    walkthroughStarted: true,
    hasExistingBusinessProfile: false,
  });

  assert.equal(route, "/dashboard");
});
