const test = require("node:test");
const assert = require("node:assert/strict");

const {
  createPrimaryCommunicationRecipient,
  syncPrimaryCommunicationRecipient,
} = require("../lib/primaryCommunicationRecipient.ts");

test("primary recipient does not become email-enabled without explicit email consent", () => {
  const primary = syncPrimaryCommunicationRecipient(
    createPrimaryCommunicationRecipient({}),
    {
      name: "Jordan",
      phone: "",
      email: "jordan@example.com",
      smsOptIn: false,
      emailOptIn: false,
      fallbackName: "Jordan",
    },
  );

  assert.equal(primary.email, "jordan@example.com");
  assert.equal(primary.emailEnabled, false);
});

test("primary recipient becomes email-enabled only when email consent and email are both present", () => {
  const primary = syncPrimaryCommunicationRecipient(
    createPrimaryCommunicationRecipient({}),
    {
      name: "Jordan",
      phone: "",
      email: "jordan@example.com",
      smsOptIn: false,
      emailOptIn: true,
      fallbackName: "Jordan",
    },
  );

  assert.equal(primary.emailEnabled, true);
});

test("primary recipient sync replaces stale contact details with edited top-level values", () => {
  const primary = syncPrimaryCommunicationRecipient(
    {
      id: "recipient-1",
      clientId: "client-1",
      name: "Old Name",
      relationship: "",
      phone: "1111111111",
      email: "old@example.com",
      smsEnabled: true,
      emailEnabled: true,
      isPrimary: true,
    },
    {
      clientId: "client-1",
      name: "New Name",
      phone: "2222222222",
      email: "new@example.com",
      smsOptIn: false,
      emailOptIn: false,
      fallbackName: "New Name",
    },
  );

  assert.equal(primary.id, "recipient-1");
  assert.equal(primary.name, "New Name");
  assert.equal(primary.phone, "2222222222");
  assert.equal(primary.email, "new@example.com");
  assert.equal(primary.smsEnabled, false);
  assert.equal(primary.emailEnabled, false);
});

test("primary recipient falls back to the best available display name and clears channel eligibility without contact data", () => {
  const primary = syncPrimaryCommunicationRecipient(
    createPrimaryCommunicationRecipient({}),
    {
      name: "",
      phone: "",
      email: "",
      smsOptIn: true,
      emailOptIn: true,
      fallbackName: "Fallback Name",
    },
  );

  assert.equal(primary.name, "Fallback Name");
  assert.equal(primary.smsEnabled, false);
  assert.equal(primary.emailEnabled, false);
});
