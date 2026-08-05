import Constants from "expo-constants";
import { Ionicons } from "@expo/vector-icons";
import * as ExpoLinking from "expo-linking";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Platform,
  Pressable,
  Text,
  TextInput,
  View,
} from "react-native";
import {
  AppButton,
  AppCard,
  AppScreen,
  AppTextInput,
  ScreenHeader,
  createSchedovaUiTheme,
} from "../components/ui";
import { useAuthSession } from "../lib/authSession";
import { isGoogleOAuthDiagnosticsEnabled } from "../lib/authDebugVisibility";
import {
  PRIVACY_POLICY_URL,
  SUPPORT_EMAIL,
  TERMS_OF_USE_URL,
  openExternalWebsite,
  openSupportEmail,
} from "../lib/legalLinks";
import {
  beginNativeAppleSignIn,
  beginSocialAuth,
  completeAuthSessionFromUrl,
  getAuthCallbackMetadata,
  getSessionUserId,
  getGoogleOAuthRedirectUri,
  isNativeAppleAuthAvailable,
  LOGIN_AUTH_REDIRECT_PATH,
  matchesAuthRedirectPath,
  sendPasswordResetEmail,
} from "../lib/mobileAuth";
import { supabase } from "../lib/supabase";
import { useAppTheme } from "../lib/useAppTheme";

