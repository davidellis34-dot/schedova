const test = require("node:test");
const assert = require("node:assert/strict");

const {
  getDashboardBookingEntryRoute,
  shouldShowFirstBookingActivationCard,
} = require("../lib/firstBookingActivation.ts");

test("zero-appointment dashboard shows the activation card", () => {
  assert.equal(shouldShowFirstBookingActivationCard(0), true);
});

test("activation card opens quick-start", () => {
  assert.equal(getDashboardBookingEntryRoute(0), "/quick-start");
});

test("existing users with appointments remain on the normal booking flow", () => {
  assert.equal(shouldShowFirstBookingActivationCard(1), false);
  assert.equal(getDashboardBookingEntryRoute(1), "/book-appointment");
});
