import { Stack, useRouter, useSegments } from "expo-router";
import { useEffect, useRef, type ReactNode } from "react";
import { AppState, Linking } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { AuthSessionProvider, useAuthSession } from "../lib/authSession";
import {
  clearFeatureAccess,
  refreshFeatureAccess,
} from "../lib/featureAccess";
import { recordAuthDiagnosticEvent } from "../lib/authDiagnostics";
import { SubscriptionProvider } from "../lib/revenuecat/SubscriptionProvider";
import { getSchedovaBookingRouteParamsFromUrl } from "../lib/schedovaLinks";
import {
  addClientMessageNotificationListeners,
  getLastClientMessageNotificationRoute,
  registerForPushNotifications,
  syncUserTimezone,
} from "../lib/pushNotifications";

function RevenueCatBootstrap({ children }: { children: ReactNode }) {
  const { isHydrated, userId } = useAuthSession();

  return (
    <SubscriptionProvider authReady={isHydrated} userId={userId}>
      {children}
    </SubscriptionProvider>
  );
}

function FeatureAccessBootstrap() {
  const { isHydrated, session, userId } = useAuthSession();

  useEffect(() => {
    if (!isHydrated) return;

    async function refreshFromSession(source: string) {
      recordAuthDiagnosticEvent(source, session, "FeatureAccessBootstrap");

      if (userId) {
        void refreshFeatureAccess(userId, source);
        return;
      }

      clearFeatureAccess(source);
    }

    void refreshFromSession("auth-hydrated");

    const appStateListener = AppState.addEventListener("change", (state) => {
      if (state === "active") {
        void refreshFromSession("app-active");
      }
    });

    return () => {
      appStateListener.remove();
    };
  }, [isHydrated, session, userId]);

  return null;
}

function PushNotificationsBootstrap() {
  const router = useRouter();
  const handledInitialNotification = useRef(false);
  const { isHydrated, userId } = useAuthSession();

  useEffect(() => {
    if (!isHydrated || !userId) return;

    void syncUserTimezone(userId);
    void registerForPushNotifications(userId);
  }, [isHydrated, userId]);

  useEffect(() => {
    const removeListeners = addClientMessageNotificationListeners({
      onClientMessageTap: () => {
        router.push("/messages" as any);
      },
    });

    if (!handledInitialNotification.current) {
      handledInitialNotification.current = true;
      void getLastClientMessageNotificationRoute().then((route) => {
        if (route) {
          router.push(route as any);
        }
      });
    }

    return removeListeners;
  }, [router]);

  return null;
}

function AuthRouteGuard() {
  const router = useRouter();
  const segments = useSegments();
  const routeKey = segments.join("/");
  const { isHydrated, userId } = useAuthSession();

  useEffect(() => {
    const firstSegment = segments[0];
    const isPublicRoute =
      !firstSegment ||
      firstSegment === "index" ||
      firstSegment === "login" ||
      firstSegment === "preview" ||
      firstSegment === "country-region" ||
      firstSegment === "privacy-policy" ||
      firstSegment === "delete-account" ||
      firstSegment === "terms" ||
      firstSegment === "+not-found";

    if (isPublicRoute || !isHydrated) return;

    if (!userId) {
      router.replace("/login" as any);
    }
  }, [isHydrated, routeKey, router, segments, userId]);

  return null;
}

function SchedovaDeepLinkHandler() {
  const router = useRouter();

  useEffect(() => {
    let mounted = true;

    function handleUrl(url: string | null) {
      if (!url) return;

      const routeParams = getSchedovaBookingRouteParamsFromUrl(url);

      if (!routeParams) return;

      router.push({
        pathname: "/book-appointment",
        params: routeParams,
      } as any);
    }

    void Linking.getInitialURL().then((url) => {
      if (!mounted) return;
      handleUrl(url);
    });

    const subscription = Linking.addEventListener("url", ({ url }) => {
      handleUrl(url);
    });

    return () => {
      mounted = false;
      subscription.remove();
    };
  }, [router]);

  return null;
}

export default function RootLayout() {
  return (
    <AuthSessionProvider>
      <GestureHandlerRootView style={{ flex: 1 }}>
        <SafeAreaProvider>
          <RevenueCatBootstrap>
            <FeatureAccessBootstrap />
            <PushNotificationsBootstrap />
            <AuthRouteGuard />
            <SchedovaDeepLinkHandler />
            <Stack screenOptions={{ headerShown: false }}>
              <Stack.Screen name="dashboard" options={{ headerShown: false }} />
              <Stack.Screen name="demo-data" options={{ headerShown: false }} />
              <Stack.Screen name="index" options={{ headerShown: false }} />
              <Stack.Screen name="login" options={{ headerShown: false }} />
              <Stack.Screen name="preview" options={{ headerShown: false }} />
              <Stack.Screen
                name="book-appointment"
                options={{ headerShown: false }}
              />
              <Stack.Screen name="book" options={{ headerShown: false }} />
              <Stack.Screen
                name="calendar-view"
                options={{ headerShown: false }}
              />
              <Stack.Screen name="clients" options={{ headerShown: false }} />
              <Stack.Screen name="messages" options={{ headerShown: false }} />
              <Stack.Screen
                name="message-templates"
                options={{ headerShown: false }}
              />
              <Stack.Screen
                name="settings/index"
                options={{ headerShown: false }}
              />
              <Stack.Screen
                name="settings/message-templates"
                options={{ headerShown: false }}
              />
              <Stack.Screen
                name="settings/message-packs"
                options={{ headerShown: false }}
              />
              <Stack.Screen
                name="settings/sms"
                options={{ headerShown: false }}
              />
            </Stack>
          </RevenueCatBootstrap>
        </SafeAreaProvider>
      </GestureHandlerRootView>
    </AuthSessionProvider>
  );
}
