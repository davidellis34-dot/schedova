const test = require("node:test");
const assert = require("node:assert/strict");

const {
  promoteAuthenticatedAccountToReady,
} = require("../lib/authSessionReadiness.ts");

test("same-account persisted-session startup can become ready without waiting on business-profile revalidation", async () => {
  const readyCalls = [];
  let backgroundStarted = false;

  await promoteAuthenticatedAccountToReady({
    previousUserId: null,
    nextUserId: "user-123",
    canApplyResult: () => true,
    markAccountReady: (source) => {
      readyCalls.push(source);
    },
    revalidateBusinessProfile: () => new Promise(() => {}),
    onBackgroundBusinessProfileRevalidationStarted: () => {
      backgroundStarted = true;
    },
  });

  assert.deepEqual(readyCalls, ["local-session"]);
  assert.equal(backgroundStarted, true);
});

test("switching from user A to user B still waits for the previous account cleanup before becoming ready", async () => {
  const readyCalls = [];
  let resolveCleanup;

  const readinessPromise = promoteAuthenticatedAccountToReady({
    previousUserId: "user-a",
    nextUserId: "user-b",
    canApplyResult: () => true,
    markAccountReady: (source) => {
      readyCalls.push(source);
    },
    clearPreviousAccountWork: () =>
      new Promise((resolve) => {
        resolveCleanup = resolve;
      }),
  });

  await Promise.resolve();
  assert.deepEqual(readyCalls, []);

  resolveCleanup();
  await readinessPromise;

  assert.deepEqual(readyCalls, ["previous-account-cleanup"]);
});

test("stale async cleanup results cannot mark the wrong user ready", async () => {
  const readyCalls = [];
  let resolveCleanup;
  let isCurrentResult = true;

  const readinessPromise = promoteAuthenticatedAccountToReady({
    previousUserId: "user-a",
    nextUserId: "user-b",
    canApplyResult: () => isCurrentResult,
    markAccountReady: (source) => {
      readyCalls.push(source);
    },
    clearPreviousAccountWork: () =>
      new Promise((resolve) => {
        resolveCleanup = resolve;
      }),
  });

  isCurrentResult = false;
  resolveCleanup();
  const result = await readinessPromise;

  assert.equal(result, "stale");
  assert.deepEqual(readyCalls, []);
});
