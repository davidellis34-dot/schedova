export function isSchedovaInternalDebugMode() {
  return (
    __DEV__ ||
    process.env.EXPO_PUBLIC_SCHEDOVA_DEMO_MODE === "true" ||
    process.env.EXPO_PUBLIC_SCHEDOVA_DEBUG_TOOLS === "true" ||
    process.env.EXPO_PUBLIC_SCHEDOVA_REVENUECAT_DEBUG === "true"
  );
}

// QA tools are intentionally narrower than other internal diagnostics. They
// are only available while developing or in an explicitly demo-style build.
export function isSchedovaQaToolsEnabled() {
  return __DEV__ || process.env.EXPO_PUBLIC_SCHEDOVA_DEMO_MODE === "true";
}
