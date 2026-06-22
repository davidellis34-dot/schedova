import { Platform } from "react-native";

export const REVENUECAT_ENTITLEMENT_ID = "schedova_pro";
export const REVENUECAT_OFFERING_ID = "default";

export const REVENUECAT_PRODUCT_IDS = {
  monthly: "schedova_pro_monthly",
  yearly: "schedova_pro_yearly",
} as const;

const REVENUECAT_TEST_API_KEY = "test_WlYwMCjlNpLDIPoKQKngnkWTzqr";

// Replace these before production release.
const REVENUECAT_IOS_API_KEY = "appl_XjwYDvRcvnvYMmDGfHbLfbkYhup";
const REVENUECAT_ANDROID_API_KEY = "goog_XvtXUmgyBINZuvwhTvTzefmPClJ";

function assertProductionKeyConfigured(key: string) {
  if (key.includes("YOUR_") || key.startsWith("test_")) {
    throw new Error("RevenueCat production public SDK key is not configured.");
  }

  return key;
}

export function getRevenueCatApiKey() {
  if (__DEV__) {
    return REVENUECAT_TEST_API_KEY;
  }

  if (Platform.OS === "ios") {
    return assertProductionKeyConfigured(REVENUECAT_IOS_API_KEY);
  }

  if (Platform.OS === "android") {
    return assertProductionKeyConfigured(REVENUECAT_ANDROID_API_KEY);
  }

  throw new Error("RevenueCat is not supported on this platform.");
}

export function getRevenueCatApiKeyPrefix() {
  return getRevenueCatApiKey().slice(0, 5);
}
