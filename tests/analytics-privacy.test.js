const test = require("node:test");
const assert = require("node:assert/strict");

const {
  filterSafeAnalyticsProperties,
  getAppointmentCreateAnalyticsEvents,
  getAppointmentMilestoneEvents,
  normalizeSafeAnalyticsReasonCode,
  normalizeSafeAnalyticsProperties,
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

test("successful appointment creation emits the generic appointment_created event", () => {
  assert.deepEqual(getAppointmentCreateAnalyticsEvents(0, 1), [
    "appointment_created",
    "first_appointment_created",
  ]);
});

test("successful appointment creation still emits the generic event when the count lookup is unavailable", () => {
  assert.deepEqual(getAppointmentCreateAnalyticsEvents(null, 1), [
    "appointment_created",
  ]);
});

test("failed appointment creation does not emit success events", () => {
  assert.deepEqual(getAppointmentCreateAnalyticsEvents(0, 0), []);
});

test("later appointments do not incorrectly emit the first appointment milestone", () => {
  assert.deepEqual(getAppointmentCreateAnalyticsEvents(1, 1), [
    "appointment_created",
    "second_appointment_created",
  ]);
  assert.deepEqual(getAppointmentCreateAnalyticsEvents(2, 1), [
    "appointment_created",
  ]);
});

test("filterSafeAnalyticsProperties keeps only internal and approved analytics fields", () => {
  assert.deepEqual(
    filterSafeAnalyticsProperties({
      token: "api-key",
      distinct_id: "user-123",
      platform: "ios",
      app_version: "1.2.6",
      flow: "standard_booking",
      reason_code: "free_limit",
      is_first: true,
      client_name: "Should be removed",
      phone: "Should also be removed",
      $lib: "posthog-react-native",
    }),
    {
      token: "api-key",
      distinct_id: "user-123",
      platform: "ios",
      app_version: "1.2.6",
      flow: "standard_booking",
      reason_code: "free_limit",
      is_first: true,
      $lib: "posthog-react-native",
    },
  );
});

test("normalizeSafeAnalyticsProperties keeps only allowlisted safe values", () => {
  assert.deepEqual(
    normalizeSafeAnalyticsProperties({
      screen_name: "  Book Appointment  ",
      flow: "First Booking Activation",
      reason_code: "Availability Conflict",
      is_first: true,
      client_name: "Private Client",
      appointment_time: "09:00",
    }),
    {
      screen_name: "book_appointment",
      flow: "first_booking_activation",
      reason_code: "availability_conflict",
      is_first: true,
    },
  );
});

test("unknown reason codes are reduced to safe analytics values", () => {
  assert.equal(
    normalizeSafeAnalyticsReasonCode("permission denied for row 123"),
    "unknown_error",
  );
  assert.equal(
    normalizeSafeAnalyticsReasonCode("availability_conflict"),
    "availability_conflict",
  );
});

test("sanitizeAnalyticsCaptureEvent strips unsafe event and person properties", () => {
  assert.deepEqual(
    sanitizeAnalyticsCaptureEvent({
      event: "first_booking_save_completed",
      properties: {
        token: "api-key",
        platform: "ios",
        flow: "standard_booking",
        reason_code: "free_limit",
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
        flow: "standard_booking",
        reason_code: "free_limit",
      },
      $set: {
        business_category: "hair",
      },
      $set_once: undefined,
    },
  );
});
