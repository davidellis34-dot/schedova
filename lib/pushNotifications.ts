import Constants from "expo-constants";
import * as Notifications from "expo-notifications";
import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";
import { shouldSkipAuthNativeWork } from "./authNativeIsolation";
import { CLIENT_MESSAGE_NOTIFICATION_CHANNEL_ID } from "./clientMessageNotifications";
import { emitClientMessageReceived } from "./clientMessageEvents";
import {
  getClientMessageRouteFromNotification,
  isClientMessageNotification,
} from "./notificationRouting";
import {
  publishPushRegistrationState,
  resetPushRegistrationState,
  type PushRegistrationPhase,
} from "./pushRegistrationState";
import { supabase } from "./supabase";

const PUSH_DEVICE_ID_KEY = "schedova_push_device_id";

let notificationHandlerConfigured = false;
let cachedDeviceId: string | null | undefined;
let pendingDeviceIdPromise: Promise<string | null> | null = null;

type RegisterForPushNotificationsOptions = {
  devicePushToken?: Notifications.DevicePushToken | null;
  source?: string;
};

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
  if (typeof cachedDeviceId !== "undefined") return cachedDeviceId;
  if (pendingDeviceIdPromise) return pendingDeviceIdPromise;

  pendingDeviceIdPromise = (async () => {
    try {
      const existingDeviceId = await SecureStore.getItemAsync(PUSH_DEVICE_ID_KEY);
      if (existingDeviceId) {
        cachedDeviceId = existingDeviceId;
        return existingDeviceId;
      }

      const nextDeviceId = createDeviceId();
      await SecureStore.setItemAsync(PUSH_DEVICE_ID_KEY, nextDeviceId);
      cachedDeviceId = nextDeviceId;
      return nextDeviceId;
    } catch (error) {
      if (__DEV__) {
        console.log("Push device id unavailable", error);
      }
      cachedDeviceId = null;
      return null;
    } finally {
      pendingDeviceIdPromise = null;
    }
  })();

  return pendingDeviceIdPromise;
}

async function removeCurrentUserStaleDeviceTokens(
  userId: string,
  deviceId: string | null,
  expoPushToken: string,
  source: string,
) {
  if (!userId || !deviceId || !expoPushToken) return;

  const { data, error } = await supabase
    .from("user_push_tokens")
    .delete()
    .eq("user_id", userId)
    .eq("device_id", deviceId)
    .neq("expo_push_token", expoPushToken)
    .select("id, expo_push_token");

  if (error) {
    logPushRegistration("stale token cleanup failed", {
      code: error.code || null,
      details: error.details || null,
      deviceId,
      hint: error.hint || null,
      message: error.message,
      removedCount: 0,
      source,
      userId,
    });
    return;
  }

  const removedCount = Array.isArray(data) ? data.length : 0;
  if (removedCount > 0) {
    logPushRegistration("stale token cleanup removed rows", {
      deviceId,
      removedCount,
      source,
      userId,
    });
  }
}

function summarizePushToken(token?: string | null) {
  const cleanToken = String(token || "").trim();
  if (!cleanToken) return null;
  if (cleanToken.length <= 20) return cleanToken;
  return `${cleanToken.slice(0, 16)}...${cleanToken.slice(-8)}`;
}

function logPushRegistration(
  event: string,
  details: Record<string, unknown> = {},
) {
  console.log("[PushRegistration]", event, details);
}

function getPermissionStatusLabel(
  permissions: Notifications.NotificationPermissionsStatus | null | undefined,
) {
  if (!permissions) return null;

  if (typeof permissions.status === "string" && permissions.status.trim()) {
    return permissions.status.trim();
  }

  if (
    typeof permissions.ios?.status === "number" &&
    permissions.ios.status === Notifications.IosAuthorizationStatus.PROVISIONAL
  ) {
    return "provisional";
  }

  return permissions.granted ? "granted" : "denied";
}

function hasGrantedNotificationPermission(
  permissions: Notifications.NotificationPermissionsStatus | null | undefined,
) {
  return Boolean(
    permissions?.granted ||
      permissions?.ios?.status === Notifications.IosAuthorizationStatus.PROVISIONAL,
  );
}

function publishRegistrationPhase(
  phase: PushRegistrationPhase,
  details: Partial<{
    userId: string | null;
    source: string | null;
    permissionStatus: string | null;
    permissionsGranted: boolean | null;
    canAskAgain: boolean | null;
    deviceId: string | null;
    nativeToken: string | null;
    expoPushToken: string | null;
    errorCode: string | null;
    errorMessage: string | null;
  }> = {},
) {
  return publishPushRegistrationState({
    phase,
    ...details,
  });
}

