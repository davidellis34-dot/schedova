import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useState } from "react";
import { Alert, Pressable, Text, View } from "react-native";
import {
  AppButton,
  AppCard,
  AppScreen,
  ScreenHeader,
  createSchedovaUiTheme,
} from "../components/ui";
import { useAuthSession } from "../lib/authSession";
import { clearFeatureAccess } from "../lib/featureAccess";
import { SUPPORT_EMAIL, openSupportEmail } from "../lib/legalLinks";
import { ENABLE_PRO } from "../lib/proFeatureFlag";
import { useSubscription } from "../lib/revenuecat/SubscriptionProvider";
import { supabase } from "../lib/supabase";
import { useAppTheme } from "../lib/useAppTheme";

type DeleteAccountResult = {
  ok?: boolean;
  deleted?: boolean;
  requestId?: string | null;
  message?: string;
};

export default function DeleteAccountScreen() {
  const { colors: appColors } = useAppTheme();
  const theme = createSchedovaUiTheme(appColors);
  const { colors, spacing, typography, radii } = theme;
  const { signOut } = useAuthSession();
  const { showCustomerCenter } = useSubscription();
  const [submitting, setSubmitting] = useState(false);
  const [understood, setUnderstood] = useState(false);

  async function deleteAccount() {
    if (submitting || !understood) return;

    const {
      data: { session },
      error: sessionError,
    } = await supabase.auth.getSession();

    if (sessionError || !session?.user?.id) {
      Alert.alert(
        "Sign in required",
        "Sign in to the account you want deleted, then return to this screen.",
      );
      return;
    }

    Alert.alert(
      "Delete Account",
      "This permanently deletes your Schedova account and associated app data. This action cannot be undone.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete My Account",
          style: "destructive",
          onPress: () => {
            void completeDeletion();
          },
        },
      ],
    );
  }

  async function completeDeletion() {
    setSubmitting(true);

    try {
      const { data, error } =
        await supabase.functions.invoke<DeleteAccountResult>("delete-account", {
          body: { requestedFrom: "app" },
        });

      if (error || data?.ok === false || data?.deleted !== true) {
        Alert.alert(
          "Unable to delete account",
          "Unable to delete account. Please try again.",
        );
        return;
      }

      clearFeatureAccess("account-deleted");

      try {
        await signOut();
      } catch {
        // The Edge Function may already have deleted the auth user.
      }

      Alert.alert(
        "Account deleted",
        "Your Schedova account and app data were deleted. This device has been signed out.",
        [
          {
            text: "OK",
            onPress: () => router.replace("/login"),
          },
        ],
      );
    } catch {
      Alert.alert(
        "Unable to delete account",
        "Unable to delete account. Please try again.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AppScreen scroll backgroundColor={colors.background}>
      <ScreenHeader
        title="Delete Account"
        subtitle="Permanently delete your Schedova account and app data."
        showBack
      />

      <AppCard style={{ gap: spacing.md, marginBottom: spacing.lg }}>
        <Text
          style={{
            color: colors.text,
            fontSize: typography.sizes.cardTitle,
            fontWeight: typography.weights.heavy,
          }}
        >
          This action cannot be undone
        </Text>
        <Text
          style={{
            color: colors.mutedText,
            fontSize: typography.sizes.body,
            lineHeight: typography.lineHeights.body,
          }}
        >
          This will permanently delete your Schedova account and associated
          business data, including clients, services, appointments, settings,
          message templates, and settings stored by Schedova.
        </Text>
      </AppCard>

      {ENABLE_PRO ? (
        <AppCard style={{ gap: spacing.md, marginBottom: spacing.lg }}>
          <Text
            style={{
              color: colors.text,
              fontSize: typography.sizes.cardTitle,
              fontWeight: typography.weights.heavy,
            }}
          >
            Subscription warning
          </Text>
          <Text
            style={{
              color: colors.mutedText,
              fontSize: typography.sizes.body,
              lineHeight: typography.lineHeights.body,
            }}
          >
            Deleting your Schedova account does not automatically cancel any
            active App Store or Google Play subscription. Cancel your
            subscription from your Apple ID or Google Play account if needed.
          </Text>
          <AppButton
            title="Manage Subscription"
            variant="secondary"
            onPress={() => {
              void showCustomerCenter();
            }}
          />
        </AppCard>
      ) : null}

      <Pressable
        accessibilityRole="checkbox"
        accessibilityState={{ checked: understood }}
        onPress={() => setUnderstood((current) => !current)}
        style={({ pressed }) => ({
          alignItems: "flex-start",
          backgroundColor: colors.card,
          borderColor: understood ? colors.destructive : colors.border,
          borderRadius: radii.xl,
          borderWidth: 1,
          flexDirection: "row",
          gap: spacing.md,
          marginBottom: spacing.lg,
          opacity: pressed ? 0.86 : 1,
          padding: spacing.lg,
        })}
      >
        <View
          style={{
            alignItems: "center",
            backgroundColor: understood ? colors.destructive : "transparent",
            borderColor: understood ? colors.destructive : colors.border,
            borderRadius: radii.sm,
            borderWidth: 1,
            height: 24,
            justifyContent: "center",
            marginTop: 1,
            width: 24,
          }}
        >
          {understood ? (
            <Ionicons name="checkmark" size={16} color={colors.white} />
          ) : null}
        </View>
        <Text
          style={{
            color: colors.text,
            flex: 1,
            fontSize: typography.sizes.body,
            fontWeight: typography.weights.bold,
            lineHeight: typography.lineHeights.body,
          }}
        >
          I understand this will permanently delete my account.
        </Text>
      </Pressable>

      <AppButton
        title="Delete My Account"
        variant="destructive"
        loading={submitting}
        disabled={!understood || submitting}
        onPress={deleteAccount}
        style={{ marginBottom: spacing.md }}
      />

      <AppButton
        title="Keep My Account"
        variant="secondary"
        disabled={submitting}
        onPress={() => router.back()}
        style={{ marginBottom: spacing.lg }}
      />

      <AppCard variant="subtle" style={{ gap: spacing.sm }}>
        <Text
          style={{
            color: colors.text,
            fontWeight: typography.weights.heavy,
          }}
        >
          Need help?
        </Text>
        <Text
          style={{
            color: colors.mutedText,
            fontSize: typography.sizes.helper,
            lineHeight: typography.lineHeights.helper,
          }}
        >
          You can still contact {SUPPORT_EMAIL} for help, but email is not
          required to delete your account.
        </Text>
        <AppButton
          title="Contact Support"
          variant="ghost"
          fullWidth={false}
          onPress={() => {
            void openSupportEmail();
          }}
          style={{ alignSelf: "flex-start", paddingHorizontal: 0 }}
        />
      </AppCard>
    </AppScreen>
  );
}
