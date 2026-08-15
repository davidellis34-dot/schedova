const test = require("node:test");
const assert = require("node:assert/strict");

const {
  filterSafeAnalyticsProperties,
  getAppointmentMilestoneEvents,
  normalizeBusinessCategory,
  sanitizeAnalyticsText,
  sanitizeAnalyticsCaptureEvent,
} = require("../lib/analyticsPrivacy");

test("sanitizeAnalyticsText normalizes acquisition-safe text", () => {
  assert.equal(
    sanitizeAnalyticsText("  Facebook Ads / Summer 2026  "),
    "facebook_ads_summer_2026",
  );
  assert.equal(sanitizeAnalyticsText(""), null);
  assert.equal(sanitizeAnalyticsText(null), null);
});

test("normalizeBusinessCategory maps broad business categories only", () => {
  assert.equal(normalizeBusinessCategory("Barber and stylist"), "hair");
  assert.equal(normalizeBusinessCategory("Nail Tech"), "nails");
  assert.equal(normalizeBusinessCategory("Hyper-specific private studio"), null);
});

test("getAppointmentMilestoneEvents tracks first and second creation milestones once", () => {
  assert.deepEqual(getAppointmentMilestoneEvents(0, 1), [
    "first_appointment_created",
  ]);
  assert.deepEqual(getAppointmentMilestoneEvents(1, 1), [
    "second_appointment_created",
  ]);
  assert.deepEqual(getAppointmentMilestoneEvents(0, 2), [
    "first_appointment_created",
    "second_appointment_created",
  ]);
  assert.deepEqual(getAppointmentMilestoneEvents(2, 1), []);
});

test("filterSafeAnalyticsProperties keeps only internal and approved analytics fields", () => {
  assert.deepEqual(
    filterSafeAnalyticsProperties({
      token: "api-key",
      distinct_id: "user-123",
      platform: "ios",
      app_version: "1.2.6",
      client_name: "Should be removed",
      phone: "Should also be removed",
      $lib: "posthog-react-native",
    }),
    {
      token: "api-key",
      distinct_id: "user-123",
      platform: "ios",
      app_version: "1.2.6",
      $lib: "posthog-react-native",
    },
  );
});

test("sanitizeAnalyticsCaptureEvent strips unsafe event and person properties", () => {
  assert.deepEqual(
    sanitizeAnalyticsCaptureEvent({
      event: "first_booking_save_completed",
      properties: {
        token: "api-key",
        platform: "ios",
        appointment_time: "09:00",
      },
      $set: {
        business_category: "hair",
        client_name: "Private client",
      },
    }),
    {
      event: "first_booking_save_completed",
      properties: {
        token: "api-key",
        platform: "ios",
      },
      $set: {
        business_category: "hair",
      },
      $set_once: undefined,
    },
  );
});
