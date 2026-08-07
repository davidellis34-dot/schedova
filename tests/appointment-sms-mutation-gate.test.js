const test = require("node:test");
const assert = require("node:assert/strict");

const {
  isAppointmentSmsEnabled,
  shouldRunAppointmentSmsMutation,
} = require("../lib/appointmentSmsMutationGate.ts");

for (const mutation of ["create", "update", "cancellation", "deletion"]) {
  test(`appointment ${mutation} sends SMS only when explicitly enabled`, () => {
    assert.equal(
      shouldRunAppointmentSmsMutation({
        mutation,
        smsAutomationAvailable: true,
        smsNotificationsEnabled: true,
      }),
      true,
    );
    assert.equal(
      shouldRunAppointmentSmsMutation({
        mutation,
        smsAutomationAvailable: true,
        smsNotificationsEnabled: false,
      }),
      false,
    );
  });
}

test("legacy null delivery state does not send appointment SMS", () => {
  for (const mutation of ["create", "update", "cancellation", "deletion"]) {
    assert.equal(
      shouldRunAppointmentSmsMutation({
        mutation,
        smsAutomationAvailable: true,
        smsNotificationsEnabled: null,
      }),
      false,
    );
  }
});

test("appointment SMS mutation gate respects feature access", () => {
  for (const mutation of ["create", "update", "cancellation", "deletion"]) {
    assert.equal(
      shouldRunAppointmentSmsMutation({
        mutation,
        smsAutomationAvailable: false,
        smsNotificationsEnabled: true,
      }),
      false,
    );
  }
});

test("explicit SMS-enabled state requires a true boolean", () => {
  assert.equal(isAppointmentSmsEnabled(true), true);
  assert.equal(isAppointmentSmsEnabled(false), false);
  assert.equal(isAppointmentSmsEnabled(null), false);
  assert.equal(isAppointmentSmsEnabled(undefined), false);
});
