const test = require("node:test");
const assert = require("node:assert/strict");

const {
  beginAccountTransition,
  cancelAccountScopedWork,
  completeAccountTransition,
  continueAccountTransition,
  getAccountTransitionEvents,
  isCurrentAccountTransition,
  registerAccountScopedCleanup,
  resetAccountTransitionStateForTests,
} = require("../lib/accountTransition.ts");

test.beforeEach(() => {
  resetAccountTransitionStateForTests();
});

test("serializes rapid account-switch requests with one shared lock", () => {
  const first = beginAccountTransition("settings", "account-a");
  const repeated = beginAccountTransition("settings", "account-a");

  assert.equal(first.accepted, true);
  assert.equal(repeated.accepted, false);
  assert.equal(repeated.runId, first.runId);
  assert.equal(
    getAccountTransitionEvents().some(
      (entry) => entry.event === "switch-ignored-in-flight",
    ),
    true,
  );
});

test("cancels registered account work before a new session becomes current", async () => {
  const transition = beginAccountTransition("settings", "account-a");
  const cleanupCalls = [];
  registerAccountScopedCleanup(async () => {
    cleanupCalls.push("push-listener");
  });
  registerAccountScopedCleanup(() => {
    cleanupCalls.push("realtime-channel");
  });

  await cancelAccountScopedWork("settings", transition.runId);

  assert.deepEqual(cleanupCalls.sort(), ["push-listener", "realtime-channel"]);
  assert.equal(
    getAccountTransitionEvents().some(
      (entry) => entry.event === "previous-account-async-work-canceled",
    ),
    true,
  );
});

test("only the current transition can complete after account B is ready", () => {
  const transition = beginAccountTransition("settings", "account-a");
  const session = continueAccountTransition("auth-callback:SIGNED_IN", "account-b");

  assert.equal(session.runId, transition.runId);
  assert.equal(isCurrentAccountTransition(transition.runId), true);
  assert.equal(completeAccountTransition(transition.runId, "profile-ready"), true);
  assert.equal(isCurrentAccountTransition(transition.runId), false);
  assert.equal(completeAccountTransition(transition.runId, "stale-result"), false);
});
