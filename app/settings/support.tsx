import Constants from "expo-constants";
import * as Linking from "expo-linking";
import { Alert, Pressable, Text, View } from "react-native";
import { AppScreen } from "../../components/layout/AppScreen";
import { useAppTheme } from "../../lib/useAppTheme";

const SUPPORT_URL =
  "mailto:support@schedova.com?subject=Schedova%20Support%20Request";

export default function SupportScreen() {
  const { colors } = useAppTheme();
  const appVersion = Constants.expoConfig?.version || "1.0.4";

  const contactSupport = () => {
    void Linking.openURL(SUPPORT_URL).catch(() => {
      Alert.alert("Contact Support", SUPPORT_URL);
    });
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
          support@schedova.com
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
