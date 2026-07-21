import { router } from "expo-router";
import { Alert } from "react-native";

import { ENABLE_PRO } from "./proFeatureFlag";

let lastProNavigationAt = 0;
let nextPromptId = 1;

type ProUpgradePromptVariant = "feature" | "free-limit";

export type ProUpgradePromptRequest = {
  id: number;
  message: string;
  title?: string;
  variant: ProUpgradePromptVariant;
};

type ProUpgradePromptListener = (prompt: ProUpgradePromptRequest | null) => void;

const promptListeners = new Set<ProUpgradePromptListener>();

export const PRO_UPSELL_COPY = {
  sms: "SMS appointment texts are included with Schedova Pro.",
  clientReplies:
    "Client replies and the message inbox are included with Schedova Pro.",
  emailMessaging:
    "Email appointment messages and client replies are included with Schedova Pro.",
  reports: "Reports are included with Schedova Pro.",
  blockedTime: "Blocked time is included with Schedova Pro.",
  vacationBlocks: "Vacation blocks are included with Schedova Pro.",
  customBusinessHours: "Custom business hours are included with Schedova Pro.",
  clientHistory: "Client history is included with Schedova Pro.",
  messageTemplates: "More message templates are included with Schedova Pro.",
  moreServices: "More services are included with Schedova Pro.",
  freeLimit:
    "Start your 14-day Pro trial to keep adding clients, manage more appointments, send reminders, and handle client replies.",
} as const;

function publishPrompt(prompt: ProUpgradePromptRequest | null) {
  if (promptListeners.size === 0) {
    openSchedovaProScreen();
    return;
  }

  promptListeners.forEach((listener) => listener(prompt));
}

export function subscribeToProUpgradePrompts(
  listener: ProUpgradePromptListener,
) {
  promptListeners.add(listener);
  return () => {
    promptListeners.delete(listener);
  };
}

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

export function dismissProUpgradePrompt() {
  publishPrompt(null);
}

export function showFreePlanUpgradePrompt() {
  if (!ENABLE_PRO) return;

  publishPrompt({
    id: nextPromptId++,
    message: PRO_UPSELL_COPY.freeLimit,
    title: "You've outgrown the free plan.",
    variant: "free-limit",
  });
}

export function showProUpgradePrompt(
  message: string,
  options?: {
    title?: string;
    variant?: ProUpgradePromptVariant;
  },
) {
  if (!ENABLE_PRO) return;

  publishPrompt({
    id: nextPromptId++,
    message,
    title: options?.title,
    variant: options?.variant || "feature",
  });
}

export async function showProUpgradePromptForFlow(message: string) {
  if (!ENABLE_PRO) return false;

  showProUpgradePrompt(message);
  return false;
}
