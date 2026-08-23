const test = require("node:test");
const assert = require("node:assert/strict");

const {
  persistSmsSettingsReview,
} = require("../lib/smsSettingsReview.ts");

test("SMS review persistence works for an authenticated user", async () => {
  const calls = [];
  const persisted = await persistSmsSettingsReview({
    authStatus: "authenticated",
    userId: "user-123",
    reviewedAt: "2026-08-23T11:40:00.000Z",
    runUpdate: async (input) => {
      calls.push(input);
      return { error: null };
    },
  });

  assert.equal(persisted, true);
  assert.deepEqual(calls, [
    {
      reviewedAt: "2026-08-23T11:40:00.000Z",
      userId: "user-123",
    },
  ]);
});

test("SMS review persistence reports update errors without throwing", async () => {
  const errors = [];
  const persisted = await persistSmsSettingsReview({
    authStatus: "authenticated",
    userId: "user-123",
    onError: (error) => errors.push(error),
    runUpdate: async () => ({
      error: {
        code: "42501",
        message: "permission denied",
      },
    }),
  });

  assert.equal(persisted, false);
  assert.deepEqual(errors, [
    {
      code: "42501",
      message: "permission denied",
    },
  ]);
});

test("SMS review persistence skips unauthenticated opens", async () => {
  let called = false;

  const persisted = await persistSmsSettingsReview({
    authStatus: "signed_out",
    userId: null,
    runUpdate: async () => {
      called = true;
      return { error: null };
    },
  });

  assert.equal(persisted, false);
  assert.equal(called, false);
});
