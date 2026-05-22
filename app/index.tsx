import { useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import { supabase } from "../lib/supabase";

export default function SplashScreen() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    checkSession();
  }, []);

  async function checkSession() {
    const response = await supabase.auth.getSession();

    const session = response.data.session;

    if (session) {
      router.replace("/dashboard" as any);
    } else {
      setLoading(false);
    }
  }

  if (loading) {
    return (
      <View
        style={{
          flex: 1,
          backgroundColor: "#0F766E",
          justifyContent: "center",
          alignItems: "center",
        }}
      >
        <ActivityIndicator size="large" color="#ffffff" />

        <Text
          style={{
            color: "#ffffff",
            fontSize: 28,
            fontWeight: "bold",
            marginTop: 18,
          }}
        >
          Schedova
        </Text>
      </View>
    );
  }

  return (
    <View
      style={{
        flex: 1,
        backgroundColor: "#ffffff",
        padding: 28,
        justifyContent: "center",
      }}
    >
      <Text
        style={{
          fontSize: 44,
          fontWeight: "bold",
          textAlign: "center",
          color: "#111111",
          marginBottom: 12,
        }}
      >
        Schedova
      </Text>

      <Text
        style={{
          fontSize: 17,
          color: "#555555",
          textAlign: "center",
          marginBottom: 46,
        }}
      >
        Smart scheduling for service businesses.
      </Text>

      <Pressable
        onPress={() => router.replace("/login" as any)}
        style={{
          backgroundColor: "#0F766E",
          paddingVertical: 18,
          borderRadius: 18,
          alignItems: "center",
          shadowColor: "#0F766E",
          shadowOffset: {
            width: 0,
            height: 6,
          },
          shadowOpacity: 0.35,
          shadowRadius: 10,
          elevation: 10,
          marginBottom: 16,
        }}
      >
        <Text
          style={{
            color: "#ffffff",
            fontSize: 17,
            fontWeight: "bold",
          }}
        >
          Login / Create Account
        </Text>
      </Pressable>
    </View>
  );
}
