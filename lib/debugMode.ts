export function isSchedovaInternalDebugMode() {
  return (
    __DEV__ ||
    process.env.EXPO_PUBLIC_SCHEDOVA_DEMO_MODE === "true" ||
    process.env.EXPO_PUBLIC_SCHEDOVA_DEBUG_TOOLS === "true" ||
    process.env.EXPO_PUBLIC_SCHEDOVA_REVENUECAT_DEBUG === "true"
  );
}
