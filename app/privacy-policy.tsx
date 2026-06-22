import { useRouter } from "expo-router";
import { Pressable, Text, View } from "react-native";
import { AppScreen } from "../components/layout/AppScreen";
import { SUPPORT_EMAIL, openSupportEmail } from "../lib/legalLinks";

const SECTIONS = [
  {
    title: "Information we collect",
    body: "Schedova may collect account information such as your name, email address, login details, and basic business setup information. When you use the app, you may enter client information such as client names, phone numbers, email addresses, notes, appointment details, selected services, prices, and service durations.",
  },
  {
    title: "Service and appointment data",
    body: "Schedova stores the services, calendar entries, appointments, availability settings, message templates, and related details you create so the app can help you manage your day and book clients.",
  },
  {
    title: "Communications and SMS",
    body: "If you use SMS or communication features, Schedova may store message templates, opt-in or communication preferences, and appointment-related details needed to prepare or send those messages. Clients should only be contacted when you have permission to do so.",
  },
  {
    title: "How we use information",
    body: "We use information to provide, secure, maintain, and improve Schedova, including authentication, scheduling, client management, service management, support, troubleshooting, and product quality improvements. We do not sell personal data.",
  },
  {
    title: "Service providers",
    body: "Schedova uses Supabase for backend services, including authentication, database storage, and related infrastructure. Data may be processed by Supabase and other service providers only as needed to operate Schedova.",
  },
  {
    title: "Security",
    body: "We use reasonable technical and organizational safeguards designed to protect account, client, service, and appointment data. No method of transmission or storage is completely secure, so we cannot guarantee absolute security.",
  },
  {
    title: "Account and data deletion",
    body: `You can request account or data deletion by contacting ${SUPPORT_EMAIL}. We may need to verify your request before deleting data associated with your account.`,
  },
  {
    title: "Contact",
    body: `Questions about this Privacy Policy or Schedova privacy practices can be sent to ${SUPPORT_EMAIL}.`,
  },
] as const;

export default function PrivacyPolicyScreen() {
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
        Privacy Policy
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

      <Text
        style={{
          color: "#374151",
          fontSize: 16,
          lineHeight: 24,
          marginBottom: 24,
        }}
      >
        Schedova helps solo service providers book clients, manage services,
        and keep their day organized. This Privacy Policy explains what
        information Schedova collects, how it is used, and how to contact us.
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
