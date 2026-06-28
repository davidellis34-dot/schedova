import { Ionicons } from "@expo/vector-icons";
import { router, useFocusEffect } from "expo-router";
import type { ReactNode } from "react";
import { useCallback, useEffect, useState } from "react";
import { Alert, Text, View } from "react-native";
import {
  AppScreen,
  ListRow,
  ScreenHeader,
  createSchedovaUiTheme,
} from "../../components/ui";
import { getUserCountryRegion } from "../../lib/countrySettings";
import { isSchedovaInternalDebugMode } from "../../lib/debugMode";
import { isDemoScreenshotModeAvailable } from "../../lib/demoData";
import { useFeatureAccess } from "../../lib/featureAccess";
import { ENABLE_PRO } from "../../lib/proFeatureFlag";
import {
  getSchedovaProFriendlyStatus,
  hasAdminLifetimeSchedovaProAccess,
} from "../../lib/subscriptionAccess";
import {
  ACCOUNT_DELETION_SUPPORT_INSTRUCTION,
  PRIVACY_POLICY_URL,
  SUPPORT_EMAIL,
  TERMS_OF_USE_URL,
  openExternalWebsite,
  openSupportEmail,
} from "../../lib/legalLinks";
import { getCountryRegionLabel } from "../../lib/phoneNumbers";
import { useSubscription } from "../../lib/revenuecat/SubscriptionProvider";
import { supabase } from "../../lib/supabase";
import { useAppTheme } from "../../lib/useAppTheme";

type SettingTone = "info" | "primary" | "danger" | "neutral";
type SettingIconName = keyof typeof Ionicons.glyphMap;

