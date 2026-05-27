import { useRouter } from "expo-router";
import { useState } from "react";
import { Alert, Pressable, Text, TextInput } from "react-native";
import { AppScreen } from "../components/layout/AppScreen";
import { supabase } from "../lib/supabase";

export default function BusinessSetup() {
  const router = useRouter();
  const [businessName, setBusinessName] = useState("");
  const [category, setCategory] = useState("");

  async function handleSave() {
    const { data: userData } = await supabase.auth.getUser();
    const userId = userData.user?.id;

    if (!userId) {
      Alert.alert(
        "Login Required",
        "Please log in before setting up a business.",
      );
      router.replace("/login" as any);
      return;
    }
    if (!businessName.trim()) {
      Alert.alert("Missing Info", "Enter your business name.");
      return;
    }
    const { error } = await supabase.from("businesses").insert({
      user_id: userId,
      business_name: businessName,
      category,
    });

    if (error) {
      Alert.alert("Error", error.message);
      return;
    }

    router.replace("/dashboard" as any);
  }

  return (
    <AppScreen
      keyboardAware
      backgroundColor="#ffffff"
      horizontalPadding={24}
      topPadding={24}
    >
      <Text style={{ fontSize: 28, fontWeight: "bold", marginBottom: 24 }}>
        Set up your business
      </Text>

      <Text>Business Name</Text>
      <TextInput
        value={businessName}
        onChangeText={setBusinessName}
        placeholder="Elite Cuts"
        style={{
          borderWidth: 1,
          borderColor: "#cccccc",
          borderRadius: 10,
          padding: 14,
          marginBottom: 20,
        }}
      />

      <Text>Business Category</Text>
      <TextInput
        value={category}
        onChangeText={setCategory}
        placeholder="Barber, Tattoo, Nail Tech..."
        style={{
          borderWidth: 1,
          borderColor: "#cccccc",
          borderRadius: 10,
          padding: 14,
          marginBottom: 30,
        }}
      />

      <Pressable
        onPress={handleSave}
        style={{
          backgroundColor: "#111111",
          padding: 16,
          borderRadius: 10,
          alignItems: "center",
        }}
      >
        <Text style={{ color: "#ffffff", fontSize: 16, fontWeight: "bold" }}>
          Save Business
        </Text>
      </Pressable>
    </AppScreen>
  );
}
