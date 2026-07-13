import { useRouter } from "expo-router";
import { Pressable, Text } from "react-native";
import { AppScreen } from "../components/layout/AppScreen";

export default function NotFoundScreen() {
  const router = useRouter();

  return (
    <AppScreen
      backgroundColor="#FFFFFF"
      horizontalPadding={24}
      contentContainerStyle={{
        justifyContent: "center",
      }}
    >
      <Text
        style={{
          color: "#111827",
          fontSize: 34,
          fontWeight: "900",
          marginBottom: 12,
          textAlign: "center",
        }}
      >
        Page not found
      </Text>

      <Text
        style={{
          color: "#4B5563",
          fontSize: 16,
          lineHeight: 24,
          marginBottom: 28,
          textAlign: "center",
        }}
      >
        This Schedova page may have moved or the link may be incomplete.
      </Text>

      <Pressable
        onPress={() => router.replace("/")}
        style={{
          backgroundColor: "#0F766E",
          padding: 16,
          borderRadius: 14,
          alignItems: "center",
        }}
      >
        <Text style={{ color: "#FFFFFF", fontWeight: "900" }}>
          Go to Home
        </Text>
      </Pressable>
    </AppScreen>
  );
}
