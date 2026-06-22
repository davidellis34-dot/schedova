import { useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { AppScreen } from "../components/layout/AppScreen";
import { markOnboardingComplete } from "../lib/onboarding";
import { useAppTheme } from "../lib/useAppTheme";

const STEPS = [
  {
    title: "Welcome to Schedova",
    body: "Book clients, manage services, and keep your day organized.",
  },
  {
    title: "Set up your services",
    body: "Add your services with prices and estimated durations.",
  },
  {
    title: "Book appointments faster",
    body: "Choose a client, select one or more services, and adjust the appointment time.",
  },
  {
    title: "Stay organized",
    body: "View your calendar, client details, and upcoming appointments in one place.",
  },
] as const;

export default function OnboardingScreen() {
  const router = useRouter();
  const params = useLocalSearchParams();
  const { colors } = useAppTheme();
  const [index, setIndex] = useState(0);

  const step = STEPS[index];
  const isLastStep = index === STEPS.length - 1;
  const returnToSettings = params.from === "settings";

  async function finish() {
    await markOnboardingComplete();
    router.replace(returnToSettings ? "/settings" : "/dashboard");
  }

  async function skip() {
    await finish();
  }

  return (
    <AppScreen
      backgroundColor={colors.background}
      horizontalPadding={24}
      contentContainerStyle={{ justifyContent: "space-between" }}
    >
      <View style={{ alignItems: "flex-end" }}>
        <Pressable onPress={skip} hitSlop={10}>
          <Text style={{ color: colors.mutedText, fontWeight: "800" }}>
            Skip
          </Text>
        </Pressable>
      </View>

      <View>
        <View
          style={{
            width: 64,
            height: 64,
            borderRadius: 18,
            backgroundColor: colors.primary,
            alignItems: "center",
            justifyContent: "center",
            marginBottom: 28,
          }}
        >
          <Text style={{ color: "#FFFFFF", fontSize: 28, fontWeight: "900" }}>
            {index + 1}
          </Text>
        </View>

        <Text
          style={{
            color: colors.text,
            fontSize: 34,
            lineHeight: 40,
            fontWeight: "900",
            marginBottom: 14,
          }}
        >
          {step.title}
        </Text>

        <Text
          style={{
            color: colors.mutedText,
            fontSize: 17,
            lineHeight: 25,
          }}
        >
          {step.body}
        </Text>
      </View>

      <View>
        <View
          style={{
            flexDirection: "row",
            justifyContent: "center",
            gap: 8,
            marginBottom: 24,
          }}
        >
          {STEPS.map((item, stepIndex) => (
            <View
              key={item.title}
              style={{
                width: stepIndex === index ? 24 : 8,
                height: 8,
                borderRadius: 999,
                backgroundColor:
                  stepIndex === index ? colors.primary : colors.border,
              }}
            />
          ))}
        </View>

        <Pressable
          onPress={() => {
            if (isLastStep) {
              void finish();
              return;
            }

            setIndex((current) => current + 1);
          }}
          style={{
            backgroundColor: colors.primary,
            padding: 16,
            borderRadius: 16,
            alignItems: "center",
          }}
        >
          <Text style={{ color: "#FFFFFF", fontWeight: "900", fontSize: 16 }}>
            {isLastStep ? "Start using Schedova" : "Continue"}
          </Text>
        </Pressable>
      </View>
    </AppScreen>
  );
}
