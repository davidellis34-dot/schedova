import * as ExpoLinking from "expo-linking";
import { useRouter } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Text, View } from "react-native";
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
  AUTH_PASSWORD_MIN_LENGTH,
  completeAuthSessionFromUrl,
  getSessionUserId,
  matchesAuthRedirectPath,
  PASSWORD_RESET_REDIRECT_PATH,
} from "../lib/mobileAuth";
import { hasCompletedOnboarding } from "../lib/onboarding";
import { supabase } from "../lib/supabase";
import { useAppTheme } from "../lib/useAppTheme";

export default function ResetPasswordScreen() {
  const router = useRouter();
  const linkingUrl = ExpoLinking.useLinkingURL();
  const { authStatus, userEmail, userId } = useAuthSession();
  const { colors } = useAppTheme();
  const uiColors = createSchedovaUiTheme(colors).colors;
  const handledUrlRef = useRef<string | null>(null);

  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [isResolvingLink, setIsResolvingLink] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [recoveryReady, setRecoveryReady] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [infoMessage, setInfoMessage] = useState(
    "Open the reset link from your email on this device, then choose a new password.",
  );

  useEffect(() => {
    if (
      !linkingUrl ||
      !matchesAuthRedirectPath(linkingUrl, PASSWORD_RESET_REDIRECT_PATH)
    ) {
      return;
    }

    if (handledUrlRef.current === linkingUrl) {
      return;
    }

    let cancelled = false;
    handledUrlRef.current = linkingUrl;

    async function prepareRecoverySession() {
      const recoveryUrl = linkingUrl;

      if (!recoveryUrl) {
        return;
      }

      setIsResolvingLink(true);
      setErrorMessage("");

      try {
        const { session } = await completeAuthSessionFromUrl(recoveryUrl);
        const recoveryUserId = getSessionUserId(session);

        if (!recoveryUserId) {
          throw new Error(
            "This reset link is missing a valid session. Request a new password reset email and try again.",
          );
        }

        if (!cancelled) {
          setRecoveryReady(true);
          setInfoMessage(
            `Choose a new password for ${session?.user?.email ?? "your account"}.`,
          );
        }
      } catch (error) {
        if (!cancelled) {
          setRecoveryReady(false);
          setErrorMessage(
            error instanceof Error
              ? error.message
              : "Password recovery could not be started.",
          );
        }
      } finally {
        if (!cancelled) {
          setIsResolvingLink(false);
        }
      }
    }

    void prepareRecoverySession();

    return () => {
      cancelled = true;
    };
  }, [linkingUrl]);

  async function finishPasswordRecovery() {
    if (!userId) {
      throw new Error("The recovery session is no longer available.");
    }

    await refreshFeatureAccess(userId, "password-recovery");

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

  async function updatePassword() {
    if (submitting || isResolvingLink) {
      return;
    }

    if (!recoveryReady || authStatus !== "authenticated" || !userId) {
      setErrorMessage(
        "Open the password reset link from your email before choosing a new password.",
      );
      return;
    }

    if (password.length < AUTH_PASSWORD_MIN_LENGTH) {
      setErrorMessage(
        `Use at least ${AUTH_PASSWORD_MIN_LENGTH} characters for your new password.`,
      );
      return;
    }

    if (password !== confirmPassword) {
      setErrorMessage("The password confirmation does not match.");
      return;
    }

    setSubmitting(true);
    setErrorMessage("");

    try {
      const { error } = await supabase.auth.updateUser({ password });

      if (error) {
        throw error;
      }

      setInfoMessage("Password updated. Opening Schedova...");
      await finishPasswordRecovery();
    } catch (error) {
      setErrorMessage(
        error instanceof Error
          ? error.message
          : "Your password could not be updated.",
      );
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
      contentContainerStyle={{ flexGrow: 1, justifyContent: "center" }}
    >
      <ScreenHeader
        title="Reset password"
        subtitle="Create a new password, then continue back into Schedova."
        showBack
      />

      <AppCard>
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

        {isResolvingLink ? (
          <View style={{ alignItems: "center", marginBottom: 18 }}>
            <ActivityIndicator color={colors.primary} />
            <Text
              style={{
                color: colors.mutedText,
                marginTop: 12,
                textAlign: "center",
              }}
            >
              Confirming your reset link...
            </Text>
          </View>
        ) : null}

        <AppTextInput
          label="New password"
          value={password}
          onChangeText={(value) => {
            setPassword(value);
            setErrorMessage("");
          }}
          secureTextEntry
          placeholder="New password"
          autoCapitalize="none"
          autoCorrect={false}
          editable={!isResolvingLink && !submitting}
          helperText={`Use at least ${AUTH_PASSWORD_MIN_LENGTH} characters.`}
        />

        <AppTextInput
          label="Confirm password"
          value={confirmPassword}
          onChangeText={(value) => {
            setConfirmPassword(value);
            setErrorMessage("");
          }}
          secureTextEntry
          placeholder="Confirm password"
          autoCapitalize="none"
          autoCorrect={false}
          editable={!isResolvingLink && !submitting}
          containerStyle={{ marginBottom: 20 }}
        />

        <AppButton
          title="Save new password"
          onPress={() => {
            void updatePassword();
          }}
          loading={submitting}
          disabled={submitting || isResolvingLink}
        />

        <AppButton
          title="Back to sign in"
          variant="ghost"
          disabled={submitting}
          onPress={() =>
            router.replace({
              pathname: "/login",
              params: { mode: "signin" },
            } as any)
          }
          style={{ marginTop: 10 }}
        />

        <Text
          style={{
            color: colors.mutedText,
            marginTop: 16,
            textAlign: "center",
          }}
        >
          {userEmail
            ? `Resetting password for ${userEmail}.`
            : "Password recovery stays inside Schedova once the email link opens the app."}
        </Text>
      </AppCard>
    </AppScreen>
  );
}