export default function SettingsScreen() {
  const { colors: appColors, themeName } = useAppTheme();
  const theme = createSchedovaUiTheme(appColors);
  const { colors, spacing, typography } = theme;
  const { subscription, userId: featureAccessUserId } = useFeatureAccess();
  const { isPro } = useSubscription();
  const [countryRegion, setCountryRegion] = useState("US");
  const [accountEmail, setAccountEmail] = useState("");
  const [accountUserId, setAccountUserId] = useState("");
  const isDarkTheme = themeName === "dark" || themeName === "black";
  const infoAccent = isDarkTheme ? "#60A5FA" : "#2563EB";
  const infoAccentSoft = isDarkTheme
    ? "rgba(96, 165, 250, 0.16)"
    : "rgba(37, 99, 235, 0.10)";
  const infoAccentBorder = isDarkTheme
    ? "rgba(96, 165, 250, 0.32)"
    : "rgba(37, 99, 235, 0.24)";
  const greenAccentSoft = isDarkTheme
    ? "rgba(15, 118, 110, 0.28)"
    : "rgba(15, 118, 110, 0.12)";
  const dangerAccentSoft = isDarkTheme
    ? "rgba(220, 38, 38, 0.18)"
    : "rgba(220, 38, 38, 0.10)";
  const dangerAccentBorder = isDarkTheme
    ? "rgba(248, 113, 113, 0.34)"
    : "rgba(220, 38, 38, 0.24)";
  const polishedBorder = isDarkTheme
    ? "rgba(148, 163, 184, 0.28)"
    : "rgba(15, 23, 42, 0.12)";
  const hasLifetimeAccess = hasAdminLifetimeSchedovaProAccess(subscription);
  const proUiVisible = true;
  const proSubtitle = hasLifetimeAccess
    ? "Lifetime access"
    : isPro
      ? getSchedovaProFriendlyStatus(subscription)
      : "Manage subscription and Pro features.";

  useFocusEffect(
    useCallback(() => {
      void getUserCountryRegion().then(setCountryRegion);
      void supabase.auth.getUser().then(({ data }) => {
        setAccountUserId(data.user?.id || "");
        setAccountEmail(data.user?.email || "");
      });
    }, []),
  );

  useEffect(() => {
    console.log("[Settings] ENABLE_PRO", ENABLE_PRO);
    console.log("[Settings] current user id", accountUserId || featureAccessUserId || null);
    console.log("[Settings] current user email", accountEmail || null);
    console.log("[Settings] subscription row", subscription);
    console.log("[Settings] adminLifetimeAccess", hasLifetimeAccess);
    console.log("[Settings] final isPro", isPro);
    console.log("[Settings] pro UI visible", proUiVisible);
  }, [
    accountEmail,
    accountUserId,
    featureAccessUserId,
    hasLifetimeAccess,
    isPro,
    proUiVisible,
    subscription,
  ]);

  function openPrivacyPolicy() {
    void openExternalWebsite("Privacy Policy", PRIVACY_POLICY_URL);
  }

  function openTermsOfUse() {
    void openExternalWebsite("Terms of Use", TERMS_OF_USE_URL);
  }

  async function switchAccount() {
    if (__DEV__) {
      console.log("[RevenueCat] Supabase sign out started");
    }

    try {
      const { error } = await supabase.auth.signOut();

      if (error) {
        Alert.alert("Sign Out Error", error.message);
        return;
      }

      router.replace("/login");
    } catch (error) {
      console.log("Sign out failed", error);
      Alert.alert("Sign Out Error", "Unable to sign out. Please try again.");
    }
  }

  const demoScreenshotModeAvailable = isDemoScreenshotModeAvailable();
  const internalDebugMode = isSchedovaInternalDebugMode();

  function getToneColor(tone: SettingTone) {
    if (tone === "primary") return colors.primary;
    if (tone === "danger") return colors.destructive;
    if (tone === "neutral") return colors.mutedText;

    return infoAccent;
  }

  function getToneBackground(tone: SettingTone) {
    if (tone === "primary") return greenAccentSoft;
    if (tone === "danger") return dangerAccentSoft;
    if (tone === "neutral") return colors.surfaceMuted;

    return infoAccentSoft;
  }

  function getToneBorder(tone: SettingTone) {
    if (tone === "danger") return dangerAccentBorder;
    if (tone === "info") return infoAccentBorder;

    return polishedBorder;
  }

  function rowStyle(tone: SettingTone = "neutral", accented = false) {
    const style = {
      borderColor: getToneBorder(tone),
    };

    if (!accented) return style;

    return {
      ...style,
      borderLeftColor: getToneColor(tone),
      borderLeftWidth: 4,
    };
  }

  function Section({
    title,
    subtitle,
    tone = "info",
    children,
  }: {
    title: string;
    subtitle?: string;
    tone?: SettingTone;
    children: ReactNode;
  }) {
    const accentColor = getToneColor(tone);

    return (
      <View style={{ marginBottom: spacing["2xl"] }}>
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: spacing.sm,
            marginBottom: subtitle ? spacing.xs : spacing.md,
          }}
        >
          <View
            style={{
              width: 4,
              height: 20,
              borderRadius: 999,
              backgroundColor: accentColor,
            }}
          />
          <Text
            style={{
              color: colors.text,
              fontSize: typography.sizes.cardTitle,
              fontWeight: typography.weights.heavy,
            }}
          >
            {title}
          </Text>
        </View>
        {subtitle ? (
          <Text
            style={{
              color: colors.mutedText,
              fontSize: typography.sizes.helper,
              lineHeight: typography.lineHeights.helper,
              marginBottom: spacing.md,
              marginLeft: spacing.md,
            }}
          >
            {subtitle}
          </Text>
        ) : null}
        <View style={{ gap: spacing.sm }}>{children}</View>
      </View>
    );
  }

  function IconBadge({
    name,
    tone = "info",
  }: {
    name: SettingIconName;
    tone?: SettingTone;
  }) {
    return (
      <View
        style={{
          width: 38,
          height: 38,
          borderRadius: 19,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: getToneBackground(tone),
          borderColor: getToneBorder(tone),
          borderWidth: 1,
        }}
      >
        <Ionicons name={name} size={18} color={getToneColor(tone)} />
      </View>
    );
  }

  function Chevron({ tone = "neutral" }: { tone?: SettingTone }) {
    return (
      <Text
        style={{
          color: getToneColor(tone),
          fontSize: typography.sizes.bodyLarge,
          fontWeight: typography.weights.heavy,
        }}
      >
        {">"}
      </Text>
    );
  }

  function PillLabel({
    label,
    tone = "info",
  }: {
    label: string;
    tone?: SettingTone;
  }) {
    return (
      <View
        style={{
          backgroundColor: getToneBackground(tone),
          borderColor: getToneBorder(tone),
          borderRadius: 999,
          borderWidth: 1,
          paddingHorizontal: spacing.sm,
          paddingVertical: spacing.xs,
        }}
      >
        <Text
          style={{
            color: getToneColor(tone),
            fontSize: typography.sizes.caption,
            fontWeight: typography.weights.heavy,
          }}
        >
          {label}
        </Text>
      </View>
    );
  }

  function ProRightLabel() {
    const tone: SettingTone = isPro ? "info" : "primary";
    const label = hasLifetimeAccess ? "Lifetime" : isPro ? "Active" : "Upgrade";

    return (
      <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
        <PillLabel label={label} tone={tone} />
        <Chevron tone={tone} />
      </View>
    );
  }

  return (
    <AppScreen
      scroll
      backgroundColor={colors.background}
      bottomPadding={64}
      contentContainerStyle={{
        alignSelf: "center",
        maxWidth: 920,
        width: "100%",
      }}
    >
      <ScreenHeader
        title="Settings"
        subtitle="Manage your account, business tools, and app preferences."
      />

      <Section
        title="Account & Business"
        subtitle="Your sign-in, business profile, and regional defaults."
      >
        <ListRow
          title="Signed in"
          subtitle={accountEmail || "Account identity unavailable"}
          leftIcon={<IconBadge name="person-outline" />}
          right={<PillLabel label="Account" />}
          style={rowStyle("info", true)}
        />
        <ListRow
          title="Business Setup"
          subtitle="Update the basics for your booking business."
          leftIcon={<IconBadge name="briefcase-outline" />}
          right={<Chevron />}
          onPress={() => router.push("/business-setup" as any)}
          style={rowStyle()}
        />
        <ListRow
          title="Country / Region"
          subtitle={getCountryRegionLabel(countryRegion)}
          leftIcon={<IconBadge name="globe-outline" />}
          right={<Chevron />}
          onPress={() =>
            router.push({
              pathname: "/country-region",
              params: { from: "settings", next: "/settings" },
            } as any)
          }
          style={rowStyle()}
        />
        <ListRow
          title="Sign Out / Switch Account"
          subtitle="Leave this account and choose another."
          leftIcon={<IconBadge name="log-out-outline" tone="neutral" />}
          right={<Chevron />}
          onPress={switchAccount}
          style={rowStyle()}
        />
      </Section>

      <Section
        title="Plan & Preferences"
        subtitle="Subscription status and app-level preferences."
      >
        <ListRow
          title="Schedova Pro"
          subtitle={proSubtitle}
          leftIcon={
            <IconBadge
              name="sparkles-outline"
              tone={isPro ? "info" : "primary"}
            />
          }
          right={<ProRightLabel />}
          onPress={() => router.push("/schedova-pro" as any)}
          style={rowStyle(isPro ? "info" : "primary", true)}
        />
        <ListRow
          title="Display & Theme"
          subtitle="Choose how Schedova looks while you work."
          leftIcon={<IconBadge name="contrast-outline" />}
          right={<Chevron />}
          onPress={() => router.push("/settings/display")}
          style={rowStyle()}
        />
        <ListRow
          title="Walkthrough"
          subtitle="Review the Schedova basics."
          leftIcon={<IconBadge name="map-outline" />}
          right={<Chevron />}
          onPress={() =>
            router.push({
              pathname: "/onboarding",
              params: { from: "settings" },
            } as any)
          }
          style={rowStyle()}
        />
      </Section>

      <Section
        title="Clients & Messaging"
        subtitle="Client records, services, and reusable communication tools."
      >
        <ListRow
          title="Clients"
          subtitle="Keep client details organized."
          leftIcon={<IconBadge name="people-outline" />}
          right={<Chevron />}
          onPress={() => router.push("/clients" as any)}
          style={rowStyle()}
        />
        <ListRow
          title="Services"
          subtitle="Manage services, prices, and timing."
          leftIcon={<IconBadge name="cut-outline" />}
          right={<Chevron />}
          onPress={() => router.push("/add-service" as any)}
          style={rowStyle()}
        />
        <ListRow
          title="SMS Settings"
          subtitle="Set up appointment text messaging."
          leftIcon={<IconBadge name="chatbubble-ellipses-outline" />}
          right={<Chevron />}
          onPress={() => router.push("/settings/sms")}
          style={rowStyle()}
        />
        <ListRow
          title="Message Packs"
          subtitle="Check SMS credits and buy message packs."
          leftIcon={<IconBadge name="cash-outline" />}
          right={<Chevron />}
          onPress={() => router.push("/settings/message-packs")}
          style={rowStyle()}
        />
        <ListRow
          title="Message Templates"
          subtitle="Create reusable client messages."
          leftIcon={<IconBadge name="document-text-outline" />}
          right={<Chevron />}
          onPress={() => router.push("/settings/message-templates")}
          style={rowStyle()}
        />
      </Section>

      <Section
        title="Calendar & Availability"
        subtitle="Appointment book, scheduling rules, and unavailable time."
      >
        <ListRow
          title="Calendar View"
          subtitle="Open your appointment book."
          leftIcon={<IconBadge name="calendar-outline" />}
          right={<Chevron />}
          onPress={() => router.push("/calendar-view" as any)}
          style={rowStyle()}
        />
        <ListRow
          title="Availability"
          subtitle="Set the days and hours your business is open."
          leftIcon={<IconBadge name="time-outline" />}
          right={<Chevron />}
          onPress={() => router.push("/availability-settings")}
          style={rowStyle()}
        />
        <ListRow
          title="Calendar Settings"
          subtitle="Adjust calendar hours, interval, and time format."
          leftIcon={<IconBadge name="options-outline" />}
          right={<Chevron />}
          onPress={() => router.push("/settings/calendar")}
          style={rowStyle()}
        />
        <ListRow
          title="Block Time"
          subtitle="Reserve time when you are unavailable."
          leftIcon={<IconBadge name="remove-circle-outline" />}
          right={<Chevron />}
          onPress={() => router.push("/block-time")}
          style={rowStyle()}
        />
      </Section>

      <Section
        title="Reports & Insights"
        subtitle="Business activity and service performance."
      >
        <ListRow
          title="Reports"
          subtitle="Track schedule and business activity."
          leftIcon={<IconBadge name="bar-chart-outline" />}
          right={<Chevron />}
          onPress={() => router.push("/reports")}
          style={rowStyle()}
        />
        <ListRow
          title="Service Reports"
          subtitle="See which services are booked most often."
          leftIcon={<IconBadge name="analytics-outline" />}
          right={<Chevron />}
          onPress={() => router.push("/service-reports" as any)}
          style={rowStyle()}
        />
      </Section>

      <Section title="Support & Legal" subtitle="Help, policy, and terms.">
        <ListRow
          title="Contact Support"
          subtitle={SUPPORT_EMAIL}
          leftIcon={<IconBadge name="mail-outline" />}
          right={<Chevron />}
          onPress={() => {
            void openSupportEmail();
          }}
          style={rowStyle()}
        />
        <ListRow
          title="Privacy Policy"
          subtitle="View how Schedova handles data."
          leftIcon={<IconBadge name="shield-checkmark-outline" />}
          right={<Chevron />}
          onPress={openPrivacyPolicy}
          style={rowStyle()}
        />
        <ListRow
          title="Terms of Use"
          subtitle="View Apple's standard EULA."
          leftIcon={<IconBadge name="reader-outline" />}
          right={<Chevron />}
          onPress={openTermsOfUse}
          style={rowStyle()}
        />
      </Section>

      <Section
        title="Danger Zone"
        subtitle="Permanent account actions are kept separate."
        tone="danger"
      >
        <ListRow
          title="Delete Account"
          subtitle={ACCOUNT_DELETION_SUPPORT_INSTRUCTION}
          leftIcon={<IconBadge name="trash-outline" tone="danger" />}
          right={<Chevron tone="danger" />}
          onPress={() => router.push("/delete-account" as any)}
          destructive
          style={rowStyle("danger", true)}
        />
      </Section>

      {internalDebugMode ? (
        <Section
          title="Developer"
          subtitle="Internal-only tools for launch checks and diagnostics."
        >
          {demoScreenshotModeAvailable ? (
            <ListRow
              title="Demo / Screenshots"
              subtitle="Expo/dev/testing only."
              leftIcon={<IconBadge name="camera-outline" tone="neutral" />}
              right={<Chevron />}
              onPress={() => router.push("/demo-data" as any)}
              style={rowStyle()}
            />
          ) : null}

          <ListRow
            title="RevenueCat Diagnostics"
            subtitle="Check Pro identity, restore, and Test Store state."
            leftIcon={<IconBadge name="bug-outline" tone="neutral" />}
            right={<Chevron />}
            onPress={() => router.push("/schedova-pro" as any)}
            style={rowStyle()}
          />

          {__DEV__ ? (
            <ListRow
              title="Launch Checklist"
              subtitle="Internal dev-only launch readiness tracker."
              leftIcon={<IconBadge name="checkbox-outline" tone="neutral" />}
              right={<Chevron />}
              onPress={() => router.push("/dev-launch-checklist" as any)}
              style={rowStyle()}
            />
          ) : null}
        </Section>
      ) : null}
    </AppScreen>
  );
}
