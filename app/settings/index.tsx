import { router } from "expo-router";
import { Alert, Pressable, ScrollView, Text, View } from "react-native";
import {
  canUseFeature,
  PRO_FEATURE_PREVIEWS,
} from "../../lib/featureAccess";
import { supabase } from "../../lib/supabase";
import { useAppTheme } from "../../lib/useAppTheme";

export default function SettingsScreen() {
  const { colors } = useAppTheme();

  async function switchAccount() {
    const { error } = await supabase.auth.signOut();

    if (error) {
      Alert.alert("Sign Out Error", error.message);
      return;
    }

    router.replace("/login");
  }

  const buttonStyle = {
    backgroundColor: colors.card,
    padding: 16,
    borderRadius: 12,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: colors.border,
  };

  const textStyle = {
    fontSize: 16,
    fontWeight: "600" as const,
    color: colors.text,
  };

  const proLocked = !canUseFeature("reports");

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.background }}
      contentContainerStyle={{ padding: 20, paddingBottom: 40 }}
    >
      <Text
        style={{
          fontSize: 30,
          fontWeight: "bold",
          marginBottom: 24,
          color: colors.text,
        }}
      >
        Settings
      </Text>

      <Pressable
        onPress={() => router.push("/settings/calendar")}
        style={buttonStyle}
      >
        <Text style={textStyle}>Calendar Settings</Text>
      </Pressable>

      <Pressable
        onPress={() => router.push("/settings/display")}
        style={buttonStyle}
      >
        <Text style={textStyle}>Display & Theme</Text>
      </Pressable>

      <Pressable onPress={() => router.push("/settings/sms")} style={buttonStyle}>
        <Text style={textStyle}>SMS Settings</Text>
      </Pressable>

      <Pressable
        onPress={() => router.push("/settings/message-templates")}
        style={buttonStyle}
      >
        <Text style={textStyle}>Message Templates</Text>
      </Pressable>

      <Pressable
        onPress={() => router.push("/availability-settings")}
        style={buttonStyle}
      >
        <Text style={textStyle}>Availability Settings - Pro</Text>
      </Pressable>

      <Pressable
        onPress={() => router.push("/settings/support")}
        style={buttonStyle}
      >
        <Text style={textStyle}>Help & Support</Text>
      </Pressable>
      <Pressable onPress={() => router.push("/reports")} style={buttonStyle}>
        <Text style={textStyle}>Reports - Pro</Text>
      </Pressable>

      <View
        style={{
          marginTop: 12,
          marginBottom: 20,
        }}
      >
        <Text
          style={{
            color: colors.text,
            fontSize: 24,
            fontWeight: "900",
            marginBottom: 12,
          }}
        >
          Schedova Pro
        </Text>

        {PRO_FEATURE_PREVIEWS.map((feature) => (
          <View
            key={feature}
            style={{
              backgroundColor: colors.card,
              borderWidth: 1,
              borderColor: colors.border,
              borderRadius: 12,
              padding: 14,
              marginBottom: 10,
            }}
          >
            <Text
              style={{
                color: colors.text,
                fontSize: 15,
                fontWeight: "800",
                marginBottom: 10,
              }}
            >
              {feature}
            </Text>

            <View style={{ flexDirection: "row", gap: 8 }}>
              <View
                style={{
                  backgroundColor: colors.primary,
                  borderRadius: 999,
                  paddingHorizontal: 10,
                  paddingVertical: 4,
                }}
              >
                <Text
                  style={{
                    color: "#FFFFFF",
                    fontSize: 12,
                    fontWeight: "900",
                  }}
                >
                  Pro
                </Text>
              </View>

              {proLocked ? (
                <View
                  style={{
                    borderWidth: 1,
                    borderColor: colors.border,
                    borderRadius: 999,
                    paddingHorizontal: 10,
                    paddingVertical: 4,
                  }}
                >
                  <Text
                    style={{
                      color: colors.text,
                      fontSize: 12,
                      fontWeight: "800",
                    }}
                  >
                    Coming soon
                  </Text>
                </View>
              ) : null}
            </View>
          </View>
        ))}
      </View>

      <Pressable onPress={switchAccount} style={buttonStyle}>
        <Text style={textStyle}>Switch / Sign Out</Text>
      </Pressable>
      <Text
        style={{
          color: colors.mutedText,
          fontSize: 13,
          marginTop: -4,
        }}
      >
        Sign out to use a different account.
      </Text>
    </ScrollView>
  );
}
