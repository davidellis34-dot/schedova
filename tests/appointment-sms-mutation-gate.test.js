const test = require("node:test");
const assert = require("node:assert/strict");

const {
  shouldRunAppointmentSmsMutation,
} = require("../lib/appointmentSmsMutationGate.ts");

test("appointment create does not schedule SMS when SMS is disabled", () => {
  assert.equal(
    shouldRunAppointmentSmsMutation({
      mutation: "create",
      smsAutomationAvailable: true,
      smsNotificationsEnabled: false,
    }),
    false,
  );
});

test("appointment update does not schedule SMS when SMS is disabled", () => {
  assert.equal(
    shouldRunAppointmentSmsMutation({
      mutation: "update",
      smsAutomationAvailable: true,
      smsNotificationsEnabled: false,
    }),
    false,
  );
});

test("appointment cancellation does not send SMS when SMS is disabled", () => {
  assert.equal(
    shouldRunAppointmentSmsMutation({
      mutation: "cancellation",
      smsAutomationAvailable: true,
      smsNotificationsEnabled: false,
    }),
    false,
  );
});

test("appointment deletion does not send SMS when SMS is disabled", () => {
  assert.equal(
    shouldRunAppointmentSmsMutation({
      mutation: "deletion",
      smsAutomationAvailable: true,
      smsNotificationsEnabled: false,
    }),
    false,
  );
});

test("appointment create and update require SMS to be explicitly enabled", () => {
  assert.equal(
    shouldRunAppointmentSmsMutation({
      mutation: "create",
      smsAutomationAvailable: true,
      smsNotificationsEnabled: true,
    }),
    true,
  );
  assert.equal(
    shouldRunAppointmentSmsMutation({
      mutation: "update",
      smsAutomationAvailable: true,
      smsNotificationsEnabled: true,
    }),
    true,
  );
});

test("appointment cancellation and deletion keep legacy fallback behavior unless SMS is explicitly disabled", () => {
  assert.equal(
    shouldRunAppointmentSmsMutation({
      mutation: "cancellation",
      smsAutomationAvailable: true,
      smsNotificationsEnabled: null,
    }),
    true,
  );
  assert.equal(
    shouldRunAppointmentSmsMutation({
      mutation: "deletion",
      smsAutomationAvailable: true,
      smsNotificationsEnabled: null,
    }),
    true,
  );
});

test("appointment SMS mutation gate respects feature access", () => {
  assert.equal(
    shouldRunAppointmentSmsMutation({
      mutation: "create",
      smsAutomationAvailable: false,
      smsNotificationsEnabled: true,
    }),
    false,
  );
  assert.equal(
    shouldRunAppointmentSmsMutation({
      mutation: "cancellation",
      smsAutomationAvailable: false,
      smsNotificationsEnabled: null,
    }),
    false,
  );
});
