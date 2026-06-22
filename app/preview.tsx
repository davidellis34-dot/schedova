import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { Pressable, Text, View } from "react-native";
import {
  AppButton,
  AppCard,
  AppScreen,
  ScreenHeader,
  createSchedovaUiTheme,
} from "../components/ui";
import {
  PRIVACY_POLICY_URL,
  SUPPORT_EMAIL,
  TERMS_OF_USE_URL,
  openExternalWebsite,
  openSupportEmail,
} from "../lib/legalLinks";
import { ENABLE_PRO } from "../lib/proFeatureFlag";
import { useAppTheme } from "../lib/useAppTheme";

const LOGIN_REQUIRED_MESSAGE =
  "Create a free account to save clients, services, and appointments.";

const OVERVIEW_ITEMS = [
  {
    title: "Organize your booking day",
    body: "Schedova helps service providers keep clients, services, appointment notes, and schedule changes in one calm workspace.",
    icon: "calendar-outline",
  },
  {
    title: "Simple workflow",
    body: "Add a client, create services with prices and durations, book an appointment, then use the calendar and client details to stay on track.",
    icon: "git-branch-outline",
  },
  {
    title: "Designed for solo operators",
    body: "The app is built for practical day-to-day scheduling, not a social feed or marketplace.",
    icon: "briefcase-outline",
  },
] as const;

const PRO_ITEMS = [
  "More booking capacity for growing businesses",
  "SMS appointment message tools where supported",
  "Reports, client history, blocked time, and vacation blocks",
  "Restore and manage subscriptions through your Apple account",
] as const;

