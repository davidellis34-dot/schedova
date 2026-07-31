const test = require("node:test");
const assert = require("node:assert/strict");

const {
  getOpenActionableConversationThreadCount,
  getOpenActionableConversationThreadIds,
  getUnreadUnresolvedMessageCount,
  getUnreadUnresolvedMessages,
} = require("../lib/messageBadge.ts");

test("the message badge includes only unread, unresolved inbound messages", () => {
  const messages = [
    { id: "unread-open", direction: "inbound", read_at: null, resolved_at: null },
    { id: "read-open", direction: "inbound", read_at: "2026-07-27T10:00:00Z", resolved_at: null },
    { id: "unread-resolved", direction: "inbound", read_at: null, resolved_at: "2026-07-27T10:00:00Z" },
    { id: "outbound", direction: "outbound", read_at: null, resolved_at: null },
  ];

  assert.equal(getUnreadUnresolvedMessageCount(messages), 1);
  assert.deepEqual(getUnreadUnresolvedMessages(messages).map((message) => message.id), ["unread-open"]);
});

test("no threads have a zero badge count", () => {
  assert.equal(getOpenActionableConversationThreadCount([]), 0);
});

test("one unread inbound thread has a badge count of one", () => {
  assert.equal(
    getOpenActionableConversationThreadCount([
      { id: "message-1", conversation_id: "thread-1", direction: "inbound", read_at: null, resolved_at: null },
    ]),
    1,
  );
});

test("three unread rows in one thread count once", () => {
  const messages = ["1", "2", "3"].map((id) => ({
    id,
    conversation_id: "thread-1",
    direction: "inbound",
    read_at: null,
    resolved_at: null,
  }));

  assert.equal(getOpenActionableConversationThreadCount(messages), 1);
  assert.deepEqual(getOpenActionableConversationThreadIds(messages), ["thread-1"]);
});

test("two open actionable threads count twice", () => {
  const messages = [
    { id: "message-1", conversation_id: "thread-1", direction: "inbound", read_at: null, resolved_at: null },
    { id: "message-2", conversation_id: "thread-2", direction: "inbound", read_at: null, resolved_at: null },
  ];

  assert.equal(getOpenActionableConversationThreadCount(messages), 2);
});

test("reading or resolving a message updates the derived badge count immediately", () => {
  const openMessage = { id: "message-1", direction: "inbound", read_at: null, resolved_at: null };

  assert.equal(getOpenActionableConversationThreadCount([openMessage]), 1);
  assert.equal(getOpenActionableConversationThreadCount([{ ...openMessage, read_at: "2026-07-27T10:00:00Z" }]), 0);
  assert.equal(getOpenActionableConversationThreadCount([{ ...openMessage, resolved_at: "2026-07-27T10:00:00Z" }]), 0);
});

test("outbound-only, resolved, and archived threads do not count", () => {
  const messages = [
    { id: "outbound", conversation_id: "outbound-thread", direction: "outbound", read_at: null, resolved_at: null },
    { id: "resolved", conversation_id: "resolved-thread", direction: "inbound", read_at: null, resolved_at: "2026-07-27T09:00:00Z" },
    { id: "archived", conversation_id: "archived-thread", direction: "inbound", read_at: null, resolved_at: null, status: "archived" },
  ];

  assert.equal(getOpenActionableConversationThreadCount(messages), 0);
});

test("a reopened inbound thread is included while hidden system records are ignored", () => {
  const messages = [
    { id: "reopened", conversation_id: "reopened-thread", direction: "inbound", read_at: null, resolved_at: null },
    { id: "system", conversation_id: "system-thread", direction: "inbound", read_at: null, resolved_at: null, metadata: { internal: true } },
  ];

  assert.equal(getOpenActionableConversationThreadCount(messages), 1);
});

test("mixed records count only distinct actionable inbound threads", () => {
  const messages = [
    { id: "one", conversation_id: "thread-1", direction: "inbound", read_at: null, resolved_at: null },
    { id: "two", conversation_id: "thread-1", direction: "inbound", read_at: null, resolved_at: null },
    { id: "three", conversation_id: "thread-2", direction: "outbound", read_at: null, resolved_at: null },
    { id: "four", conversation_id: "thread-3", direction: "inbound", read_at: null, resolved_at: "2026-07-27T09:00:00Z" },
    { id: "five", conversation_id: "thread-4", direction: "inbound", read_at: null, resolved_at: null, metadata: { hidden: true } },
    { id: "six", conversation_id: "thread-5", direction: "inbound", read_at: null, resolved_at: null },
  ];

  assert.equal(getOpenActionableConversationThreadCount(messages), 2);
});