export function configureSchedovaNotificationHandler() {
  if (Platform.OS === "web") return;
  if (notificationHandlerConfigured) return;

  Notifications.setNotificationHandler({
    handleNotification: async (notification) => {
      if (isClientMessageNotification(notification)) {
        emitClientMessageReceived();
        return {
          shouldShowAlert: true,
          shouldShowBanner: true,
          shouldShowList: true,
          shouldPlaySound: true,
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
  if (shouldSkipAuthNativeWork(userId)) {
    console.log("[AuthNative] skipped push during transition", {
      operation: "syncUserTimezone",
      userId,
    });
    return;
  }

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

export async function registerForPushNotifications(
  userId: string,
  options: RegisterForPushNotificationsOptions = {},
) {
  if (!userId || Platform.OS === "web") return null;
  if (shouldSkipAuthNativeWork(userId)) {
    logPushRegistration("skipped during auth-native transition", {
      source: options.source || "unknown",
      userId,
    });
    publishRegistrationPhase("skipped", {
      userId,
      source: options.source || "auth-native-transition",
    });
    console.log("[AuthNative] skipped push during transition", {
      operation: "registerForPushNotifications",
      userId,
    });
    return null;
  }

  configureSchedovaNotificationHandler();

  const projectId = getProjectId();
  const source = options.source || "unspecified";
  if (!projectId) {
    logPushRegistration("missing EAS project id", {
      source,
      userId,
    });
    publishRegistrationPhase("registration-failed", {
      userId,
      source,
      errorCode: "missing_project_id",
      errorMessage: "This build is missing its push notification project ID.",
    });
    return null;
  }

  try {
    if (Platform.OS === "android") {
      await Notifications.setNotificationChannelAsync(
        CLIENT_MESSAGE_NOTIFICATION_CHANNEL_ID,
        {
        name: "Client messages",
        importance: Notifications.AndroidImportance.HIGH,
        sound: "default",
        },
      );
    }

    publishRegistrationPhase("checking-permission", {
      userId,
      source,
    });
    const existingPermissions = await Notifications.getPermissionsAsync();
    let finalPermissions = existingPermissions;

    logPushRegistration("permission status", {
      canAskAgain:
        typeof existingPermissions.canAskAgain === "boolean"
          ? existingPermissions.canAskAgain
          : null,
      granted: existingPermissions.granted,
      iosStatus: existingPermissions.ios?.status ?? null,
      source,
      status: getPermissionStatusLabel(existingPermissions),
      userId,
    });

    if (
      !hasGrantedNotificationPermission(existingPermissions) &&
      existingPermissions.canAskAgain !== false
    ) {
      finalPermissions = await Notifications.requestPermissionsAsync();
      logPushRegistration("permission request result", {
        canAskAgain:
          typeof finalPermissions.canAskAgain === "boolean"
            ? finalPermissions.canAskAgain
            : null,
        granted: finalPermissions.granted,
        iosStatus: finalPermissions.ios?.status ?? null,
        source,
        status: getPermissionStatusLabel(finalPermissions),
        userId,
      });
    }

    const permissionGranted = hasGrantedNotificationPermission(finalPermissions);
    const permissionStatus = getPermissionStatusLabel(finalPermissions);

    if (!permissionGranted) {
      publishRegistrationPhase("permission-denied", {
        userId,
        source,
        permissionStatus,
        permissionsGranted: false,
        canAskAgain:
          typeof finalPermissions.canAskAgain === "boolean"
            ? finalPermissions.canAskAgain
            : null,
        errorCode: "permission_denied",
        errorMessage: "Notification permission was not granted.",
      });
      logPushRegistration("permission denied", {
        canAskAgain:
          typeof finalPermissions.canAskAgain === "boolean"
            ? finalPermissions.canAskAgain
            : null,
        source,
        status: permissionStatus,
        userId,
      });
      return null;
    }

    publishRegistrationPhase("generating-device-token", {
      userId,
      source,
      permissionStatus,
      permissionsGranted: true,
      canAskAgain:
        typeof finalPermissions.canAskAgain === "boolean"
          ? finalPermissions.canAskAgain
          : null,
    });
    const nativePushToken =
      options.devicePushToken || (await Notifications.getDevicePushTokenAsync());
    logPushRegistration("device token generated", {
      nativeToken: summarizePushToken(nativePushToken.data),
      source,
      tokenType: nativePushToken.type,
      userId,
    });

    publishRegistrationPhase("generating-expo-token", {
      userId,
      source,
      permissionStatus,
      permissionsGranted: true,
      canAskAgain:
        typeof finalPermissions.canAskAgain === "boolean"
          ? finalPermissions.canAskAgain
          : null,
      nativeToken: nativePushToken.data,
    });
    const tokenResponse = await Notifications.getExpoPushTokenAsync({
      devicePushToken: nativePushToken,
      projectId,
    });
    const expoPushToken = tokenResponse.data;
    const deviceId = await getStableDeviceId();
    const now = new Date().toISOString();
    logPushRegistration("expo token generated", {
      deviceId,
      expoPushToken: summarizePushToken(expoPushToken),
      source,
      userId,
    });
    await removeCurrentUserStaleDeviceTokens(
      userId,
      deviceId,
      expoPushToken,
      source,
    );

    publishRegistrationPhase("persisting-token", {
      userId,
      source,
      permissionStatus,
      permissionsGranted: true,
      canAskAgain:
        typeof finalPermissions.canAskAgain === "boolean"
          ? finalPermissions.canAskAgain
          : null,
      deviceId,
      nativeToken: nativePushToken.data,
      expoPushToken,
    });
    const { data, error } = await supabase
      .from("user_push_tokens")
      .upsert(
        {
          user_id: userId,
          expo_push_token: expoPushToken,
          platform: Platform.OS,
          device_id: deviceId,
          updated_at: now,
          last_seen_at: now,
        },
        { onConflict: "user_id,expo_push_token" },
      )
      .select("id, user_id, expo_push_token, platform, device_id, last_seen_at")
      .maybeSingle();

    if (error) {
      logPushRegistration("token persistence failed", {
        code: error.code || null,
        details: error.details || null,
        deviceId,
        expoPushToken: summarizePushToken(expoPushToken),
        hint: error.hint || null,
        message: error.message,
        source,
        userId,
      });
      publishRegistrationPhase("registration-failed", {
        userId,
        source,
        permissionStatus,
        permissionsGranted: true,
        canAskAgain:
          typeof finalPermissions.canAskAgain === "boolean"
            ? finalPermissions.canAskAgain
            : null,
        deviceId,
        nativeToken: nativePushToken.data,
        expoPushToken,
        errorCode: error.code || "push_token_persist_failed",
        errorMessage: error.message,
      });
      return null;
    }

    logPushRegistration("token persisted", {
      deviceId: data?.device_id || deviceId,
      expoPushToken: summarizePushToken(
        String(data?.expo_push_token || expoPushToken),
      ),
      platform: data?.platform || Platform.OS,
      source,
      tokenRowId: data?.id || null,
      userId,
    });
    publishRegistrationPhase("registered", {
      userId,
      source,
      permissionStatus,
      permissionsGranted: true,
      canAskAgain:
        typeof finalPermissions.canAskAgain === "boolean"
          ? finalPermissions.canAskAgain
          : null,
      deviceId: String(data?.device_id || deviceId || ""),
      nativeToken: nativePushToken.data,
      expoPushToken,
      errorCode: null,
      errorMessage: null,
    });

    return expoPushToken;
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : "Push token registration failed.";
    const errorCode =
      error instanceof Error && error.name ? error.name : "push_registration_exception";
    logPushRegistration("registration exception", {
      errorCode,
      errorMessage,
      source,
      userId,
    });
    publishRegistrationPhase("registration-failed", {
      userId,
      source,
      errorCode,
      errorMessage,
    });
    return null;
  }
}

export async function unregisterCurrentDevicePushTokens(
  userId: string,
  options: { source?: string } = {},
) {
  if (!userId || Platform.OS === "web") return 0;

  const source = options.source || "unspecified";
  const deviceId = await getStableDeviceId();

  if (!deviceId) {
    logPushRegistration("sign-out cleanup skipped missing device id", {
      source,
      userId,
    });
    return 0;
  }

  const { data, error } = await supabase
    .from("user_push_tokens")
    .delete()
    .eq("user_id", userId)
    .eq("device_id", deviceId)
    .select("id, expo_push_token");

  if (error) {
    logPushRegistration("sign-out cleanup failed", {
      code: error.code || null,
      details: error.details || null,
      deviceId,
      hint: error.hint || null,
      message: error.message,
      source,
      userId,
    });
    return 0;
  }

  const removedCount = Array.isArray(data) ? data.length : 0;
  logPushRegistration("sign-out cleanup finished", {
    deviceId,
    removedCount,
    source,
    userId,
  });
  return removedCount;
}

export function getClientMessageRouteFromNotificationData(data: unknown) {
  return getClientMessageRouteFromNotification({
    request: { content: { data } },
  });
}

export async function getLastClientMessageNotificationRoute() {
  if (Platform.OS === "web") return null;

  configureSchedovaNotificationHandler();

  try {
    const response = await Notifications.getLastNotificationResponseAsync();
    return getClientMessageRouteFromNotification(response?.notification);
  } catch (error) {
    if (__DEV__) {
      console.log("Last notification response lookup failed", error);
    }
    return null;
  }
}

export function addClientMessageNotificationListeners({
  onClientMessage,
  onClientMessageTap,
}: {
  onClientMessage?: () => void;
  onClientMessageTap?: (route: ReturnType<
    typeof getClientMessageRouteFromNotification
  >) => void;
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
        onClientMessageTap?.(
          getClientMessageRouteFromNotification(response.notification),
        );
      }
    });

  return () => {
    receivedSubscription.remove();
    responseSubscription.remove();
  };
}

export function addPushTokenRefreshListener(
  listener: (token: Notifications.DevicePushToken) => void,
) {
  if (Platform.OS === "web") {
    return () => {};
  }

  const subscription = Notifications.addPushTokenListener((token) => {
    logPushRegistration("device token changed", {
      nativeToken: summarizePushToken(token.data),
      tokenType: token.type,
    });
    listener(token);
  });

  return () => {
    subscription.remove();
  };
}

export function clearPushRegistrationState() {
  resetPushRegistrationState();
}

export function resetPushNotificationsForTests() {
  notificationHandlerConfigured = false;
  cachedDeviceId = undefined;
  pendingDeviceIdPromise = null;
  resetPushRegistrationState();
}
