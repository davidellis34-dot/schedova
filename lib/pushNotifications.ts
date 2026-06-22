import Constants from "expo-constants";
import * as Notifications from "expo-notifications";
import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";
import { emitClientMessageReceived } from "./clientMessageEvents";
import {
  getClientMessageRouteFromNotification,
  isClientMessageNotification,
} from "./notificationRouting";
import { supabase } from "./supabase";

const PUSH_DEVICE_ID_KEY = "schedova_push_device_id";

let notificationHandlerConfigured = false;

function getProjectId() {
  return (
    Constants.easConfig?.projectId ||
    Constants.expoConfig?.extra?.eas?.projectId ||
    null
  );
}

function createDeviceId() {
  return `device-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
}

async function getStableDeviceId() {
  if (Platform.OS === "web") return null;

  try {
    const existingDeviceId = await SecureStore.getItemAsync(PUSH_DEVICE_ID_KEY);
    if (existingDeviceId) return existingDeviceId;

    const nextDeviceId = createDeviceId();
    await SecureStore.setItemAsync(PUSH_DEVICE_ID_KEY, nextDeviceId);
    return nextDeviceId;
  } catch (error) {
    if (__DEV__) {
      console.log("Push device id unavailable", error);
    }
    return null;
  }
}

export function configureSchedovaNotificationHandler() {
  if (Platform.OS === "web") return;
  if (notificationHandlerConfigured) return;

  Notifications.setNotificationHandler({
    handleNotification: async (notification) => {
      if (isClientMessageNotification(notification)) {
        emitClientMessageReceived();
        return {
          shouldShowAlert: false,
          shouldShowBanner: false,
          shouldShowList: false,
          shouldPlaySound: false,
          shouldSetBadge: true,
        };
      }

      return {
        shouldShowAlert: true,
        shouldShowBanner: true,
        shouldShowList: true,
        shouldPlaySound: true,
        shouldSetBadge: false,
      };
    },
  });

  notificationHandlerConfigured = true;
}

export async function syncUserTimezone(userId: string) {
  if (!userId) return;

  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;

  if (!timezone) return;

  try {
    const now = new Date().toISOString();
    const { error } = await supabase.from("user_settings").upsert(
      {
        user_id: userId,
        timezone,
        updated_at: now,
      },
      { onConflict: "user_id" },
    );

    if (error && __DEV__) {
      console.log("User timezone sync failed", error.message);
    }
  } catch (error) {
    if (__DEV__) {
      console.log("User timezone sync exception", error);
    }
  }
}

export async function registerForPushNotifications(userId: string) {
  if (!userId || Platform.OS === "web") return null;

  configureSchedovaNotificationHandler();

  const projectId = getProjectId();
  if (!projectId) {
    if (__DEV__) {
      console.log("Expo push registration skipped: missing EAS projectId");
    }
    return null;
  }

  if (Platform.OS === "android") {
    await Notifications.setNotificationChannelAsync("client-messages", {
      name: "Client messages",
      importance: Notifications.AndroidImportance.DEFAULT,
      sound: "default",
    });
  }

  const existingPermissions = await Notifications.getPermissionsAsync();
  let finalPermissions = existingPermissions;

  if (
    !existingPermissions.granted &&
    existingPermissions.canAskAgain !== false
  ) {
    finalPermissions = await Notifications.requestPermissionsAsync();
  }

  if (!finalPermissions.granted) {
    if (__DEV__) {
      console.log("Expo push registration skipped: permission not granted");
    }
    return null;
  }

  try {
    const tokenResponse = await Notifications.getExpoPushTokenAsync({
      projectId,
    });
    const expoPushToken = tokenResponse.data;
    const deviceId = await getStableDeviceId();
    const now = new Date().toISOString();

    const { error } = await supabase.from("user_push_tokens").upsert(
      {
        user_id: userId,
        expo_push_token: expoPushToken,
        platform: Platform.OS,
        device_id: deviceId,
        updated_at: now,
        last_seen_at: now,
      },
      { onConflict: "user_id,expo_push_token" },
    );

    if (error) {
      console.log("Push token registration failed", error.message);
      return null;
    }

    if (__DEV__) {
      console.log("Push token registered", {
        userId,
        platform: Platform.OS,
      });
    }

    return expoPushToken;
  } catch (error) {
    console.log("Push token registration exception", error);
    return null;
  }
}

export function getClientMessageRouteFromNotificationData(data: unknown) {
  if (!data || typeof data !== "object") return null;
  if ((data as { type?: unknown }).type !== "client_message") return null;

  return "/messages" as const;
}

export async function getLastClientMessageNotificationRoute() {
  if (Platform.OS === "web") return null;

  configureSchedovaNotificationHandler();

  const response = await Notifications.getLastNotificationResponseAsync();

  return getClientMessageRouteFromNotification(response?.notification);
}

export function addClientMessageNotificationListeners({
  onClientMessage,
  onClientMessageTap,
}: {
  onClientMessage?: () => void;
  onClientMessageTap?: () => void;
}) {
  if (Platform.OS === "web") {
    return () => {};
  }

  configureSchedovaNotificationHandler();

  const receivedSubscription = Notifications.addNotificationReceivedListener(
    (notification) => {
      if (isClientMessageNotification(notification)) {
        emitClientMessageReceived();
        onClientMessage?.();
      }
    },
  );

  const responseSubscription =
    Notifications.addNotificationResponseReceivedListener((response) => {
      if (isClientMessageNotification(response.notification)) {
        emitClientMessageReceived();
        onClientMessageTap?.();
      }
    });

  return () => {
    receivedSubscription.remove();
    responseSubscription.remove();
  };
}
