const test = require("node:test");
const assert = require("node:assert/strict");

const { getRebookingDueDate } = require("../lib/smartReminderUtils.ts");
const {
  getSmartReminderSnoozeDate,
  isSmartReminderBlocked,
} = require("../lib/smartReminderState.ts");

test("calculates day, week, and month rebooking dates with local calendar dates", () => {
  assert.equal(getRebookingDueDate("2026-08-03", 10, "days"), "2026-08-13");
  assert.equal(getRebookingDueDate("2026-08-03", 2, "weeks"), "2026-08-17");
  assert.equal(getRebookingDueDate("2026-08-03", 1, "months"), "2026-09-03");
});

test("rejects incomplete or invalid rebooking intervals", () => {
  assert.equal(getRebookingDueDate("2026-08-03", 0, "days"), null);
  assert.equal(getRebookingDueDate("2026-08-03", 1.5, "weeks"), null);
  assert.equal(getRebookingDueDate("invalid", 1, "months"), null);
});

test("reminder state transitions hide dismissed, sending, and sent reminders", () => {
  const now = new Date("2026-08-03T12:00:00.000Z");

  assert.equal(isSmartReminderBlocked({ action: "dismissed", remind_after: null }, now), true);
  assert.equal(isSmartReminderBlocked({ action: "sending", remind_after: null }, now), true);
  assert.equal(isSmartReminderBlocked({ action: "sent", remind_after: null }, now), true);
  assert.equal(isSmartReminderBlocked({ action: "remind_later", remind_after: "2026-08-10T12:00:00.000Z" }, now), true);
  assert.equal(isSmartReminderBlocked({ action: "remind_later", remind_after: "2026-08-01T12:00:00.000Z" }, now), false);
});

test("remind later creates a future, explicit snooze date", () => {
  assert.equal(
    getSmartReminderSnoozeDate(new Date("2026-08-03T12:00:00.000Z"), 7),
    "2026-08-10T12:00:00.000Z",
  );
});
