import { useRouter } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Pressable, Text } from "react-native";
import { AppScreen } from "../components/layout/AppScreen";
import { refreshFeatureAccess } from "../lib/featureAccess";
import { supabase } from "../lib/supabase";

export default function SplashScreen() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);

  const checkSession = useCallback(async () => {
    const response = await supabase.auth.getSession();

    const session = response.data.session;

    if (session) {
      await refreshFeatureAccess(session.user.id, "splash-session");
      router.replace("/dashboard" as any);
    } else {
      setLoading(false);
    }
  }, [router]);

  useEffect(() => {
    void checkSession();
  }, [checkSession]);

  if (loading) {
    return (
      <AppScreen
        backgroundColor="#0F766E"
        contentContainerStyle={{
          justifyContent: "center",
          alignItems: "center",
        }}
      >
        <ActivityIndicator size="large" color="#ffffff" />

        <Text
          style={{
            color: "#ffffff",
            fontSize: 28,
            fontWeight: "bold",
            marginTop: 18,
          }}
        >
          Schedova
        </Text>
      </AppScreen>
    );
  }

  return (
    <AppScreen
      backgroundColor="#ffffff"
      horizontalPadding={28}
      contentContainerStyle={{ justifyContent: "center" }}
    >
      <Text
        style={{
          fontSize: 44,
          fontWeight: "bold",
          textAlign: "center",
          color: "#111111",
          marginBottom: 12,
        }}
      >
        Schedova
      </Text>

      <Text
        style={{
          fontSize: 17,
          color: "#555555",
          textAlign: "center",
          marginBottom: 46,
        }}
      >
        Book clients, manage services, and keep your day organized.
      </Text>

      <Pressable
        onPress={() => router.replace("/login" as any)}
        style={{
          backgroundColor: "#0F766E",
          paddingVertical: 18,
          borderRadius: 18,
          alignItems: "center",
          shadowColor: "#0F766E",
          shadowOffset: {
            width: 0,
            height: 6,
          },
          shadowOpacity: 0.35,
          shadowRadius: 10,
          elevation: 10,
          marginBottom: 16,
        }}
      >
        <Text
          style={{
            color: "#ffffff",
            fontSize: 17,
            fontWeight: "bold",
          }}
        >
          Login / Create Account
        </Text>
      </Pressable>
    </AppScreen>
  );
}
