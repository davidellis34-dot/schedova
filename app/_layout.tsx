import { Stack, useRouter, useSegments } from "expo-router";
import { useEffect } from "react";
import { AppState } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";
import {
  clearFeatureAccess,
  refreshFeatureAccess,
} from "../lib/featureAccess";
import { supabase } from "../lib/supabase";

function FeatureAccessBootstrap() {
  useEffect(() => {
    let mounted = true;

    async function refreshFromSession(source: string) {
      const { data } = await supabase.auth.getSession();

      if (!mounted) return;

      if (data.session?.user?.id) {
        void refreshFeatureAccess(data.session.user.id, source);
        return;
      }

      clearFeatureAccess(source);
    }

    void refreshFromSession("app-start");

    const { data: authListener } = supabase.auth.onAuthStateChange(
      (event, session) => {
        if (session?.user?.id) {
          void refreshFeatureAccess(session.user.id, `auth:${event}`);
          return;
        }

        clearFeatureAccess(`auth:${event}`);
      },
    );

    const appStateListener = AppState.addEventListener("change", (state) => {
      if (state === "active") {
        void refreshFromSession("app-active");
      }
    });

    return () => {
      mounted = false;
      authListener.subscription.unsubscribe();
      appStateListener.remove();
    };
  }, []);

  return null;
}

function AuthRouteGuard() {
  const router = useRouter();
  const segments = useSegments();
  const routeKey = segments.join("/");

  useEffect(() => {
    let mounted = true;

    async function guardProtectedRoute() {
      const firstSegment = segments[0];
      const isPublicRoute =
        !firstSegment || firstSegment === "index" || firstSegment === "login";

      if (isPublicRoute) return;

      const { data } = await supabase.auth.getSession();

      if (!mounted) return;

      if (!data.session?.user?.id) {
        router.replace("/login" as any);
      }
    }

    void guardProtectedRoute();

    return () => {
      mounted = false;
    };
  }, [routeKey, router, segments]);

  return null;
}

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <FeatureAccessBootstrap />
        <AuthRouteGuard />
        <Stack screenOptions={{ headerShown: false }}>
          <Stack.Screen name="dashboard" options={{ headerShown: false }} />
          <Stack.Screen name="index" options={{ headerShown: false }} />
          <Stack.Screen name="login" options={{ headerShown: false }} />
          <Stack.Screen
            name="book-appointment"
            options={{ headerShown: false }}
          />
          <Stack.Screen name="calendar-view" options={{ headerShown: false }} />
          <Stack.Screen name="clients" options={{ headerShown: false }} />
        </Stack>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
