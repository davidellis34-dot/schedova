const test = require("node:test");
const assert = require("node:assert/strict");

const {
  createTextInputDraftTracker,
} = require("../lib/textInputDraft.ts");

test("tracked text input keeps the latest typed value available for an immediate save", () => {
  const tracker = createTextInputDraftTracker("");

  tracker.handleChangeText("Haircut");

  assert.equal(tracker.getValue(), "Haircut");
});

test("tracked text input hydrates existing form values without losing later edits", () => {
  const tracker = createTextInputDraftTracker("");

  tracker.setValue("30");
  tracker.handleChangeText("45");

  assert.equal(tracker.getValue(), "45");
});

test("tracked text input uses the native end-editing payload as the last source of truth", () => {
  const tracker = createTextInputDraftTracker("4");

  tracker.handleChangeText("45");
  tracker.handleEndEditing({ nativeEvent: { text: "50" } });

  assert.equal(tracker.getValue(), "50");
});

test("tracked text input preserves the latest draft when Android blur text arrives empty", () => {
  const tracker = createTextInputDraftTracker("");

  tracker.handleChangeText("Draft");
  tracker.handleEndEditing({ nativeEvent: { text: "" } });

  assert.equal(tracker.getValue(), "Draft");
});

test("tracked text input still clears when the draft was actually emptied before blur", () => {
  const tracker = createTextInputDraftTracker("Draft");

  tracker.handleChangeText("");
  tracker.handleEndEditing({ nativeEvent: { text: "" } });

  assert.equal(tracker.getValue(), "");
});

test("tracked text input preserves the current draft when blur payload omits native text", () => {
  const tracker = createTextInputDraftTracker("");

  tracker.handleChangeText("Color");
  tracker.handleEndEditing({ nativeEvent: {} });

  assert.equal(tracker.getValue(), "Color");
});
