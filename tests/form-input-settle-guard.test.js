const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");

function readSource(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), "utf8");
}

test("shared AppTextInput forwards blur events without replaying native text into onChangeText", () => {
  const source = readSource("components/ui/AppTextInput.tsx");

  assert.match(source, /onEndEditing=\{onEndEditing\}/);
  assert.doesNotMatch(source, /onChangeText\?\.\(event\.nativeEvent\.text \|\| ""\);/);
});

test("high-risk save screens settle active text input state before validation", () => {
  const files = [
    "app/add-service.tsx",
    "app/add-client.tsx",
    "app/business-setup.tsx",
    "app/onboarding.tsx",
    "app/block-time.tsx",
    "components/clients/EditClientForm.tsx",
    "components/booking/useBookAppointmentForm.ts",
  ];

  for (const relativePath of files) {
    const source = readSource(relativePath);
    assert.match(
      source,
      /await settleActiveTextInput\(\);/,
      `${relativePath} should settle the focused input before save validation`,
    );
  }
});
