const test = require("node:test");
const assert = require("node:assert/strict");

const {
  inferLegacyAppointmentSmsEnabled,
} = require("../lib/appointmentSmsGate.ts");

test("legacy appointments with saved SMS recipients backfill as SMS-enabled", () => {
  assert.equal(
    inferLegacyAppointmentSmsEnabled({
      savedRecipientSmsEnabled: true,
      appointmentDate: "2026-08-10",
      today: "2026-08-07",
      clientPhone: "",
      clientSmsOptIn: false,
    }),
    true,
  );
});

test("legacy appointments with prior SMS activity stay SMS-enabled", () => {
  assert.equal(
    inferLegacyAppointmentSmsEnabled({
      hasExistingSmsActivity: true,
      appointmentDate: "2026-08-10",
      today: "2026-08-07",
      clientPhone: "",
      clientSmsOptIn: false,
    }),
    true,
  );
  assert.equal(
    inferLegacyAppointmentSmsEnabled({
      smsConfirmationSentAt: "2026-08-07T12:01:48.208Z",
      appointmentDate: "2026-08-10",
      today: "2026-08-07",
      clientPhone: "",
      clientSmsOptIn: false,
    }),
    true,
  );
});

test("future legacy appointments with an SMS-eligible client are backfilled to preserve text behavior", () => {
  assert.equal(
    inferLegacyAppointmentSmsEnabled({
      appointmentDate: "2026-08-14",
      today: "2026-08-07",
      clientPhone: "+13364884005",
      clientSmsOptIn: true,
    }),
    true,
  );
});

test("legacy appointments without saved SMS evidence backfill as disabled", () => {
  assert.equal(
    inferLegacyAppointmentSmsEnabled({
      appointmentDate: "2026-08-14",
      today: "2026-08-07",
      clientPhone: null,
      clientSmsOptIn: true,
    }),
    false,
  );
  assert.equal(
    inferLegacyAppointmentSmsEnabled({
      appointmentDate: "2026-08-01",
      today: "2026-08-07",
      clientPhone: "+13364884005",
      clientSmsOptIn: true,
    }),
    false,
  );
});
