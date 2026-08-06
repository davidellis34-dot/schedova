const test = require("node:test");
const assert = require("node:assert/strict");

function createLocalStorage() {
  const store = new Map();

  return {
    clear() {
      store.clear();
    },
    getItem(key) {
      return store.has(key) ? store.get(key) : null;
    },
    key(index) {
      return Array.from(store.keys())[index] ?? null;
    },
    get length() {
      return store.size;
    },
    removeItem(key) {
      store.delete(key);
    },
    setItem(key, value) {
      store.set(String(key), String(value));
    },
  };
}

global.window = global.window || {};
global.window.localStorage = global.window.localStorage || createLocalStorage();

const {
  getOnboardingState,
  hasCompletedOnboarding,
  markOnboardingComplete,
  markOnboardingSkipped,
  resetOnboardingState,
} = require("../lib/onboarding.ts");

async function resetTestState(userId) {
  global.window.localStorage.clear();
  await resetOnboardingState(userId);
}

test("empty form plus Skip for now marks onboarding skipped and enters the app", async () => {
  const userId = "skip-empty-business-form";

  await resetTestState(userId);
  await markOnboardingSkipped(userId);

  const state = await getOnboardingState(userId);
  assert.equal(state.completed, true);
  assert.equal(state.skipped, true);
  assert.equal(state.started, true);
  assert.equal(state.draft.step, 5);
  assert.equal(await hasCompletedOnboarding(userId), true);

  await resetTestState(userId);
});

test("business name empty and service type empty still persist a skipped onboarding state", async () => {
  const userId = "skip-with-empty-name-and-type";

  await resetTestState(userId);
  await markOnboardingSkipped(userId, { businessId: "business-skip-record" });

  const state = await getOnboardingState(userId);
  assert.equal(state.completed, true);
  assert.equal(state.skipped, true);
  assert.equal(state.draft.businessId, "business-skip-record");

  await resetTestState(userId);
});

test("user who skipped onboarding stays out of onboarding after a fresh state read", async () => {
  const userId = "skip-reopen-route";

  await resetTestState(userId);
  await markOnboardingSkipped(userId, { businessId: "business-skip-record" });

  assert.equal(await hasCompletedOnboarding(userId), true);
  assert.equal((await getOnboardingState(userId)).skipped, true);

  await resetTestState(userId);
});

test("later normal completion can replace a skipped onboarding state", async () => {
  const userId = "skip-then-complete";

  await resetTestState(userId);
  await markOnboardingSkipped(userId);
  await markOnboardingComplete(userId);

  const state = await getOnboardingState(userId);
  assert.equal(state.completed, true);
  assert.equal(state.skipped, false);
  assert.equal(state.draft.step, 5);

  await resetTestState(userId);
});
