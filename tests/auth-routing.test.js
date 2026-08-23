const test = require("node:test");
const assert = require("node:assert/strict");

const {
  resolveAuthenticatedAppBaseRoute,
} = require("../lib/authRouteDecision.ts");
const {
  resolveAuthenticatedAppRoute: resolveAuthenticatedAppRouteWithDependencies,
} = require("../lib/authRouting.ts");

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

test("completed onboarding resolves to dashboard without invoking the business-profile dependency", async () => {
  let businessLookupCount = 0;

  const route = await resolveAuthenticatedAppRouteWithDependencies("user-123", {
    getOnboardingState: async () => ({
      completed: true,
      started: true,
      skipped: false,
      draft: { step: 5 },
    }),
    getWalkthroughState: async () => ({
      completed: true,
      started: true,
      step: 7,
    }),
    hasExistingBusinessProfile: async () => {
      businessLookupCount += 1;
      return true;
    },
    hasSelectedUserCountryRegion: async () => true,
  });

  assert.equal(route, "/dashboard");
  assert.equal(businessLookupCount, 0);
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

test("local walkthrough progress that already points to onboarding does not invoke the business-profile dependency", async () => {
  let businessLookupCount = 0;

  const route = await resolveAuthenticatedAppRouteWithDependencies("user-123", {
    getOnboardingState: async () => ({
      completed: false,
      started: false,
      skipped: false,
      draft: { step: 0 },
    }),
    getWalkthroughState: async () => ({
      completed: true,
      started: true,
      step: 7,
    }),
    hasExistingBusinessProfile: async () => {
      businessLookupCount += 1;
      return true;
    },
    hasSelectedUserCountryRegion: async () => true,
  });

  assert.equal(route, "/onboarding");
  assert.equal(businessLookupCount, 0);
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

test("fresh-install returning user still uses the business-profile fallback when local state is unknown", async () => {
  let businessLookupCount = 0;

  const route = await resolveAuthenticatedAppRouteWithDependencies("user-123", {
    getOnboardingState: async () => ({
      completed: false,
      started: false,
      skipped: false,
      draft: { step: 0 },
    }),
    getWalkthroughState: async () => ({
      completed: false,
      started: false,
      step: 0,
    }),
    hasExistingBusinessProfile: async () => {
      businessLookupCount += 1;
      return true;
    },
    hasSelectedUserCountryRegion: async () => true,
  });

  assert.equal(route, "/dashboard");
  assert.equal(businessLookupCount, 1);
});

test("brand-new user with no progress and no business still uses the normal first-run route", async () => {
  let businessLookupCount = 0;

  const route = await resolveAuthenticatedAppRouteWithDependencies("user-123", {
    getOnboardingState: async () => ({
      completed: false,
      started: false,
      skipped: false,
      draft: { step: 0 },
    }),
    getWalkthroughState: async () => ({
      completed: false,
      started: false,
      step: 0,
    }),
    hasExistingBusinessProfile: async () => {
      businessLookupCount += 1;
      return false;
    },
    hasSelectedUserCountryRegion: async () => true,
  });

  assert.equal(route, "/walkthrough");
  assert.equal(businessLookupCount, 1);
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

test("completed onboarding routes to dashboard", async () => {
  const route = resolveAuthenticatedAppBaseRoute({
    onboardingCompleted: true,
    onboardingStarted: true,
    walkthroughCompleted: true,
    walkthroughStarted: true,
    hasExistingBusinessProfile: false,
  });

  assert.equal(route, "/dashboard");
});
