const test = require("node:test");
const assert = require("node:assert/strict");

const {
  shouldShowGoogleOAuthDiagnostics,
} = require("../lib/authDebugVisibility.ts");

test("Google OAuth diagnostics stay hidden in normal dev and preview-style builds without an explicit internal flag", () => {
  assert.equal(
    shouldShowGoogleOAuthDiagnostics({
      explicitInternalFlag: "",
      isDev: true,
      buildProfile: null,
      demoMode: "false",
      debugTools: "false",
    }),
    false,
  );
  assert.equal(
    shouldShowGoogleOAuthDiagnostics({
      explicitInternalFlag: "",
      isDev: true,
      buildProfile: "preview",
      demoMode: "true",
      debugTools: "true",
    }),
    false,
  );
});

test("Google OAuth diagnostics stay hidden in production-facing build profiles without an explicit internal flag", () => {
  for (const buildProfile of ["production", "preview", "testflight", "playstore"]) {
    assert.equal(
      shouldShowGoogleOAuthDiagnostics({
        explicitInternalFlag: null,
        isDev: false,
        buildProfile,
        demoMode: "false",
        debugTools: "false",
      }),
      false,
      `expected diagnostics to stay hidden for ${buildProfile}`,
    );
  }
});

test("Google OAuth diagnostics only show when the explicit internal auth flag is enabled", () => {
  assert.equal(
    shouldShowGoogleOAuthDiagnostics({
      explicitInternalFlag: "true",
      isDev: false,
      buildProfile: "production",
      demoMode: "false",
      debugTools: "false",
    }),
    true,
  );
  assert.equal(
    shouldShowGoogleOAuthDiagnostics({
      explicitInternalFlag: " TRUE ",
      isDev: false,
      buildProfile: "preview",
      demoMode: "false",
      debugTools: "false",
    }),
    true,
  );
});
