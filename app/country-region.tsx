import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { Alert, Pressable, Text, View } from "react-native";
import { AppScreen } from "../components/layout/AppScreen";
import {
  getUserCountryRegion,
  saveUserCountryRegion,
} from "../lib/countrySettings";
import {
  COUNTRY_REGIONS,
  type CountryRegionCode,
  getCountryRegion,
} from "../lib/phoneNumbers";
import { useAppTheme } from "../lib/useAppTheme";

function nextPath(value: unknown) {
  const path = Array.isArray(value) ? value[0] : value;

  if (
    path === "/dashboard" ||
    path === "/onboarding" ||
    path === "/settings"
  ) {
    return path;
  }

  return "/onboarding";
}

export default function CountryRegionScreen() {
  const router = useRouter();
  const params = useLocalSearchParams();
  const { colors } = useAppTheme();
  const [selectedCountry, setSelectedCountry] =
    useState<CountryRegionCode>("US");
  const [saving, setSaving] = useState(false);
  const fromSettings = params.from === "settings";

  useEffect(() => {
    void getUserCountryRegion().then(setSelectedCountry);
  }, []);

  async function saveAndContinue() {
    if (saving) return;

    setSaving(true);
    try {
      const result = await saveUserCountryRegion(selectedCountry);

      if (!result.savedToDatabase && result.error) {
        Alert.alert(
          "Saved on this device",
          "Schedova saved your country on this device. It may sync after the app database is updated.",
        );
      }

      router.replace(nextPath(fromSettings ? "/settings" : params.next) as any);
    } finally {
      setSaving(false);
    }
  }

  const selectedRegion = getCountryRegion(selectedCountry);

  return (
    <AppScreen scroll backgroundColor={colors.background}>
      <Text
        style={{
          color: colors.text,
          fontSize: 30,
          fontWeight: "900",
          marginBottom: 8,
        }}
      >
        Country / Region
      </Text>

      <Text
        style={{
          color: colors.mutedText,
          fontSize: 16,
          lineHeight: 23,
          marginBottom: 20,
        }}
      >
        Schedova uses this to format local client phone numbers for SMS. You can
        change it later in Settings.
      </Text>

      <View style={{ marginBottom: 20 }}>
        {COUNTRY_REGIONS.map((region) => {
          const selected = region.code === selectedCountry;

          return (
            <Pressable
              key={region.code}
              onPress={() => setSelectedCountry(region.code)}
              style={{
                backgroundColor: selected ? colors.primary : colors.card,
                borderWidth: 1,
                borderColor: selected ? colors.primary : colors.border,
                borderRadius: 14,
                padding: 16,
                marginBottom: 10,
              }}
            >
              <Text
                style={{
                  color: selected ? "#FFFFFF" : colors.text,
                  fontWeight: "900",
                  fontSize: 16,
                }}
              >
                {region.name}
              </Text>
              <Text
                style={{
                  color: selected ? "#E0F2FE" : colors.mutedText,
                  marginTop: 4,
                  fontWeight: "700",
                }}
              >
                {region.callingCode}
              </Text>
            </Pressable>
          );
        })}
      </View>

      <Text
        style={{
          color: colors.mutedText,
          marginBottom: 16,
          lineHeight: 21,
        }}
      >
        Selected: {selectedRegion.name} {selectedRegion.callingCode}
      </Text>

      <Pressable
        disabled={saving}
        onPress={saveAndContinue}
        style={{
          backgroundColor: saving ? colors.mutedText : colors.primary,
          padding: 16,
          borderRadius: 14,
          alignItems: "center",
        }}
      >
        <Text style={{ color: "#FFFFFF", fontWeight: "900" }}>
          {saving ? "Saving..." : fromSettings ? "Save Country" : "Continue"}
        </Text>
      </Pressable>
    </AppScreen>
  );
}
