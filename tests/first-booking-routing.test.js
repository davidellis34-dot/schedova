const test = require("node:test");
const assert = require("node:assert/strict");

const {
  resolveFirstBookingActivationRoute,
  shouldRequireCountryRegionBeforeRoute,
} = require("../lib/firstBookingRouting.ts");

test("accounts with no appointment enter the first-booking flow", () => {
  assert.equal(
    resolveFirstBookingActivationRoute({
      hasExistingAppointment: false,
      activationHandled: false,
    }),
    "/onboarding",
  );
});

test("accounts that already booked continue to the dashboard", () => {
  assert.equal(
    resolveFirstBookingActivationRoute({
      hasExistingAppointment: true,
      activationHandled: false,
    }),
    "/dashboard",
  );
});

test("accounts that dismissed the prompt are not trapped in it", () => {
  assert.equal(
    resolveFirstBookingActivationRoute({
      hasExistingAppointment: false,
      activationHandled: true,
    }),
    "/dashboard",
  );
});

test("first booking comes before country setup", () => {
  assert.equal(shouldRequireCountryRegionBeforeRoute("/onboarding"), false);
  assert.equal(shouldRequireCountryRegionBeforeRoute("/dashboard"), true);
});
