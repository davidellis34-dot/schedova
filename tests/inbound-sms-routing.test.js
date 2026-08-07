const test = require("node:test");
const assert = require("node:assert/strict");

const {
  resolveInboundSmsTenantContext,
  resolveScopedInboundSmsClient,
} = require("../lib/inboundSmsRouting.ts");

function context(overrides = {}) {
  return {
    id: "ctx-1",
    user_id: "business-a",
    client_id: "client-a",
    appointment_id: "appointment-a",
    message_type: "confirmation",
    created_at: "2026-08-07T13:45:23.549Z",
    ...overrides,
  };
}

function client(overrides = {}) {
  return {
    id: "client-a",
    user_id: "business-a",
    name: "Client A",
    phone: "+13364884005",
    created_at: "2026-08-07T12:00:00.000Z",
    updated_at: "2026-08-07T13:00:00.000Z",
    archived_at: null,
    ...overrides,
  };
}

test("reply to a confirmation routes to the latest outbound business", () => {
  const result = resolveInboundSmsTenantContext([
    context(),
    context({
      id: "ctx-older",
      user_id: "business-b",
      client_id: "client-b",
      appointment_id: "appointment-b",
      created_at: "2026-08-07T12:00:00.000Z",
    }),
  ]);

  assert.equal(result.status, "resolved");
  assert.equal(result.userId, "business-a");
  assert.equal(result.context.client_id, "client-a");
});

for (const messageType of ["reminder", "update", "cancellation", "manual"]) {
  test(`reply to a ${messageType} uses the same tenant-safe outbound thread lookup`, () => {
    const result = resolveInboundSmsTenantContext([
      context({
        id: `ctx-${messageType}`,
        message_type: messageType,
      }),
      context({
        id: `ctx-${messageType}-older`,
        user_id: "business-b",
        client_id: "client-b",
        appointment_id: "appointment-b",
        message_type: messageType,
        created_at: "2026-08-07T12:00:00.000Z",
      }),
    ]);

    assert.equal(result.status, "resolved");
    assert.equal(result.userId, "business-a");
    assert.equal(result.context.message_type, messageType);
  });
}

test("ambiguous shared-number replies are held instead of cross-routed", () => {
  const result = resolveInboundSmsTenantContext([
    context({
      id: "ctx-a",
      user_id: "business-a",
      created_at: "2026-08-07T13:45:23.549Z",
    }),
    context({
      id: "ctx-b",
      user_id: "business-b",
      client_id: "client-b",
      appointment_id: "appointment-b",
      created_at: "2026-08-07T13:45:23.549Z",
    }),
  ]);

  assert.equal(result.status, "unresolved");
  assert.equal(result.reason, "ambiguous_recent_outbound_context");
  assert.deepEqual(result.candidateUserIds.sort(), ["business-a", "business-b"]);
});

test("same customer phone in both businesses never triggers global cross-tenant fallback", () => {
  const result = resolveInboundSmsTenantContext([]);

  assert.equal(result.status, "unresolved");
  assert.equal(result.reason, "no_recent_outbound_context");
});

test("scoped client matching stays inside the resolved business", () => {
  const result = resolveScopedInboundSmsClient({
    tenantUserId: "business-a",
    contextClientId: "client-a",
    normalizedFromNumber: "+13364884005",
    clientRows: [
      client(),
      client({
        id: "client-b",
        user_id: "business-b",
        name: "Client B",
      }),
    ],
  });

  assert.equal(result.client?.id, "client-a");
  assert.equal(result.reason, "matched_context_client");
});

test("phone-based fallback remains scoped to the matched business", () => {
  const result = resolveScopedInboundSmsClient({
    tenantUserId: "business-a",
    contextClientId: null,
    normalizedFromNumber: "+13364884005",
    clientRows: [
      client({
        id: "client-a-older",
        updated_at: "2026-08-07T12:30:00.000Z",
      }),
      client({
        id: "client-a-newer",
        updated_at: "2026-08-07T13:30:00.000Z",
      }),
      client({
        id: "client-b",
        user_id: "business-b",
        updated_at: "2026-08-07T14:30:00.000Z",
      }),
    ],
  });

  assert.equal(result.client?.id, "client-a-newer");
  assert.equal(result.reason, "matched_scoped_phone");
  assert.equal(result.matchCount, 2);
});

test("missing context client still falls back only within the resolved business", () => {
  const result = resolveScopedInboundSmsClient({
    tenantUserId: "business-a",
    contextClientId: "deleted-client",
    normalizedFromNumber: "+13364884005",
    clientRows: [
      client({ id: "client-a-fallback" }),
      client({
        id: "client-b",
        user_id: "business-b",
      }),
    ],
  });

  assert.equal(result.client?.id, "client-a-fallback");
  assert.equal(result.reason, "matched_scoped_phone_after_missing_context_client");
});
