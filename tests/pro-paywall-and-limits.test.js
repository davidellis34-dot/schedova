const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildMonthlyPlanCopy,
  resolvePurchaseFlowOutcome,
} = require("../lib/proPaywallUtils.ts");
const {
  FREE_TIER_LIMITS,
  countActiveClients,
  countAppointmentsInMonth,
  getAppointmentCreationAccess,
  getClientCreationAccess,
  hasUnlimitedFreePlanAccess,
} = require("../lib/freePlanLimits.ts");

const MONTHLY_TRIAL_PRODUCT = {
  priceString: "$19.99",
  defaultOption: {
    billingPeriod: { unit: "MONTH", value: 1 },
    freePhase: {
      billingPeriod: { unit: "DAY", value: 14 },
    },
  },
};

test("trial-eligible paywall copy shows 14-day trial and renewal price", () => {
  const copy = buildMonthlyPlanCopy({
    product: MONTHLY_TRIAL_PRODUCT,
    trialEligibility: "eligible",
  });

  assert.equal(copy.ctaLabel, "Start 14-Day Free Trial");
  assert.equal(
    copy.priceLine,
    "Free for 14 days, then $19.99 / month. Cancel anytime.",
  );
  assert.equal(
    copy.autoRenewNotice,
    "Payment starts automatically after the trial unless canceled first.",
  );
});

test("trial-ineligible paywall copy does not promise a trial", () => {
  const copy = buildMonthlyPlanCopy({
    product: MONTHLY_TRIAL_PRODUCT,
    trialEligibility: "ineligible",
  });

  assert.equal(copy.ctaLabel, "Subscribe Monthly");
  assert.equal(copy.priceLine, "$19.99 / month. Cancel anytime.");
  assert.equal(
    copy.autoRenewNotice,
    "Payment starts right away and renews automatically unless canceled.",
  );
});

test("missing RevenueCat or store pricing falls back safely", () => {
  const copy = buildMonthlyPlanCopy({
    product: null,
    trialEligibility: "unknown",
  });

  assert.equal(copy.ctaLabel, "View Pro Plans");
  assert.equal(
    copy.priceLine,
    "Monthly pricing will load from the App Store or Google Play before checkout.",
  );
  assert.equal(
    copy.autoRenewNotice,
    "The App Store or Google Play will show the final renewal terms before checkout.",
  );
});

test("archived clients do not count toward the free client limit", () => {
  const clients = Array.from({ length: FREE_TIER_LIMITS.clients }, (_, index) => ({
    id: String(index + 1),
    archived_at: null,
  })).concat([
    { id: "archived-1", archived_at: "2026-07-01T12:00:00.000Z" },
    { id: "archived-2", archived_at: "2026-07-02T12:00:00.000Z" },
  ]);

  assert.equal(countActiveClients(clients), FREE_TIER_LIMITS.clients);

  const access = getClientCreationAccess({
    activeClientCount: countActiveClients(clients),
    isUnlimited: false,
  });

  assert.equal(access.canCreate, false);
  assert.equal(access.atLimit, true);
});

test("existing over-limit free users keep editing access but cannot add clients", () => {
  const access = getClientCreationAccess({
    activeClientCount: FREE_TIER_LIMITS.clients + 3,
    isUnlimited: false,
  });

  assert.equal(access.canCreate, false);
  assert.equal(access.canEditExisting, true);
  assert.equal(access.overLimit, true);
});

test("canceled and deleted appointments do not count toward the monthly limit", () => {
  const monthKey = "2026-07";
  const appointments = [
    { appointment_date: "2026-07-01", status: "scheduled", deleted_at: null },
    { appointment_date: "2026-07-02", status: "completed", deleted_at: null },
    { appointment_date: "2026-07-03", status: "canceled", deleted_at: null },
    { appointment_date: "2026-07-04", status: "cancelled", deleted_at: null },
    {
      appointment_date: "2026-07-05",
      status: "scheduled",
      deleted_at: "2026-07-05T12:00:00.000Z",
    },
    { appointment_date: "2026-08-01", status: "scheduled", deleted_at: null },
  ];

  assert.equal(countAppointmentsInMonth(appointments, monthKey), 2);
});

test("free users cannot create the 51st counted appointment in a local month", () => {
  const access = getAppointmentCreationAccess({
    existingCount: FREE_TIER_LIMITS.appointmentsPerMonth,
    requestedCount: 1,
    isUnlimited: false,
  });

  assert.equal(access.canCreate, false);
  assert.equal(access.atLimit, true);
});

test("existing over-limit free users keep editing access but cannot add appointments", () => {
  const access = getAppointmentCreationAccess({
    existingCount: FREE_TIER_LIMITS.appointmentsPerMonth + 4,
    requestedCount: 1,
    isUnlimited: false,
  });

  assert.equal(access.canCreate, false);
  assert.equal(access.canEditExisting, true);
  assert.equal(access.overLimit, true);
});

test("all Pro entitlement types bypass the free limits", () => {
  const unlimitedSubscriptions = [
    {
      status: "active",
      plan: "monthly",
      entitlement: "schedova_pro",
      entitlement_expires_at: "2099-01-01T00:00:00.000Z",
    },
    {
      status: "active",
      plan: "yearly",
      entitlement: "schedova_pro",
      entitlement_expires_at: "2099-01-01T00:00:00.000Z",
    },
    {
      status: "active",
      plan: "trial",
      entitlement: "schedova_pro",
      entitlement_expires_at: "2099-01-01T00:00:00.000Z",
    },
    {
      status: "active",
      plan: "lifetime",
      entitlement_source: "admin",
      entitlement_expires_at: "2099-01-01T00:00:00.000Z",
    },
    {
      status: "active",
      entitlement_source: "manual",
      entitlement_expires_at: "2099-01-01T00:00:00.000Z",
    },
  ];

  for (const subscription of unlimitedSubscriptions) {
    assert.equal(hasUnlimitedFreePlanAccess(subscription), true);

    const clientAccess = getClientCreationAccess({
      activeClientCount: 250,
      isUnlimited: hasUnlimitedFreePlanAccess(subscription),
    });
    const appointmentAccess = getAppointmentCreationAccess({
      existingCount: 500,
      requestedCount: 10,
      isUnlimited: hasUnlimitedFreePlanAccess(subscription),
    });

    assert.equal(clientAccess.canCreate, true);
    assert.equal(appointmentAccess.canCreate, true);
  }
});

test("purchase outcome helper distinguishes success, cancellation, delay, and failure", () => {
  assert.equal(
    resolvePurchaseFlowOutcome({ purchaseCompleted: true }),
    "success",
  );
  assert.equal(
    resolvePurchaseFlowOutcome({ purchaseCancelled: true }),
    "cancelled",
  );
  assert.equal(
    resolvePurchaseFlowOutcome({ refreshDelayed: true }),
    "pending_refresh",
  );
  assert.equal(resolvePurchaseFlowOutcome({}), "failure");
});