export default function LoginScreen() {
  const router = useRouter();
  const {
    authStatus,
    beginSignInTransition,
    cancelAuthTransition,
  } = useAuthSession();
  const params = useLocalSearchParams<{
    authMessage?: string;
    mode?: string;
    previewMessage?: string;
  }>();
  const linkingUrl = ExpoLinking.useLinkingURL();
  const { colors } = useAppTheme();
  const uiColors = createSchedovaUiTheme(colors).colors;
  const envBuildProfile = process.env.EXPO_PUBLIC_EAS_BUILD_PROFILE;
  const emailRef = useRef<TextInput | null>(null);
  const passwordRef = useRef<TextInput | null>(null);
  const emailFocusedRef = useRef(false);
  const passwordFocusedRef = useRef(false);
  const handledAuthUrlRef = useRef<string | null>(null);
  const mountedRef = useRef(true);
  const appleAuthInFlightRef = useRef(false);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [authMode, setAuthMode] = useState<"signin" | "signup">("signin");
  const [submitting, setSubmitting] = useState(false);
  const [activeAuthAction, setActiveAuthAction] = useState<
    "apple" | "email" | "google" | "reset" | null
  >(null);
  const [errorMessage, setErrorMessage] = useState("");
  const [infoMessage, setInfoMessage] = useState("");
  const [previewMessage, setPreviewMessage] = useState("");
  const [appleAuthAvailable, setAppleAuthAvailable] = useState(false);
  const [googleProviderRedirectPreview, setGoogleProviderRedirectPreview] =
    useState<string | null>(null);
  const googleRedirectPreview = getGoogleOAuthRedirectUri();
  const authDebugVisible = isGoogleOAuthDiagnosticsEnabled();

  useEffect(() => {
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (params.mode === "signup") {
      setAuthMode("signup");
    } else if (params.mode === "signin") {
      setAuthMode("signin");
    }

    if (typeof params.previewMessage === "string") {
      setPreviewMessage(params.previewMessage);
    }

    if (typeof params.authMessage === "string") {
      setInfoMessage(params.authMessage);
    }
  }, [params.authMessage, params.mode, params.previewMessage]);

  useEffect(() => {
    if (Platform.OS !== "ios") {
      setAppleAuthAvailable(false);
      return;
    }

    let cancelled = false;

    void isNativeAppleAuthAvailable()
      .then((available) => {
        if (!cancelled) {
          setAppleAuthAvailable(available);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setAppleAuthAvailable(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (authStatus !== "authenticated" || !mountedRef.current) {
      return;
    }

    setSubmitting(false);
    setActiveAuthAction(null);
  }, [authStatus]);

  async function settleKeyboard() {
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => resolve());
    });
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

  const clearMessages = useCallback(() => {
    setErrorMessage("");
    setInfoMessage("");
  }, []);

  const handleAuthCallbackUrl = useCallback(
    async (url: string) => {
      const callbackReceived = matchesAuthRedirectPath(
        url,
        LOGIN_AUTH_REDIRECT_PATH,
      );
      const callbackMetadata = getAuthCallbackMetadata(url);

      if (__DEV__) {
        console.log("[GoogleOAuth] callback received", callbackReceived);
        console.log("[GoogleOAuth] callback has code", callbackMetadata.hasCode);
      }

      if (!callbackReceived) {
        return false;
      }

      if (handledAuthUrlRef.current === url) {
        return false;
      }

      handledAuthUrlRef.current = url;

      const { session } = await completeAuthSessionFromUrl(url, "GoogleOAuth");

      if (!mountedRef.current) {
        return false;
      }

      const callbackUserId = getSessionUserId(session);

      if (!callbackUserId) {
        setInfoMessage(
          "The sign-in flow finished, but Schedova did not receive a session.",
        );
        cancelAuthTransition();
        return false;
      }

      setErrorMessage("");
      setInfoMessage("Sign-in complete. Opening Schedova...");
      return true;
    },
    [cancelAuthTransition],
  );

  useEffect(() => {
    if (!linkingUrl || !matchesAuthRedirectPath(linkingUrl, LOGIN_AUTH_REDIRECT_PATH)) {
      return;
    }

    if (handledAuthUrlRef.current === linkingUrl) {
      return;
    }

    let cancelled = false;

    async function completeLinkedSignIn() {
      const callbackUrl = linkingUrl;

      if (!callbackUrl) {
        return;
      }

      setSubmitting(true);

      try {
        const navigationPending = await handleAuthCallbackUrl(callbackUrl);

        if (!navigationPending && !cancelled) {
          setSubmitting(false);
          setActiveAuthAction(null);
        }
      } catch (error) {
        if (!cancelled) {
          setErrorMessage(
            error instanceof Error
              ? error.message
              : "Social sign-in could not be completed.",
          );
          cancelAuthTransition();
          setSubmitting(false);
          setActiveAuthAction(null);
        }
      }
    }

    void completeLinkedSignIn();

    return () => {
      cancelled = true;
    };
  }, [cancelAuthTransition, handleAuthCallbackUrl, linkingUrl]);

  async function signUp() {
    const normalizedEmail = email.trim();

    if (!normalizedEmail || !password) {
      setErrorMessage("Enter email and password.");
      cancelAuthTransition();
      return false;
    }

    const { data, error } = await supabase.auth.signUp({
      email: normalizedEmail,
      password,
    });

    if (!mountedRef.current) {
      return false;
    }

    if (error) {
      setErrorMessage(error.message);
      cancelAuthTransition();
      return false;
    }

    const signedUpUserId = data.session?.user?.id ?? null;

    if (signedUpUserId) {
      setInfoMessage("Account ready. Opening Schedova...");
      return true;
    }

    setErrorMessage("");
    setInfoMessage("Check your email to confirm your account.");
    cancelAuthTransition();
    return false;
  }

  async function login() {
    const normalizedEmail = email.trim();

    const { data, error } = await supabase.auth.signInWithPassword({
      email: normalizedEmail,
      password,
    });

    if (!mountedRef.current) {
      return false;
    }

    if (error) {
      setErrorMessage(error.message);
      cancelAuthTransition();
      return false;
    }

    setErrorMessage("");
    const signedInUserId = data.user?.id ?? data.session?.user?.id ?? null;

    if (!signedInUserId) {
      setErrorMessage("Signed in, but the account session was not ready.");
      cancelAuthTransition();
      return false;
    }

    setInfoMessage("Sign-in complete. Opening Schedova...");
    return true;
  }

  async function submitAuth() {
    if (submitting || authStatus === "signingOut") {
      return;
    }

    blurAuthInputs();
    clearMessages();
    await settleKeyboard();

    if (!mountedRef.current) {
      return;
    }

    beginSignInTransition();
    setActiveAuthAction("email");
    setSubmitting(true);
    let navigationPending = false;

    try {
      navigationPending =
        authMode === "signin" ? await login() : await signUp();

      if (navigationPending) {
        return;
      }
    } catch (error) {
      if (!mountedRef.current) {
        return;
      }

      setErrorMessage(
        error instanceof Error
          ? error.message
          : "Unable to reach the sign-in service right now.",
      );
      cancelAuthTransition();
    } finally {
      if (!navigationPending && mountedRef.current) {
        setSubmitting(false);
      }
    }
  }

  async function handleForgotPassword() {
    if (submitting || authStatus === "signingOut") {
      return;
    }

    const normalizedEmail = email.trim();

    if (!normalizedEmail) {
      setErrorMessage("Enter your email first so we can send the reset link.");
      return;
    }

    blurAuthInputs();
    await settleKeyboard();

    if (!mountedRef.current) {
      return;
    }

    clearMessages();
    setActiveAuthAction("reset");
    setSubmitting(true);

    try {
      const { error } = await sendPasswordResetEmail(normalizedEmail);

      if (!mountedRef.current) {
        return;
      }

      if (error) {
        throw error;
      }

      setInfoMessage(
        `We sent a password reset link to ${normalizedEmail}. Open it on this device to continue in Schedova.`,
      );
    } catch (error) {
      if (!mountedRef.current) {
        return;
      }

      setErrorMessage(
        error instanceof Error
          ? error.message
          : "Password reset could not be started right now.",
      );
    } finally {
      if (mountedRef.current) {
        setSubmitting(false);
        setActiveAuthAction(null);
      }
    }
  }

  async function handlePasswordSubmit() {
    await submitAuth();
  }

  async function handleGoogleAuth() {
    if (submitting || authStatus === "signingOut") {
      return;
    }

    blurAuthInputs();
    await settleKeyboard();

    if (!mountedRef.current) {
      return;
    }

    clearMessages();
    setGoogleProviderRedirectPreview(null);
    beginSignInTransition();
    setActiveAuthAction("google");
    setSubmitting(true);

    let navigationPending = false;

    try {
      const { providerUrlRedirectTo, result } = await beginSocialAuth("google");

      if (!mountedRef.current) {
        return;
      }

      setGoogleProviderRedirectPreview(providerUrlRedirectTo);
      const callbackUrl =
        result.type === "success" ? (result.url ?? null) : null;

      if (!callbackUrl) {
        if (__DEV__) {
          console.log("[GoogleOAuth] callback received", false);
          console.log("[GoogleOAuth] callback has code", false);
        }
        setInfoMessage("Google sign-in was canceled before it finished.");
        cancelAuthTransition();
        return;
      }

      navigationPending = await handleAuthCallbackUrl(callbackUrl);
    } catch (error) {
      if (!mountedRef.current) {
        return;
      }

      setErrorMessage(
        error instanceof Error
          ? error.message
          : "Social sign-in could not be completed.",
      );
      cancelAuthTransition();
    } finally {
      if (!navigationPending && mountedRef.current) {
        setSubmitting(false);
        setActiveAuthAction(null);
      }
    }
  }

  async function handleAppleAuth() {
    if (
      Platform.OS !== "ios" ||
      !appleAuthAvailable ||
      submitting ||
      authStatus === "signingOut" ||
      appleAuthInFlightRef.current
    ) {
      return;
    }

    blurAuthInputs();
    await settleKeyboard();

    if (!mountedRef.current) {
      return;
    }

    clearMessages();
    beginSignInTransition();
    setActiveAuthAction("apple");
    setSubmitting(true);
    appleAuthInFlightRef.current = true;

    let navigationPending = false;

    try {
      const { cancelled, session } = await beginNativeAppleSignIn();

      if (!mountedRef.current) {
        return;
      }

      if (cancelled) {
        setInfoMessage("");
        cancelAuthTransition();
        return;
      }

      const signedInUserId = getSessionUserId(session);

      if (!signedInUserId) {
        setErrorMessage("Apple sign-in completed, but the session was not ready.");
        cancelAuthTransition();
        return;
      }

      setInfoMessage("Sign-in complete. Opening Schedova...");
      navigationPending = true;
    } catch (error) {
      if (!mountedRef.current) {
        return;
      }

      setErrorMessage(
        error instanceof Error
          ? error.message
          : "Apple sign-in could not be completed.",
      );
      cancelAuthTransition();
    } finally {
      appleAuthInFlightRef.current = false;

      if (!navigationPending && mountedRef.current) {
        setSubmitting(false);
        setActiveAuthAction(null);
      }
    }
  }

  const isAuthBusy = submitting || authStatus === "signingOut";

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

        <View style={{ gap: 10, marginBottom: 18 }}>
          <AppButton
            title="Continue with Google"
            variant="secondary"
            onPress={() => {
              void handleGoogleAuth();
            }}
            loading={submitting && activeAuthAction === "google"}
            disabled={isAuthBusy}
            leftAccessory={
              <Ionicons
                name="logo-google"
                size={18}
                color={uiColors.text}
              />
            }
          />

          {Platform.OS === "ios" && appleAuthAvailable ? (
            <AppButton
              title="Continue with Apple"
              variant="secondary"
              onPress={() => {
                void handleAppleAuth();
              }}
              loading={submitting && activeAuthAction === "apple"}
              disabled={isAuthBusy}
              leftAccessory={
                <Ionicons
                  name="logo-apple"
                  size={18}
                  color={uiColors.text}
                />
              }
            />
          ) : null}
        </View>

        {authDebugVisible ? (
          <View
            style={{
              backgroundColor: uiColors.surfaceMuted,
              borderColor: uiColors.border,
              borderRadius: 14,
              borderWidth: 1,
              marginBottom: 18,
              padding: 12,
            }}
          >
            <Text
              style={{
                color: colors.text,
                fontSize: 12,
                fontWeight: "800",
                marginBottom: 6,
              }}
            >
              Google OAuth Debug
            </Text>
            <Text style={{ color: colors.mutedText, fontSize: 12, lineHeight: 18 }}>
              Platform: {Platform.OS}
            </Text>
            <Text style={{ color: colors.mutedText, fontSize: 12, lineHeight: 18 }}>
              Redirect: {googleRedirectPreview}
            </Text>
            <Text style={{ color: colors.mutedText, fontSize: 12, lineHeight: 18 }}>
              Env: {Constants.executionEnvironment}
            </Text>
            <Text style={{ color: colors.mutedText, fontSize: 12, lineHeight: 18 }}>
              Build profile: {envBuildProfile || "unset"}
            </Text>
            <Text style={{ color: colors.mutedText, fontSize: 12, lineHeight: 18 }}>
              Provider redirect: {googleProviderRedirectPreview || "not opened yet"}
            </Text>
          </View>
        ) : null}

        <View
          style={{
            alignItems: "center",
            flexDirection: "row",
            gap: 12,
            marginBottom: 18,
          }}
        >
          <View
            style={{ backgroundColor: uiColors.border, flex: 1, height: 1 }}
          />
          <Text
            style={{
              color: colors.mutedText,
              fontSize: 13,
              fontWeight: "800",
            }}
          >
            or use email
          </Text>
          <View
            style={{ backgroundColor: uiColors.border, flex: 1, height: 1 }}
          />
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

        {authMode === "signin" ? (
          <View style={{ alignItems: "flex-end", marginBottom: 18, marginTop: -8 }}>
            <Pressable
              accessibilityRole="button"
              disabled={isAuthBusy}
              onPress={() => {
                void handleForgotPassword();
              }}
            >
              <Text
                style={{
                  color: isAuthBusy ? colors.mutedText : colors.primary,
                  fontWeight: "800",
                }}
              >
                Forgot password?
              </Text>
            </Pressable>
          </View>
        ) : null}

        <AppButton
          title={authMode === "signin" ? "Sign In" : "Create Account"}
          onPress={() => {
            void submitAuth();
          }}
          loading={submitting && activeAuthAction === "email"}
          disabled={isAuthBusy}
        />

        <AppButton
          title={
            authMode === "signin"
              ? "Create a new account"
              : "Already have an account? Sign in"
          }
          variant="ghost"
          disabled={isAuthBusy}
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
