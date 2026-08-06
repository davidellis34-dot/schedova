import AsyncStorage from "@react-native-async-storage/async-storage";

export type ContextTipId =
  | "dashboard_getting_started"
  | "calendar_empty_slot"
  | "clients_first_client"
  | "messages_client_replies"
  | "services_pricing_duration"
  | "sms_settings_setup";

export const CONTEXT_TIP_IDS: ContextTipId[] = [
  "dashboard_getting_started",
  "calendar_empty_slot",
  "clients_first_client",
  "messages_client_replies",
  "services_pricing_duration",
  "sms_settings_setup",
];

const CONTEXT_TIP_STORAGE_PREFIX = "schedova_context_tip_v1";

function getContextTipStorageKey(userId: string, tipId: ContextTipId) {
  return `${CONTEXT_TIP_STORAGE_PREFIX}:${userId}:${tipId}`;
}

export async function isContextTipDismissed(
  userId: string,
  tipId: ContextTipId,
) {
  const value = await AsyncStorage.getItem(getContextTipStorageKey(userId, tipId));
  return value === "dismissed";
}

export async function dismissContextTip(userId: string, tipId: ContextTipId) {
  await AsyncStorage.setItem(getContextTipStorageKey(userId, tipId), "dismissed");
}

export async function resetContextTips(userId: string) {
  await AsyncStorage.multiRemove(
    CONTEXT_TIP_IDS.map((tipId) => getContextTipStorageKey(userId, tipId)),
  );
}
