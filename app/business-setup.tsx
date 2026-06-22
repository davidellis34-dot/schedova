import { useRouter } from "expo-router";
import { useState } from "react";
import { Alert, Text, View } from "react-native";
import {
  AppButton,
  AppCard,
  AppScreen,
  AppTextInput,
  ScreenHeader,
  createSchedovaUiTheme,
} from "../components/ui";
import { useAuthSession } from "../lib/authSession";
import { supabase } from "../lib/supabase";
import { useAppTheme } from "../lib/useAppTheme";

export default function BusinessSetup() {
  const router = useRouter();
  const { colors } = useAppTheme();
  const uiColors = createSchedovaUiTheme(colors).colors;
  const { isHydrated, userId } = useAuthSession();
  const [businessName, setBusinessName] = useState("");
  const [category, setCategory] = useState("");
  const [saving, setSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  async function handleSave() {
    if (saving) return;

    setSaving(true);
    setErrorMessage("");

    try {
      if (!isHydrated) {
        setSaving(false);
        return;
      }

      if (!userId) {
        Alert.alert(
          "Login Required",
          "Please log in before setting up a business.",
        );
        router.replace("/login" as any);
        return;
      }
      if (!businessName.trim()) {
        const message = "Enter your business name.";
        setErrorMessage(message);
        Alert.alert("Missing Info", message);
        return;
      }
      const { error } = await supabase.from("businesses").insert({
        user_id: userId,
        business_name: businessName,
        category,
      });

      if (error) {
        setErrorMessage(error.message);
        Alert.alert("Error", error.message);
        return;
      }

      router.replace("/dashboard" as any);
    } catch (error) {
      console.log("Business setup save failed", error);
      const message = "Business setup could not be saved. Please try again.";
      setErrorMessage(message);
      Alert.alert("Error", message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <AppScreen
      keyboardAware
      backgroundColor={colors.background}
      horizontalPadding={24}
      topPadding={24}
    >
      <ScreenHeader
        title="Set up your business"
        subtitle="Tell Schedova a little about your work so your schedule feels ready from day one."
      />

      <AppCard>
        <Text
          style={{
            color: colors.text,
            fontSize: 20,
            fontWeight: "900",
            marginBottom: 8,
          }}
        >
          Business details
        </Text>
        <Text
          style={{
            color: colors.mutedText,
            lineHeight: 20,
            marginBottom: 18,
          }}
        >
          These details help personalize your appointment book.
        </Text>

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
          label="Business name"
          value={businessName}
          onChangeText={setBusinessName}
          placeholder="Elite Cuts"
        />

        <AppTextInput
          label="Business category"
          helperText="Examples: barber, tattoo artist, nail tech, stylist."
          value={category}
          onChangeText={setCategory}
          placeholder="Barber, Tattoo, Nail Tech..."
          containerStyle={{ marginBottom: 22 }}
        />

        <AppButton
          title="Continue"
          onPress={() => {
            void handleSave();
          }}
          loading={saving}
          disabled={saving}
        />
      </AppCard>
    </AppScreen>
  );
}
