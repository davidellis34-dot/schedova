const test = require("node:test");
const assert = require("node:assert/strict");

const {
  resolveBusinessSetupScreenState,
  shouldApplyAccountScopedResult,
  shouldStartBusinessSetupSave,
  shouldStartRevenueCatIdentitySync,
} = require("../lib/accountSwitchUtils.ts");

test("rapid account switching rejects stale account A results after account B is current", () => {
  assert.equal(
    shouldApplyAccountScopedResult({
      requestUserId: "account-a",
      currentUserId: "account-b",
      requestId: 4,
      currentRequestId: 4,
    }),
    false,
  );
  assert.equal(
    shouldApplyAccountScopedResult({
      requestUserId: "account-b",
      currentUserId: "account-b",
      requestId: 5,
      currentRequestId: 5,
    }),
    true,
  );
});

test("a stale async response is rejected when a newer request supersedes it", () => {
  assert.equal(
    shouldApplyAccountScopedResult({
      requestUserId: "account-b",
      currentUserId: "account-b",
      requestId: 1,
      currentRequestId: 2,
    }),
    false,
  );
});

test("RevenueCat starts one identity sync per current account and replaces an old one", () => {
  assert.equal(
    shouldStartRevenueCatIdentitySync({
      targetUserId: "account-b",
      activeUserId: "account-b",
      inFlightUserId: null,
    }),
    true,
  );
  assert.equal(
    shouldStartRevenueCatIdentitySync({
      targetUserId: "account-b",
      activeUserId: "account-b",
      inFlightUserId: "account-b",
    }),
    false,
  );
  assert.equal(
    shouldStartRevenueCatIdentitySync({
      targetUserId: "account-b",
      activeUserId: "account-b",
      inFlightUserId: "account-a",
    }),
    true,
  );
});

test("Business Setup safely handles a loading or missing business profile", () => {
  assert.equal(
    resolveBusinessSetupScreenState({
      isHydrated: true,
      isAccountReady: true,
      userId: "account-b",
      loadedUserId: null,
      error: null,
    }),
    "loading",
  );
  assert.equal(
    resolveBusinessSetupScreenState({
      isHydrated: true,
      isAccountReady: true,
      userId: "account-b",
      loadedUserId: "account-b",
      error: null,
    }),
    "editing",
  );
});

test("Business Setup blocks repeated save taps while a save is in flight", () => {
  assert.equal(
    shouldStartBusinessSetupSave({
      hasInFlightSave: false,
      isSaving: false,
      screenState: "editing",
    }),
    true,
  );
  assert.equal(
    shouldStartBusinessSetupSave({
      hasInFlightSave: true,
      isSaving: true,
      screenState: "editing",
    }),
    false,
  );
});
