const test = require("node:test");
const assert = require("node:assert/strict");

const {
  resolveSettingsProCardState,
} = require("../lib/settingsProCardState.ts");

test("Settings Pro card stays neutral until entitlement resolution finishes", () => {
  assert.deepEqual(
    resolveSettingsProCardState({
      confirmedIsPro: null,
      isRefreshing: true,
    }),
    {
      status: "checking",
      subtitle: "Checking subscription...",
      badgeLabel: null,
    },
  );
});

test("Settings Pro card shows the stable free state after a confirmed refresh", () => {
  assert.deepEqual(
    resolveSettingsProCardState({
      confirmedIsPro: false,
      isRefreshing: false,
    }),
    {
      status: "inactive",
      subtitle: "No subscription",
      badgeLabel: "Upgrade",
    },
  );
});

test("trial, paid, lifetime, and manual Pro entitlements all show Pro active", () => {
  for (const entitlement of ["trial", "monthly", "yearly", "lifetime", "manual"]) {
    assert.deepEqual(
      resolveSettingsProCardState({
        confirmedIsPro: true,
        isRefreshing: false,
      }),
      {
        status: "active",
        subtitle: "Pro active",
        badgeLabel: "Manage",
      },
      entitlement,
    );
  }
});

test("a background refresh retains the last confirmed Settings Pro card state", () => {
  assert.equal(
    resolveSettingsProCardState({
      confirmedIsPro: true,
      isRefreshing: true,
    }).status,
    "active",
  );
  assert.equal(
    resolveSettingsProCardState({
      confirmedIsPro: false,
      isRefreshing: true,
    }).status,
    "inactive",
  );
});
