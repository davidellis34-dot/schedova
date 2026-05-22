import * as Linking from "expo-linking";
import { Pressable, Text, View } from "react-native";
import { useAppTheme } from "../../lib/useAppTheme";

export default function SupportScreen() {
  const { colors } = useAppTheme();

  const contactSupport = () => {
    Linking.openURL("mailto:support@schedova.com?subject=Schedova Support");
  };

  return (
    <View
      style={{
        flex: 1,
        backgroundColor: colors.background,
        padding: 20,
      }}
    >
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
          App Version: 1.0.0
        </Text>
      </View>
    </View>
  );
}
