const test = require("node:test");
const assert = require("node:assert/strict");

const {
  getDashboardAppointmentActionRows,
} = require("../lib/dashboardAppointmentActions.ts");

test("320px dashboard width uses a two-by-two action grid", () => {
  assert.deepEqual(getDashboardAppointmentActionRows(320), [
    ["edit", "status"],
    ["edit_client", "delete"],
  ]);
});

test("360px dashboard width uses a two-by-two action grid", () => {
  assert.deepEqual(getDashboardAppointmentActionRows(360), [
    ["edit", "status"],
    ["edit_client", "delete"],
  ]);
});

test("390px dashboard width uses a two-by-two action grid", () => {
  assert.deepEqual(getDashboardAppointmentActionRows(390), [
    ["edit", "status"],
    ["edit_client", "delete"],
  ]);
});

test("tablet dashboard width keeps the four-across action row", () => {
  assert.deepEqual(getDashboardAppointmentActionRows(768), [
    ["edit", "edit_client", "status", "delete"],
  ]);
});
