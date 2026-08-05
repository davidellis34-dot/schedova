type GoogleOAuthDiagnosticsInput = {
  explicitInternalFlag?: string | null;
  isDev?: boolean;
  buildProfile?: string | null;
  demoMode?: string | null;
  debugTools?: string | null;
};

function normalizeFlag(value?: string | null) {
  return String(value || "").trim().toLowerCase() === "true";
}

export function shouldShowGoogleOAuthDiagnostics(
  input: GoogleOAuthDiagnosticsInput,
) {
  // OAuth diagnostics are intentionally hidden from normal Expo, preview,
  // production, TestFlight, and Play Store builds. Only an explicit internal
  // auth-debug flag may expose this panel.
  return normalizeFlag(input.explicitInternalFlag);
}

export function isGoogleOAuthDiagnosticsEnabled() {
  return shouldShowGoogleOAuthDiagnostics({
    explicitInternalFlag: process.env.EXPO_PUBLIC_SCHEDOVA_INTERNAL_AUTH_DEBUG,
    isDev: __DEV__,
    buildProfile: process.env.EXPO_PUBLIC_EAS_BUILD_PROFILE,
    demoMode: process.env.EXPO_PUBLIC_SCHEDOVA_DEMO_MODE,
    debugTools: process.env.EXPO_PUBLIC_SCHEDOVA_DEBUG_TOOLS,
  });
}
