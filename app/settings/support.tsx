import Constants from "expo-constants";
import { Pressable, Text, View } from "react-native";
import { AppScreen } from "../../components/layout/AppScreen";
import { SUPPORT_EMAIL, openSupportEmail } from "../../lib/legalLinks";
import { useAppTheme } from "../../lib/useAppTheme";

export default function SupportScreen() {
  const { colors } = useAppTheme();
  const appVersion = Constants.expoConfig?.version || "1.0.4";

  const contactSupport = () => {
    void openSupportEmail();
  };

  return (
    <AppScreen backgroundColor={colors.background}>
      <Text
        style={{
          fontSize: 30,
          fontWeight: "bold",
          marginBottom: 24,
          color: colors.text,
        }}
      >
        Help & Support
      </Text>

      <Pressable
        onPress={contactSupport}
        style={{
          backgroundColor: colors.primary,
          padding: 16,
          borderRadius: 12,
          marginBottom: 16,
          alignItems: "center",
        }}
      >
        <Text
          style={{
            color: "#FFFFFF",
            fontSize: 16,
            fontWeight: "600",
          }}
        >
          Contact Support
        </Text>
      </Pressable>

      <View
        style={{
          backgroundColor: colors.card,
          borderRadius: 14,
          padding: 16,
          borderWidth: 1,
          borderColor: colors.border,
        }}
      >
        <Text
          style={{
            fontSize: 16,
            color: colors.text,
            marginBottom: 8,
          }}
        >
          {SUPPORT_EMAIL}
        </Text>

        <Text
          style={{
            fontSize: 14,
            color: colors.mutedText,
          }}
        >
          App Version: {appVersion}
        </Text>
      </View>
    </AppScreen>
  );
}
