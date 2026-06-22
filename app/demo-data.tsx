import { router } from "expo-router";
import { useEffect, useState } from "react";
import { Alert, Pressable, Text, View } from "react-native";
import { AppScreen } from "../components/layout/AppScreen";
import {
  isDemoScreenshotModeAvailable,
  seedDemoScreenshotData,
} from "../lib/demoData";
import { useAppTheme } from "../lib/useAppTheme";

export default function DemoDataScreen() {
  const { colors } = useAppTheme();
  const [loading, setLoading] = useState(false);
  const demoAvailable = isDemoScreenshotModeAvailable();

  useEffect(() => {
    if (!demoAvailable) {
      router.replace("/settings" as any);
    }
  }, [demoAvailable]);

  if (!demoAvailable) return null;

  async function loadDemoData() {
    if (loading) return;

    setLoading(true);

    try {
      const result = await seedDemoScreenshotData();

      Alert.alert(
        "Demo Data Ready",
        `Loaded ${result.clients} clients, ${result.services} services, and ${result.appointments} appointments across ${result.today} and ${result.tomorrow}.`,
      );
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Could not load screenshot demo data.";

      Alert.alert("Demo Data Error", message);
    } finally {
      setLoading(false);
    }
  }

  function confirmLoadDemoData() {
    Alert.alert(
      "Reset Screenshot Demo Data?",
      "This refreshes sample clients, services, and today's/tomorrow's demo appointments for the signed-in account.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Reset Demo Data",
          onPress: () => {
            void loadDemoData();
          },
        },
      ],
    );
  }

  return (
    <AppScreen scroll backgroundColor={colors.background}>
      <Pressable
        onPress={() => router.back()}
        style={{
          marginBottom: 16,
          alignSelf: "flex-start",
        }}
      >
        <Text style={{ color: colors.primary, fontWeight: "800" }}>Back</Text>
      </Pressable>

      <Text
        style={{
          color: colors.text,
          fontSize: 30,
          fontWeight: "900",
          marginBottom: 12,
        }}
      >
        Demo / Screenshots
      </Text>

      <Text
        style={{
          color: colors.mutedText,
          fontSize: 15,
          lineHeight: 22,
          marginBottom: 20,
        }}
      >
        Load clean sample clients, services, and appointments for App Store and
        Google Play screenshots.
      </Text>

      <View
        style={{
          backgroundColor: colors.card,
          borderWidth: 1,
          borderColor: colors.border,
          borderRadius: 12,
          padding: 16,
          marginBottom: 20,
        }}
      >
        <Text
          style={{
            color: colors.text,
            fontSize: 16,
            fontWeight: "800",
            marginBottom: 8,
          }}
        >
          Included Sample Data
        </Text>
        <Text style={{ color: colors.mutedText, lineHeight: 22 }}>
          Ava Johnson, Mia Carter, Jordan Lee{"\n"}
          Haircut, Beard Trim, Eyebrow Wax, Tattoo Consultation{"\n"}
          Appointments across today and tomorrow, including one multi-service
          appointment.
        </Text>
      </View>

      <Pressable
        disabled={loading}
        onPress={confirmLoadDemoData}
        style={{
          backgroundColor: colors.primary,
          padding: 16,
          borderRadius: 12,
          alignItems: "center",
          opacity: loading ? 0.7 : 1,
        }}
      >
        <Text
          style={{
            color: "#FFFFFF",
            fontSize: 16,
            fontWeight: "900",
          }}
        >
          {loading ? "Loading Demo Data..." : "Reset Demo Data"}
        </Text>
      </Pressable>
    </AppScreen>
  );
}
