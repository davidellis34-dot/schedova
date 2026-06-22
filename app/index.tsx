import { useRouter } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import { AppScreen } from "../components/layout/AppScreen";
import { useAuthSession } from "../lib/authSession";
import { hasSelectedUserCountryRegion } from "../lib/countrySettings";
import { refreshFeatureAccess } from "../lib/featureAccess";
import {
  PRIVACY_POLICY_URL,
  SUPPORT_EMAIL,
  TERMS_OF_USE_URL,
  openExternalWebsite,
  openSupportEmail,
} from "../lib/legalLinks";
import { hasCompletedOnboarding } from "../lib/onboarding";

export default function SplashScreen() {
  const router = useRouter();
  const { isHydrated, userId } = useAuthSession();
  const [loading, setLoading] = useState(true);

  const checkSession = useCallback(async () => {
    if (!isHydrated) {
      setLoading(true);
      return;
    }

    if (userId) {
      await refreshFeatureAccess(userId, "splash-session");
      const nextRoute = (await hasCompletedOnboarding()
        ? "/dashboard"
        : "/onboarding") as "/dashboard" | "/onboarding";

      if (!(await hasSelectedUserCountryRegion())) {
        router.replace({
          pathname: "/country-region",
          params: { next: nextRoute },
        } as any);
        return;
      }

      router.replace(nextRoute as any);
    } else {
      setLoading(false);
    }
  }, [isHydrated, router, userId]);

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

      <Pressable
        onPress={() => router.push("/preview" as any)}
        style={{
          backgroundColor: "#ECFDF5",
          borderColor: "#0F766E",
          borderWidth: 1,
          paddingVertical: 16,
          borderRadius: 18,
          alignItems: "center",
          marginBottom: 10,
        }}
      >
        <Text
          style={{
            color: "#0F766E",
            fontSize: 17,
            fontWeight: "900",
          }}
        >
          Preview Schedova
        </Text>
      </Pressable>

      <View
        style={{
          flexDirection: "row",
          justifyContent: "center",
          flexWrap: "wrap",
          gap: 16,
          marginTop: 14,
        }}
      >
        <Pressable
          onPress={() => {
            void openExternalWebsite("Privacy Policy", PRIVACY_POLICY_URL);
          }}
          hitSlop={8}
        >
          <Text style={{ color: "#0F766E", fontWeight: "800" }}>
            Privacy Policy
          </Text>
        </Pressable>

        <Pressable
          onPress={() => {
            void openExternalWebsite("Terms of Use", TERMS_OF_USE_URL);
          }}
          hitSlop={8}
        >
          <Text style={{ color: "#0F766E", fontWeight: "800" }}>
            Terms of Use
          </Text>
        </Pressable>

        <Pressable
          onPress={() => {
            void openSupportEmail();
          }}
          hitSlop={8}
        >
          <Text style={{ color: "#0F766E", fontWeight: "800" }}>
            Contact Support
          </Text>
        </Pressable>
      </View>

      <Text
        style={{
          color: "#6B7280",
          textAlign: "center",
          fontSize: 12,
          marginTop: 10,
        }}
      >
        {SUPPORT_EMAIL}
      </Text>
    </AppScreen>
  );
}
