import { Alert } from "react-native";
import { trackAnalyticsEvent } from "./analytics";

type Navigate = (route: string) => void;

export function showSmsSetupPrompt(navigate: Navigate) {
  trackAnalyticsEvent("sms_setup_prompt_viewed");
  Alert.alert(
    "SMS messaging isn't enabled yet",
    "Finish setting up SMS before sending messages to clients.",
    [
      { text: "Not Now", style: "cancel" },
      { text: "Open SMS Settings", onPress: () => navigate("/settings/sms") },
    ],
  );
}

export function showAddClientPhonePrompt(onEditClient: () => void) {
  Alert.alert(
    "Add a phone number",
    "This client needs a phone number before you can send an SMS.",
    [
      { text: "Not Now", style: "cancel" },
      { text: "Edit Client", onPress: onEditClient },
    ],
  );
}

export function showSmsCreditsPrompt(navigate: Navigate) {
  Alert.alert(
    "You're out of SMS credits",
    "Purchase a message pack to continue sending texts.",
    [
      { text: "Not Now", style: "cancel" },
      { text: "View Message Packs", onPress: () => navigate("/settings/message-packs") },
    ],
  );
}

export function showTemporarySmsFailurePrompt(onRetry: () => void) {
  Alert.alert(
    "Message not sent",
    "Something went wrong sending the message. Please try again.",
    [
      { text: "Cancel", style: "cancel" },
      { text: "Retry", onPress: onRetry },
    ],
  );
}

export function isSmsConfigurationError(code?: string | null) {
  return code === "sms_provider_not_configured";
}

export function isSmsCreditError(code?: string | null) {
  return code === "insufficient_credits" || code === "message_credits_empty";
}

export function isTemporarySmsError(code?: string | null) {
  return ["sms_provider_failed", "provider_error", "send_failed", "function_error", "exception"].includes(
    String(code || ""),
  );
}
