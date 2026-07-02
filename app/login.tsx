import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { Keyboard, Text, TextInput, View } from "react-native";
import {
  AppButton,
  AppCard,
  AppScreen,
  AppTextInput,
  ScreenHeader,
  createSchedovaUiTheme,
} from "../components/ui";
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
import { supabase } from "../lib/supabase";
import { useAppTheme } from "../lib/useAppTheme";

export default function LoginScreen() {
  const router = useRouter();
  const { authStatus, isHydrated, userId } = useAuthSession();
  const params = useLocalSearchParams<{
    mode?: string;
    previewMessage?: string;
  }>();
  const { colors } = useAppTheme();
  const uiColors = createSchedovaUiTheme(colors).colors;
  const emailRef = useRef<TextInput | null>(null);
  const passwordRef = useRef<TextInput | null>(null);
  const emailFocusedRef = useRef(false);
  const passwordFocusedRef = useRef(false);
  const navigatingRef = useRef(false);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [authMode, setAuthMode] = useState<"signin" | "signup">("signin");
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [infoMessage, setInfoMessage] = useState("");
  const [previewMessage, setPreviewMessage] = useState("");
  const [pendingNavigationUserId, setPendingNavigationUserId] = useState<
    string | null
  >(null);
  const [pendingNavigationMode, setPendingNavigationMode] = useState<
    "signin" | "signup" | null
  >(null);

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

  async function settleKeyboard() {
    Keyboard.dismiss();
    await new Promise((resolve) => setTimeout(resolve, 100));
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => resolve());
    });
  }

  const blurAuthInputs = useCallback(() => {
    emailFocusedRef.current = false;
    passwordFocusedRef.current = false;
    emailRef.current?.blur();
    passwordRef.current?.blur();
  }, []);

  const hasFocusedInput = useCallback(() => {
    return (
      emailFocusedRef.current ||
      passwordFocusedRef.current ||
      Boolean(TextInput.State.currentlyFocusedInput?.())
    );
  }, []);

  const waitForBlurredInputs = useCallback(async () => {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      blurAuthInputs();
      await settleKeyboard();

      if (!hasFocusedInput()) {
        return;
      }
    }
  }, [blurAuthInputs, hasFocusedInput]);

  const navigateAfterAuth = useCallback(
    async (
      route:
        | "/dashboard"
        | "/onboarding"
        | {
            pathname: "/country-region";
            params: { next: "/dashboard" | "/onboarding" };
          },
    ) => {
      if (navigatingRef.current) {
        return;
      }

      navigatingRef.current = true;

      try {
        await waitForBlurredInputs();
        await settleKeyboard();

        if (hasFocusedInput()) {
          await waitForBlurredInputs();
        }

        if (typeof route === "string") {
          router.replace(route as any);
          return;
        }

        router.replace(route as any);
      } finally {
        navigatingRef.current = false;
      }
    },
    [hasFocusedInput, router, waitForBlurredInputs],
  );

  useEffect(() => {
    if (
      !pendingNavigationUserId ||
      !pendingNavigationMode ||
      !isHydrated ||
      authStatus !== "authenticated" ||
      userId !== pendingNavigationUserId
    ) {
      return;
    }

    let cancelled = false;

    async function completePostAuthNavigation() {
      const navigationSource =
        pendingNavigationMode === "signup" ? "signup" : "signin";

      try {
        await refreshFeatureAccess(pendingNavigationUserId, navigationSource);

        const nextRoute =
          navigationSource === "signup"
            ? ("/onboarding" as const)
            : ((await hasCompletedOnboarding())
                ? "/dashboard"
                : "/onboarding") as "/dashboard" | "/onboarding";

        if (!(await hasSelectedUserCountryRegion())) {
          await navigateAfterAuth({
            pathname: "/country-region",
            params: { next: nextRoute },
          });
          return;
        }

        await navigateAfterAuth(nextRoute);
      } catch (error) {
        if (!cancelled) {
          setErrorMessage(
            error instanceof Error
              ? error.message
              : "Unable to finish signing in. Please try again.",
          );
        }
      } finally {
        if (!cancelled) {
          setPendingNavigationUserId(null);
          setPendingNavigationMode(null);
          setSubmitting(false);
        }
      }
    }

    void completePostAuthNavigation();

    return () => {
      cancelled = true;
    };
  }, [
    authStatus,
    isHydrated,
    navigateAfterAuth,
    pendingNavigationMode,
    pendingNavigationUserId,
    userId,
  ]);

  async function signUp() {
    if (!email || !password) {
      setErrorMessage("Enter email and password.");
      return false;
    }

    const { data, error } = await supabase.auth.signUp({
      email,
      password,
    });

    if (error) {
      setErrorMessage(error.message);
      return false;
    }

    const signedUpUserId = data.session?.user?.id ?? null;

    if (signedUpUserId) {
      setPendingNavigationMode("signup");
      setPendingNavigationUserId(signedUpUserId);
      return true;
    }

    setErrorMessage("");
    setInfoMessage("Check your email to confirm your account.");
    return false;
  }

  async function login() {
    Keyboard.dismiss();
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      setErrorMessage(error.message);
      return false;
    }

    setErrorMessage("");
    const signedInUserId = data.user?.id ?? data.session?.user?.id ?? null;

    if (!signedInUserId) {
      setErrorMessage("Signed in, but the account session was not ready.");
      return false;
    }

    setPendingNavigationMode("signin");
    setPendingNavigationUserId(signedInUserId);
    return true;
  }

  async function submitAuth() {
    if (submitting || authStatus === "signingOut" || navigatingRef.current) {
      return;
    }

    blurAuthInputs();
    setInfoMessage("");
    setErrorMessage("");
    await settleKeyboard();

    setSubmitting(true);
    let navigationPending = false;

    try {
      navigationPending =
        authMode === "signin" ? await login() : await signUp();

      if (navigationPending) {
        return;
      }
    } catch (error) {
      setErrorMessage(
        error instanceof Error
          ? error.message
          : "Unable to reach the sign-in service right now.",
      );
    } finally {
      if (!navigationPending) {
        setSubmitting(false);
      }
    }
  }

  async function handlePasswordSubmit() {
    blurAuthInputs();
    await settleKeyboard();
    await submitAuth();
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

        {infoMessage ? (
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
              {infoMessage}
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
          ref={emailRef}
          label="Email"
          value={email}
          onChangeText={(value) => {
            setEmail(value);
            setErrorMessage("");
            setInfoMessage("");
          }}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="email-address"
          placeholder="you@email.com"
          autoFocus={false}
          returnKeyType="next"
          blurOnSubmit={false}
          onFocus={() => {
            emailFocusedRef.current = true;
          }}
          onBlur={() => {
            emailFocusedRef.current = false;
          }}
          onSubmitEditing={() => {
            emailRef.current?.blur();
            passwordRef.current?.focus();
          }}
        />

        <AppTextInput
          ref={passwordRef}
          label="Password"
          value={password}
          onChangeText={(value) => {
            setPassword(value);
            setErrorMessage("");
            setInfoMessage("");
          }}
          secureTextEntry
          placeholder="Password"
          containerStyle={{ marginBottom: 20 }}
          autoFocus={false}
          returnKeyType={authMode === "signin" ? "done" : "go"}
          onFocus={() => {
            passwordFocusedRef.current = true;
          }}
          onBlur={() => {
            passwordFocusedRef.current = false;
          }}
          onSubmitEditing={() => {
            void handlePasswordSubmit();
          }}
        />

        <AppButton
          title={authMode === "signin" ? "Sign In" : "Create Account"}
          onPress={() => {
            void submitAuth();
          }}
          loading={submitting}
          disabled={submitting || authStatus === "signingOut"}
        />

        <AppButton
          title={
            authMode === "signin"
              ? "Create a new account"
              : "Already have an account? Sign in"
          }
          variant="ghost"
          disabled={submitting || authStatus === "signingOut"}
          onPress={() => {
            setErrorMessage("");
            setInfoMessage("");
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