export default function PreviewScreen() {
  const router = useRouter();
  const { colors: appColors, themeName } = useAppTheme();
  const theme = createSchedovaUiTheme(appColors);
  const { colors } = theme;
  const isDarkTheme = themeName === "dark" || themeName === "black";
  const infoAccent = isDarkTheme ? "#60A5FA" : "#2563EB";
  const infoAccentSoft = isDarkTheme
    ? "rgba(96, 165, 250, 0.16)"
    : "rgba(37, 99, 235, 0.10)";
  const polishedBorder = isDarkTheme
    ? "rgba(148, 163, 184, 0.28)"
    : "rgba(15, 23, 42, 0.12)";

  function openLogin(mode: "signin" | "signup" = "signup") {
    router.push({
      pathname: "/login",
      params: {
        mode,
        previewMessage: LOGIN_REQUIRED_MESSAGE,
      },
    } as any);
  }

  return (
    <AppScreen
      scroll
      backgroundColor={colors.background}
      horizontalPadding={22}
      bottomPadding={44}
    >
      <Pressable
        accessibilityRole="button"
        onPress={() => router.back()}
        hitSlop={10}
        style={{ alignSelf: "flex-start", marginBottom: 12 }}
      >
        <Text style={{ color: colors.mutedText, fontWeight: "900" }}>Back</Text>
      </Pressable>

      <ScreenHeader
        title="Preview Schedova"
        subtitle="Explore what Schedova does before creating an account."
      />

      <AppCard
        style={{
          borderColor: polishedBorder,
          borderLeftWidth: 4,
          borderLeftColor: colors.primary,
          marginBottom: 16,
        }}
      >
        <Text
          style={{
            color: colors.text,
            fontSize: 20,
            fontWeight: "900",
            marginBottom: 8,
          }}
        >
          What Schedova Does
        </Text>
        <Text style={{ color: colors.mutedText, fontSize: 15, lineHeight: 22 }}>
          Schedova is a booking and client organization app for service
          providers. Preview mode shows product information only. Creating
          clients, services, appointments, and synced business data requires an
          account.
        </Text>
      </AppCard>

      <View style={{ gap: 12, marginBottom: 16 }}>
        {OVERVIEW_ITEMS.map((item) => (
          <AppCard
            key={item.title}
            style={{ borderColor: polishedBorder, padding: 16 }}
          >
            <View style={{ flexDirection: "row", gap: 12 }}>
              <View
                style={{
                  width: 38,
                  height: 38,
                  borderRadius: 19,
                  alignItems: "center",
                  justifyContent: "center",
                  backgroundColor: infoAccentSoft,
                }}
              >
                <Ionicons name={item.icon} size={19} color={infoAccent} />
              </View>
              <View style={{ flex: 1 }}>
                <Text
                  style={{
                    color: colors.text,
                    fontSize: 16,
                    fontWeight: "900",
                  }}
                >
                  {item.title}
                </Text>
                <Text
                  style={{
                    color: colors.mutedText,
                    fontSize: 14,
                    lineHeight: 20,
                    marginTop: 4,
                  }}
                >
                  {item.body}
                </Text>
              </View>
            </View>
          </AppCard>
        ))}
      </View>

      {ENABLE_PRO ? (
        <AppCard
          style={{
            borderColor: polishedBorder,
            borderLeftWidth: 4,
            borderLeftColor: infoAccent,
            marginBottom: 16,
          }}
        >
          <Text
            style={{
              color: colors.text,
              fontSize: 20,
              fontWeight: "900",
              marginBottom: 8,
            }}
          >
            Schedova Pro
          </Text>
          <Text
            style={{ color: colors.mutedText, fontSize: 15, lineHeight: 22 }}
          >
            Schedova includes a free account experience and optional Pro
            subscription features for advanced booking tools. Subscription
            pricing and purchase controls are shown only after sign in.
          </Text>

          <View style={{ marginTop: 14, gap: 9 }}>
            {PRO_ITEMS.map((item) => (
              <View key={item} style={{ flexDirection: "row", gap: 8 }}>
                <Ionicons
                  name="checkmark-circle-outline"
                  size={18}
                  color={colors.primary}
                />
                <Text style={{ color: colors.text, flex: 1, lineHeight: 20 }}>
                  {item}
                </Text>
              </View>
            ))}
          </View>
        </AppCard>
      ) : null}

      <AppCard
        style={{
          borderColor: polishedBorder,
          backgroundColor: infoAccentSoft,
          marginBottom: 16,
        }}
      >
        <Text style={{ color: colors.text, fontSize: 18, fontWeight: "900" }}>
          Ready to try it with your own data?
        </Text>
        <Text
          style={{
            color: colors.mutedText,
            fontSize: 14,
            lineHeight: 20,
            marginTop: 6,
            marginBottom: 14,
          }}
        >
          {LOGIN_REQUIRED_MESSAGE}
        </Text>
        <AppButton title="Create Free Account" onPress={() => openLogin()} />
        <AppButton
          title="Sign In"
          variant="ghost"
          onPress={() => openLogin("signin")}
          style={{ marginTop: 8 }}
        />
      </AppCard>

      <View
        style={{
          flexDirection: "row",
          flexWrap: "wrap",
          justifyContent: "center",
          gap: 14,
          marginTop: 4,
        }}
      >
        <Pressable
          accessibilityRole="link"
          onPress={() => {
            void openExternalWebsite("Privacy Policy", PRIVACY_POLICY_URL);
          }}
          hitSlop={8}
        >
          <Text style={{ color: colors.primary, fontWeight: "900" }}>
            Privacy Policy
          </Text>
        </Pressable>
        <Pressable
          accessibilityRole="link"
          onPress={() => {
            void openExternalWebsite("Terms of Use", TERMS_OF_USE_URL);
          }}
          hitSlop={8}
        >
          <Text style={{ color: colors.primary, fontWeight: "900" }}>
            Terms of Use
          </Text>
        </Pressable>
        <Pressable
          accessibilityRole="link"
          onPress={() => {
            void openSupportEmail();
          }}
          hitSlop={8}
        >
          <Text style={{ color: colors.primary, fontWeight: "900" }}>
            Contact Support
          </Text>
        </Pressable>
      </View>

      <Text
        style={{
          color: colors.mutedText,
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
