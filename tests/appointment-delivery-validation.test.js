const test = require("node:test");
const assert = require("node:assert/strict");

const {
  getAvailableAppointmentDeliveryChoice,
  getAppointmentDeliveryChoiceFromFlags,
  resolveAppointmentDeliveryValidation,
  SMS_DELIVERY_WARNING,
} = require("../lib/appointmentDelivery.ts");

function recipient(overrides = {}) {
  return {
    id: "recipient-1",
    clientId: "client-1",
    name: "Client Contact",
    relationship: "",
    phone: "",
    email: "",
    smsEnabled: false,
    emailEnabled: false,
    ...overrides,
  };
}

async function validate(deliveryChoice, recipients) {
  return await resolveAppointmentDeliveryValidation({
    deliveryChoice,
    recipients,
    normalizePhone: (value) => {
      const digits = String(value || "").replace(/\D/g, "");
      return digits.length === 10 ? `+1${digits}` : "";
    },
  });
}

test("SMS off plus no phone number saves successfully", async () => {
  const result = await validate("none", [
    recipient({ smsEnabled: true, phone: "" }),
  ]);

  assert.deepEqual(result.issues, []);
  assert.equal(result.smsEnabled, false);
  assert.equal(result.emailEnabled, false);
});

test("SMS off plus no SMS consent saves successfully", async () => {
  const result = await validate("none", [
    recipient({ smsEnabled: false, phone: "555-123-4567" }),
  ]);

  assert.deepEqual(result.issues, []);
  assert.equal(result.recipients[0].smsEnabled, false);
});

test("SMS on plus no phone number is blocked with the existing warning", async () => {
  const result = await validate("text", [
    recipient({ smsEnabled: true, phone: "" }),
  ]);

  assert.deepEqual(result.issues, [SMS_DELIVERY_WARNING]);
  assert.equal(result.smsRecipientCount, 0);
});

test("SMS on plus no consent is blocked with the existing warning", async () => {
  const result = await validate("text", [
    recipient({ smsEnabled: false, phone: "555-123-4567" }),
  ]);

  assert.deepEqual(result.issues, [SMS_DELIVERY_WARNING]);
  assert.equal(result.smsRecipientCount, 0);
});

test("SMS on plus a valid opted-in number passes validation and stays enabled for scheduling", async () => {
  const result = await validate("text", [
    recipient({ smsEnabled: true, phone: "555-123-4567" }),
  ]);

  assert.deepEqual(result.issues, []);
  assert.equal(result.smsEnabled, true);
  assert.equal(result.smsRecipientCount, 1);
  assert.equal(result.recipients[0].phone, "+15551234567");
});

test("Email on with SMS off does not raise an SMS warning", async () => {
  const result = await validate("email", [
    recipient({
      smsEnabled: true,
      phone: "",
      emailEnabled: true,
      email: "client@example.com",
    }),
  ]);

  assert.deepEqual(result.issues, []);
  assert.equal(result.smsEnabled, false);
  assert.equal(result.emailEnabled, true);
  assert.equal(result.emailRecipientCount, 1);
});

test("Both communication methods off saves normally", async () => {
  const result = await validate("none", [recipient()]);

  assert.deepEqual(result.issues, []);
  assert.equal(result.smsEnabled, false);
  assert.equal(result.emailEnabled, false);
});

test("Stale SMS recipient selections are ignored when SMS is off", async () => {
  const result = await validate("email", [
    recipient({
      smsEnabled: true,
      phone: "",
      emailEnabled: true,
      email: "client@example.com",
    }),
  ]);

  assert.deepEqual(result.issues, []);
  assert.equal(result.recipients[0].smsEnabled, false);
  assert.equal(result.smsRecipientCount, 0);
});

test("A text-first selection falls back to email when SMS is unavailable", () => {
  const choice = getAvailableAppointmentDeliveryChoice({
    preferredChoice: "text",
    recipients: [
      recipient({
        smsEnabled: false,
        phone: "",
        emailEnabled: true,
        email: "client@example.com",
      }),
    ],
  });

  assert.equal(choice, "email");
});

test("A stale text-first selection falls back to none when both methods are unavailable", () => {
  const choice = getAvailableAppointmentDeliveryChoice({
    preferredChoice: "text",
    recipients: [recipient({ smsEnabled: true, phone: "" })],
  });

  assert.equal(choice, "none");
});

test("An explicit none choice stays off even when valid recipients exist", () => {
  const choice = getAvailableAppointmentDeliveryChoice({
    preferredChoice: "none",
    recipients: [
      recipient({
        smsEnabled: true,
        phone: "555-123-4567",
        emailEnabled: true,
        email: "client@example.com",
      }),
    ],
  });

  assert.equal(choice, "none");
});

test("Stored appointment delivery flags restore the correct delivery choice", () => {
  assert.equal(
    getAppointmentDeliveryChoiceFromFlags({
      smsEnabled: false,
      emailEnabled: true,
      fallbackChoice: "none",
    }),
    "email",
  );
  assert.equal(
    getAppointmentDeliveryChoiceFromFlags({
      smsEnabled: false,
      emailEnabled: false,
      fallbackChoice: "text",
    }),
    "none",
  );
});
