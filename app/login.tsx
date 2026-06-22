import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { Alert, Text, View } from "react-native";
import {
  AppButton,
  AppCard,
  AppScreen,
  AppTextInput,
  ScreenHeader,
  createSchedovaUiTheme,
} from "../components/ui";
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
import { supabase } from "../lib/supabase";
import { useAppTheme } from "../lib/useAppTheme";

export default function LoginScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{
    mode?: string;
    previewMessage?: string;
  }>();
  const { colors } = useAppTheme();
  const uiColors = createSchedovaUiTheme(colors).colors;

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [authMode, setAuthMode] = useState<"signin" | "signup">("signin");
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [previewMessage, setPreviewMessage] = useState("");

  useEffect(() => {
    if (params.mode === "signup") {
      setAuthMode("signup");
    } else if (params.mode === "signin") {
      setAuthMode("signin");
    }

    if (typeof params.previewMessage === "string") {
      setPreviewMessage(params.previewMessage);
    }
  }, [params.mode, params.previewMessage]);

  async function signUp() {
    if (!email || !password) {
      const message = "Enter email and password.";
      setErrorMessage(message);
      Alert.alert("Missing Info", message);
      return;
    }

    const { data, error } = await supabase.auth.signUp({
      email,
      password,
    });

    if (error) {
      setErrorMessage(error.message);
      Alert.alert("Sign Up Error", error.message);
      return;
    }

    if (data.session?.user?.id) {
      await refreshFeatureAccess(data.session.user.id, "signup");
      router.replace({
        pathname: "/country-region",
        params: { next: "/onboarding" },
      } as any);
      return;
    }

    setErrorMessage("");
    Alert.alert("Account Created", "Check your email to confirm your account.");
  }

  async function login() {
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      setErrorMessage(error.message);
      Alert.alert("Login Error", error.message);
      return;
    }

    setErrorMessage("");
    await refreshFeatureAccess(data.user?.id, "login");

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
  }

  async function submitAuth() {
    if (submitting) return;

    setSubmitting(true);
    setErrorMessage("");

    try {
      if (authMode === "signin") {
        await login();
        return;
      }

      await signUp();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AppScreen
      scroll
      keyboardAware
      backgroundColor={colors.background}
      horizontalPadding={24}
      topPadding={24}
      bottomPadding={72}
      androidBottomPadding={120}
      keyboardDismissMode="on-drag"
      contentContainerStyle={{ flexGrow: 1, justifyContent: "center" }}
    >
      <ScreenHeader
        title="Schedova"
        subtitle="Book clients, manage services, and keep your day organized."
      />

      <AppCard style={{ marginBottom: 14 }}>
        <Text style={{ color: colors.text, fontSize: 18, fontWeight: "900" }}>
          Want to look around first?
        </Text>
        <Text style={{ color: colors.mutedText, marginTop: 6, lineHeight: 20 }}>
          Preview what Schedova does, review pricing, and access legal/support
          information without creating an account.
        </Text>
        <AppButton
          title="Preview Schedova"
          variant="secondary"
          onPress={() => router.push("/preview" as any)}
          style={{ marginTop: 14 }}
        />
      </AppCard>

      <AppCard>
        <View style={{ marginBottom: 18 }}>
          <Text
            style={{
              color: colors.text,
              fontSize: 20,
              fontWeight: "900",
            }}
          >
            {authMode === "signin" ? "Welcome back" : "Create your account"}
          </Text>
          <Text style={{ color: colors.mutedText, marginTop: 6, lineHeight: 20 }}>
            {authMode === "signin"
              ? "Sign in to manage your appointments."
              : "Start setting up your booking workspace."}
          </Text>
        </View>

        {previewMessage ? (
          <View
            style={{
              borderWidth: 1,
              borderColor: "rgba(37,99,235,0.26)",
              backgroundColor: "rgba(37,99,235,0.10)",
              borderRadius: 14,
              padding: 12,
              marginBottom: 16,
            }}
          >
            <Text
              style={{
                color: colors.text,
                fontWeight: "800",
                lineHeight: 20,
              }}
            >
              {previewMessage}
            </Text>
          </View>
        ) : null}

        {errorMessage ? (
          <View
            style={{
              borderWidth: 1,
              borderColor: uiColors.destructive,
              backgroundColor: "rgba(220,38,38,0.12)",
              borderRadius: 14,
              padding: 12,
              marginBottom: 16,
            }}
          >
            <Text
              style={{
                color: colors.text,
                fontWeight: "800",
                lineHeight: 20,
              }}
            >
              {errorMessage}
            </Text>
          </View>
        ) : null}

        <AppTextInput
          label="Email"
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="email-address"
          placeholder="you@email.com"
        />

        <AppTextInput
          label="Password"
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          placeholder="Password"
          containerStyle={{ marginBottom: 20 }}
        />

        <AppButton
          title={authMode === "signin" ? "Sign In" : "Create Account"}
          onPress={() => {
            void submitAuth();
          }}
          loading={submitting}
          disabled={submitting}
        />

        <AppButton
          title={
            authMode === "signin"
              ? "Create a new account"
              : "Already have an account? Sign in"
          }
          variant="ghost"
          disabled={submitting}
          onPress={() => {
            setErrorMessage("");
            setAuthMode((current) =>
              current === "signin" ? "signup" : "signin",
            );
          }}
          style={{ marginTop: 10 }}
        />
      </AppCard>

      <Text
        style={{
          color: colors.mutedText,
          textAlign: "center",
          marginTop: 18,
          lineHeight: 20,
        }}
      >
        By continuing, you agree to the{" "}
        <Text
          accessibilityRole="link"
          onPress={() => {
            void openExternalWebsite("Terms of Use", TERMS_OF_USE_URL);
          }}
          style={{ color: colors.primary, fontWeight: "800" }}
        >
          Terms of Use
        </Text>
        {" "}and can review how Schedova handles data in the{" "}
        <Text
          accessibilityRole="link"
          onPress={() => {
            void openExternalWebsite("Privacy Policy", PRIVACY_POLICY_URL);
          }}
          style={{ color: colors.primary, fontWeight: "800" }}
        >
          Privacy Policy
        </Text>
        , or contact{" "}
        <Text
          accessibilityRole="link"
          onPress={() => {
            void openSupportEmail();
          }}
          style={{ color: colors.primary, fontWeight: "800" }}
        >
          Support
        </Text>
        .
      </Text>

      <Text
        style={{
          color: colors.mutedText,
          textAlign: "center",
          marginTop: 8,
          fontSize: 12,
        }}
      >
        {SUPPORT_EMAIL}
      </Text>
    </AppScreen>
  );
}
