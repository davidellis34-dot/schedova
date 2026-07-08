import { useRouter } from "expo-router";
import { useState } from "react";
import { Text, View } from "react-native";
import {
  AppButton,
  AppCard,
  AppScreen,
  AppTextInput,
  ScreenHeader,
  createSchedovaUiTheme,
} from "../../components/ui";
import { useAuthSession } from "../../lib/authSession";
import { AUTH_PASSWORD_MIN_LENGTH, canChangePassword } from "../../lib/mobileAuth";
import { supabase } from "../../lib/supabase";
import { useAppTheme } from "../../lib/useAppTheme";

export default function ChangePasswordScreen() {
  const router = useRouter();
  const { authStatus, user, userEmail } = useAuthSession();
  const { colors } = useAppTheme();
  const uiColors = createSchedovaUiTheme(colors).colors;

  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [infoMessage, setInfoMessage] = useState("");

  const passwordChangeAvailable =
    authStatus === "authenticated" && canChangePassword(user);

  async function updatePassword() {
    if (submitting) {
      return;
    }

    if (!passwordChangeAvailable) {
      setErrorMessage(
        "Password changes are only available for email/password accounts.",
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

      setInfoMessage("Your password was updated.");
      setPassword("");
      setConfirmPassword("");
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
      bottomPadding={64}
      contentContainerStyle={{
        alignSelf: "center",
        maxWidth: 720,
        width: "100%",
      }}
    >
      <ScreenHeader
        title="Change password"
        subtitle="Update the password tied to your Schedova email sign-in."
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

        {!passwordChangeAvailable ? (
          <View
            style={{
              borderWidth: 1,
              borderColor: uiColors.border,
              backgroundColor: uiColors.surfaceMuted,
              borderRadius: 14,
              padding: 12,
              marginBottom: 16,
            }}
          >
            <Text
              style={{
                color: colors.text,
                fontWeight: "700",
                lineHeight: 20,
              }}
            >
              This account signs in with a social provider. Use that provider to
              manage the password for {userEmail ?? "this account"}.
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
          editable={passwordChangeAvailable && !submitting}
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
          editable={passwordChangeAvailable && !submitting}
          containerStyle={{ marginBottom: 20 }}
        />

        <AppButton
          title="Save password"
          onPress={() => {
            void updatePassword();
          }}
          loading={submitting}
          disabled={!passwordChangeAvailable || submitting}
        />

        <AppButton
          title="Back to Settings"
          variant="ghost"
          disabled={submitting}
          onPress={() => router.back()}
          style={{ marginTop: 10 }}
        />
      </AppCard>
    </AppScreen>
  );
}
