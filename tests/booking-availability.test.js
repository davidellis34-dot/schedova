const test = require("node:test");
const assert = require("node:assert/strict");

const {
  checkBookingAvailability,
} = require("../lib/bookingAvailability.ts");

test("zero availability rules are treated as not configured yet", () => {
  const result = checkBookingAvailability({
    dateText: "2026-08-14",
    startTime: "20:30",
    endTime: "21:00",
    rules: [],
  });

  assert.equal(result.allowed, true);
  assert.equal(result.reason, "unconfigured");
});

test("configured business hours still block appointments outside the saved window", () => {
  const result = checkBookingAvailability({
    dateText: "2026-08-14",
    startTime: "18:30",
    endTime: "19:00",
    rules: [
      {
        day_of_week: 5,
        is_available: true,
        start_time: "09:00",
        end_time: "17:00",
      },
    ],
  });

  assert.equal(result.allowed, false);
  assert.equal(result.reason, "outside_hours");
});
