import { router } from "expo-router";
import { Alert } from "react-native";

import { ENABLE_PRO } from "./proFeatureFlag";

let lastProNavigationAt = 0;

export const PRO_UPSELL_COPY = {
  sms: "SMS appointment texts are included with Schedova Pro.",
  reports: "Reports are included with Schedova Pro.",
  blockedTime: "Blocked time is included with Schedova Pro.",
  vacationBlocks: "Vacation blocks are included with Schedova Pro.",
  customBusinessHours: "Custom business hours are included with Schedova Pro.",
  clientHistory: "Client history is included with Schedova Pro.",
  messageTemplates: "More message templates are included with Schedova Pro.",
  freeLimit:
    "You've reached the Free plan limit. Upgrade to Schedova Pro to keep growing.",
} as const;

export function openSchedovaProScreen() {
  if (!ENABLE_PRO) return;

  const now = Date.now();

  if (now - lastProNavigationAt < 700) return;

  lastProNavigationAt = now;

  try {
    const proRoute = "/schedova-pro" as any;
    const navigation = router as {
      navigate?: (href: unknown) => void;
      push: (href: unknown) => void;
    };

    if (navigation.navigate) {
      navigation.navigate(proRoute);
      return;
    }

    navigation.push(proRoute);
  } catch {
    Alert.alert(
      "Schedova Pro",
      "Open Settings > Schedova Pro to review upgrade options.",
    );
  }
}

export function showProUpgradePrompt(message: string) {
  if (!ENABLE_PRO) return;

  Alert.alert("Schedova Pro", message, [
    { text: "Not now", style: "cancel" },
    {
      text: "View Pro",
      onPress: openSchedovaProScreen,
    },
  ]);
}

export async function showProUpgradePromptForFlow(message: string) {
  if (!ENABLE_PRO) return false;

  showProUpgradePrompt(message);
  return false;
}
