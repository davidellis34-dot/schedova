const test = require("node:test");
const assert = require("node:assert/strict");

const { resolveThreadOpenTarget } = require("../lib/messagesThreadUtils.ts");

test("opening Send Message reuses the existing normalized SMS thread without sending", () => {
  const result = resolveThreadOpenTarget({
    clientId: "client-1",
    clientName: "Jordan",
    clientPhone: "+1 (555) 222-3333",
    loadedClientName: "Jordan",
    loadedClientPhone: "5552223333",
    messages: [
      {
        id: "sms-older",
        channel: "sms",
        client_id: "client-1",
        sender: "+15552223333",
        recipient: "+15551112222",
        created_at: "2026-07-18T09:00:00.000Z",
      },
      {
        id: "sms-newer",
        channel: "sms",
        client_id: "client-1",
        sender: "+1 555 222 3333",
        recipient: "+1 555 111 2222",
        created_at: "2026-07-19T09:00:00.000Z",
      },
    ],
  });

  assert.equal(result.targetType, "existing");
  assert.equal(result.existingMessage?.id, "sms-newer");
  assert.equal(result.shouldSendImmediately, false);
  assert.equal(result.draftMessage, null);
});

test("opening Send Message creates a blank draft when no thread exists and still sends nothing", () => {
  const result = resolveThreadOpenTarget({
    clientId: "client-2",
    clientName: "Taylor",
    clientPhone: "5554445555",
    loadedClientName: "Taylor",
    loadedClientPhone: "5554445555",
    messages: [],
  });

  assert.equal(result.targetType, "draft");
  assert.equal(result.existingMessage, null);
  assert.equal(result.shouldSendImmediately, false);
  assert.equal(result.draftMessage?.client_id, "client-2");
  assert.equal(result.draftMessage?.recipient, "5554445555");
});
