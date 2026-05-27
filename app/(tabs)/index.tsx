import { useRouter } from "expo-router";
import { Pressable, Text } from "react-native";
import { AppScreen } from "../../components/layout/AppScreen";

export default function HomeTab() {
  const router = useRouter();

  return (
    <AppScreen
      backgroundColor="#ffffff"
      horizontalPadding={24}
      topPadding={24}
      contentContainerStyle={{ justifyContent: "center" }}
    >
      <Text
        style={{
          fontSize: 34,
          fontWeight: "bold",
          textAlign: "center",
          marginBottom: 10,
        }}
      >
        Schedova
      </Text>

      <Text
        style={{
          fontSize: 16,
          color: "#555555",
          textAlign: "center",
          marginBottom: 30,
        }}
      >
        Book clients, manage services, and keep your day organized.
      </Text>

      <Pressable
        onPress={() => router.replace("/dashboard" as any)}
        style={{
          backgroundColor: "#0F766E",
          padding: 16,
          borderRadius: 14,
          alignItems: "center",
        }}
      >
        <Text style={{ color: "#ffffff", fontWeight: "bold", fontSize: 16 }}>
          Open Dashboard
        </Text>
      </Pressable>
    </AppScreen>
  );
}
