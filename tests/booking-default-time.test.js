const test = require("node:test");
const assert = require("node:assert/strict");

const {
  getSuggestedBookingDateTime,
} = require("../lib/bookingDefaultTime.ts");

test("fresh-account booking defaults to the next rounded daytime slot", () => {
  const result = getSuggestedBookingDateTime({
    intervalMinutes: 30,
    now: new Date(2026, 7, 14, 14, 10, 0, 0),
  });

  assert.deepEqual(result, {
    date: "2026-08-14",
    time: "14:30",
  });
});

test("late-night booking defaults to the next day around 9 AM", () => {
  const result = getSuggestedBookingDateTime({
    intervalMinutes: 30,
    now: new Date(2026, 7, 14, 20, 10, 0, 0),
  });

  assert.deepEqual(result, {
    date: "2026-08-15",
    time: "09:00",
  });
});
