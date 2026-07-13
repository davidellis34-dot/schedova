import { useRouter } from "expo-router";
import { Pressable, Text, View } from "react-native";
import { AppScreen } from "../components/layout/AppScreen";
import { SUPPORT_EMAIL, openSupportEmail } from "../lib/legalLinks";
import { ENABLE_PRO } from "../lib/proFeatureFlag";

const SECTIONS = [
  {
    title: "Use of Schedova",
    body: "Schedova helps service providers manage clients, services, appointments, reminders, and related business details. You are responsible for the information you enter and for using the app lawfully.",
  },
  {
    title: "Client communications",
    body: "Only contact clients when you have permission to do so. If you use SMS or reminder features, you are responsible for honoring client consent and opt-out requests.",
  },
  ...(ENABLE_PRO
    ? [
        {
          title: "Subscriptions and Pro features",
          body: "Schedova may show Pro features that are locked or manually enabled during testing. Paid subscriptions are not active in this build unless a store-approved purchase flow is separately configured.",
        },
      ]
    : []),
  {
    title: "No professional advice",
    body: "Schedova provides scheduling and business organization tools. It does not provide legal, financial, tax, medical, or other professional advice.",
  },
  {
    title: "Support",
    body: `Questions about these terms can be sent to ${SUPPORT_EMAIL}.`,
  },
] as const;

export default function TermsScreen() {
  const router = useRouter();

  return (
    <AppScreen scroll backgroundColor="#FFFFFF" horizontalPadding={24}>
      <Pressable
        onPress={() => router.replace("/")}
        hitSlop={10}
        style={{ alignSelf: "flex-start", marginBottom: 24 }}
      >
        <Text style={{ color: "#0F766E", fontWeight: "800" }}>
          Schedova Home
        </Text>
      </Pressable>

      <Text
        style={{
          color: "#111827",
          fontSize: 34,
          fontWeight: "900",
          marginBottom: 8,
        }}
      >
        Terms of Use
      </Text>

      <Text
        style={{
          color: "#6B7280",
          fontSize: 14,
          marginBottom: 24,
        }}
      >
        Last updated: May 28, 2026
      </Text>

      {SECTIONS.map((section) => (
        <View key={section.title} style={{ marginBottom: 22 }}>
          <Text
            style={{
              color: "#111827",
              fontSize: 20,
              fontWeight: "900",
              marginBottom: 8,
            }}
          >
            {section.title}
          </Text>
          <Text style={{ color: "#374151", fontSize: 16, lineHeight: 24 }}>
            {section.body}
          </Text>
        </View>
      ))}

      <Pressable
        onPress={() => {
          void openSupportEmail();
        }}
        style={{
          backgroundColor: "#0F766E",
          padding: 16,
          borderRadius: 14,
          alignItems: "center",
          marginTop: 8,
          marginBottom: 24,
        }}
      >
        <Text style={{ color: "#FFFFFF", fontWeight: "900" }}>
          Contact Support
        </Text>
      </Pressable>
    </AppScreen>
  );
}
