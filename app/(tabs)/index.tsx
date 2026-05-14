import { useRouter } from "expo-router";
import { Pressable, Text, View } from "react-native";

export default function HomeTab() {
  const router = useRouter();

  return (
    <View
      style={{
        flex: 1,
        backgroundColor: "#ffffff",
        padding: 24,
        justifyContent: "center",
      }}
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
        Smart scheduling for service businesses.
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
    </View>
  );
}
