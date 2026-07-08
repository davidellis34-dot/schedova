import { Stack, useRouter, useSegments } from "expo-router";
import { useEffect, useRef, type ReactNode } from "react";
import {
  AppState,
  InteractionManager,
  Keyboard,
  Linking,
  Platform,
  TextInput,
} from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";
import {
  IOS_AUTH_NATIVE_ISOLATION,
  beginAuthNativeTransition,
} from "../lib/authNativeIsolation";
import { AuthSessionProvider, useAuthSession } from "../lib/authSession";
import {
  getAuthRouteKey,
  resolveAuthenticatedAppRoute,
} from "../lib/authRouting";
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
  const { authStatus, isHydrated, userId } = useAuthSession();

  useEffect(() => {
    if (IOS_AUTH_NATIVE_ISOLATION) {
      console.log("[AuthNative] skipped push during transition", {
        source: "PushNotificationsBootstrap",
        authStatus,
        userId: userId ?? null,
      });
      return;
    }

    if (!isHydrated || !userId) return;

    void syncUserTimezone(userId).catch((error) => {
      if (__DEV__) {
        console.log("User timezone sync bootstrap failed", error);
      }
    });
    void registerForPushNotifications(userId).catch((error) => {
      if (__DEV__) {
        console.log("Push registration bootstrap failed", error);
      }
    });
  }, [authStatus, isHydrated, userId]);

  useEffect(() => {
    const removeListeners = addClientMessageNotificationListeners({
      onClientMessageTap: () => {
        router.push("/messages" as any);
      },
    });

    if (!handledInitialNotification.current) {
      handledInitialNotification.current = true;
      void getLastClientMessageNotificationRoute()
        .then((route) => {
          if (route) {
            router.push(route as any);
          }
        })
        .catch((error) => {
          if (__DEV__) {
            console.log("Initial client message notification lookup failed", error);
          }
        });
    }

    return removeListeners;
  }, [router]);

  return null;
}

function AuthNativeTransitionBootstrap() {
  const { authStatus, isHydrated, userId } = useAuthSession();
  const lastAuthKeyRef = useRef<string | null>(null);

  useEffect(() => {
    if (!IOS_AUTH_NATIVE_ISOLATION || !isHydrated) {
      return;
    }

    const authKey = `${authStatus}:${userId ?? "none"}`;

    if (lastAuthKeyRef.current === authKey) {
      return;
    }

    lastAuthKeyRef.current = authKey;
    beginAuthNativeTransition(
      `auth-state:${authStatus}`,
      authStatus === "authenticated" ? userId ?? null : null,
    );
  }, [authStatus, isHydrated, userId]);

  return null;
}

async function settleKeyboard() {
  Keyboard.dismiss();
  await new Promise((resolve) => setTimeout(resolve, 100));
  await new Promise<void>((resolve) => {
    requestAnimationFrame(() => resolve());
  });
}

function hasFocusedInput() {
  return Boolean(TextInput.State.currentlyFocusedInput?.());
}

async function waitForBlurredInputs() {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const focusedInput = TextInput.State.currentlyFocusedInput?.();
    focusedInput?.blur?.();
    await settleKeyboard();

    if (!hasFocusedInput()) {
      return;
    }
  }
}

async function waitForAuthNavigationWindow() {
  await new Promise<void>((resolve) => {
    InteractionManager.runAfterInteractions(() => resolve());
  });

  if (Platform.OS === "ios") {
    await new Promise((resolve) => setTimeout(resolve, 180));
  }

  await new Promise<void>((resolve) => {
    requestAnimationFrame(() => resolve());
  });
}

function AuthNavigationCoordinator() {
  const router = useRouter();
  const segments = useSegments();
  const routeKey = segments.join("/");
  const {
    authStatus,
    authTransitionState,
    isHydrated,
    userId,
  } = useAuthSession();
  const pendingTargetRef = useRef<string | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    pendingTargetRef.current = null;
  }, [routeKey]);

  useEffect(() => {
    const firstSegment = segments[0];
    const isAuthEntryRoute =
      !firstSegment || firstSegment === "index" || firstSegment === "login";
    const isPublicRoute =
      isAuthEntryRoute ||
      firstSegment === "preview" ||
      firstSegment === "privacy-policy" ||
      firstSegment === "reset-password" ||
      firstSegment === "terms" ||
      firstSegment === "+not-found";

    if (!isHydrated || authStatus === "loading") {
      return;
    }

    let cancelled = false;

    async function replaceRoute(
      target:
        | "/login"
        | "/dashboard"
        | "/onboarding"
        | {
            pathname: "/country-region";
            params: { next: "/dashboard" | "/onboarding" };
          },
    ) {
      const targetKey = getAuthRouteKey(target);

      if (routeKey === targetKey || pendingTargetRef.current === targetKey) {
        return;
      }

      pendingTargetRef.current = targetKey;

      if (__DEV__) {
        console.log("[AuthNavigation] replace scheduled", {
          authStatus,
          authTransitionState,
          from: routeKey || "index",
          to: targetKey,
        });
      }

      try {
        await waitForBlurredInputs();
        await settleKeyboard();
        await waitForAuthNavigationWindow();

        if (cancelled || !mountedRef.current) {
          return;
        }

        router.replace(target as any);
      } finally {
        if ((cancelled || !mountedRef.current) && pendingTargetRef.current === targetKey) {
          pendingTargetRef.current = null;
        }
      }
    }

    if (authStatus === "unauthenticated" && !userId) {
      if (authTransitionState === "signingIn" || isPublicRoute) {
        return;
      }

      void replaceRoute("/login");
      return () => {
        cancelled = true;
      };
    }

    if (authStatus === "authenticated" && userId && isAuthEntryRoute) {
      async function redirectAuthenticatedUser() {
        const targetRoute = await resolveAuthenticatedAppRoute();

        if (cancelled) {
          return;
        }

        await replaceRoute(targetRoute);
      }

      void redirectAuthenticatedUser();

      return () => {
        cancelled = true;
      };
    }
  }, [
    authStatus,
    authTransitionState,
    isHydrated,
    routeKey,
    router,
    segments,
    userId,
  ]);

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
            <AuthNativeTransitionBootstrap />
            <FeatureAccessBootstrap />
            <PushNotificationsBootstrap />
            <AuthNavigationCoordinator />
            <SchedovaDeepLinkHandler />
            <Stack
              screenOptions={{
                freezeOnBlur: Platform.OS === "ios" ? false : undefined,
                headerShown: false,
              }}
            >
              <Stack.Screen name="dashboard" options={{ headerShown: false }} />
              <Stack.Screen name="demo-data" options={{ headerShown: false }} />
              <Stack.Screen name="index" options={{ headerShown: false }} />
              <Stack.Screen name="login" options={{ headerShown: false }} />
              <Stack.Screen name="preview" options={{ headerShown: false }} />
              <Stack.Screen
                name="reset-password"
                options={{ headerShown: false }}
              />
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
                name="settings/change-password"
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
