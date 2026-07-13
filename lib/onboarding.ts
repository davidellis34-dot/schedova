import AsyncStorage from "@react-native-async-storage/async-storage";

const ONBOARDING_COMPLETE_KEY = "schedova_onboarding_complete_v1";

export async function hasCompletedOnboarding() {
  return (await AsyncStorage.getItem(ONBOARDING_COMPLETE_KEY)) === "true";
}

export async function markOnboardingComplete() {
  await AsyncStorage.setItem(ONBOARDING_COMPLETE_KEY, "true");
}
