const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildDashboardSetupChecklist,
  hasCompletedFirstAppointment,
} = require("../lib/dashboardSetupChecklist.ts");

test("dashboard setup checklist counts only active clients and non-canceled appointments", () => {
  const checklist = buildDashboardSetupChecklist({
    hasBusiness: true,
    hasBusinessHours: false,
    hasReviewedSmsSettings: false,
    clients: [
      { archived_at: "2026-08-20T12:00:00.000Z" },
      { archived_at: null },
    ],
    appointments: [
      { status: "canceled" },
      { status: "scheduled" },
    ],
    services: [{ id: "service-1" }],
    firstBookingEntryRoute: "/quick-start",
  });

  assert.equal(checklist[0].complete, true);
  assert.equal(checklist[1].complete, true);
  assert.equal(checklist[2].complete, true);
  assert.equal(checklist[3].complete, true);
  assert.equal(checklist[4].complete, false);
  assert.equal(checklist[5].complete, false);
});

test("dashboard setup checklist leaves SMS review and business hours incomplete until confirmed", () => {
  const checklist = buildDashboardSetupChecklist({
    hasBusiness: true,
    hasBusinessHours: true,
    hasReviewedSmsSettings: true,
    clients: [],
    appointments: [],
    services: [],
    firstBookingEntryRoute: "/book-appointment",
  });

  assert.equal(checklist[0].complete, true);
  assert.equal(checklist[1].complete, false);
  assert.equal(checklist[2].complete, false);
  assert.equal(checklist[3].complete, false);
  assert.equal(checklist[4].complete, true);
  assert.equal(checklist[5].complete, true);
  assert.equal(checklist[3].route, "/book-appointment");
});

test("canceled appointments alone do not complete the first appointment setup step", () => {
  assert.equal(
    hasCompletedFirstAppointment([
      { status: "canceled" },
      { status: "cancelled" },
    ]),
    false,
  );
  assert.equal(
    hasCompletedFirstAppointment([
      { status: "confirmed" },
      { status: "canceled" },
    ]),
    true,
  );
});
