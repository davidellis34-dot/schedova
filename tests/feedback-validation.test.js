const test = require("node:test");
const assert = require("node:assert/strict");

const { validateFeedbackSubmission } = require("../lib/feedbackValidation.ts");

test("feedback requires a type, title, and description", () => {
  assert.match(
    validateFeedbackSubmission({
      feedbackType: "Feature request",
      title: "",
      description: "",
    }),
    /title and description/i,
  );
});

test("feedback limits keep submissions bounded before the secure backend call", () => {
  assert.match(
    validateFeedbackSubmission({
      feedbackType: "Feature request",
      title: "x".repeat(161),
      description: "Useful request",
    }),
    /160 characters/i,
  );
  assert.equal(
    validateFeedbackSubmission({
      feedbackType: "Report a problem",
      title: "Save failed",
      description: "The save button remained loading.",
    }),
    null,
  );
});
