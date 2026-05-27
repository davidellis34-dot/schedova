import { useRouter } from "expo-router";
import { useState } from "react";
import { Alert, Pressable, Text, TextInput } from "react-native";
import { AppScreen } from "../components/layout/AppScreen";
import { refreshFeatureAccess } from "../lib/featureAccess";
import { supabase } from "../lib/supabase";

export default function LoginScreen() {
  const router = useRouter();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  async function signUp() {
    if (!email || !password) {
      Alert.alert("Missing Info", "Enter email and password.");
      return;
    }

    const { error } = await supabase.auth.signUp({
      email,
      password,
    });

    if (error) {
      Alert.alert("Sign Up Error", error.message);
      return;
    }

    Alert.alert("Account Created", "Check your email to confirm your account.");
  }

  async function login() {
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      Alert.alert("Login Error", error.message);
      return;
    }

    await refreshFeatureAccess(data.user?.id, "login");
    router.replace("/dashboard" as any);
  }

  return (
    <AppScreen
      keyboardAware
      backgroundColor="#ffffff"
      horizontalPadding={24}
      topPadding={24}
      contentContainerStyle={{ justifyContent: "center" }}
    >
      <Text
        style={{
          fontSize: 36,
          fontWeight: "bold",
          marginBottom: 8,
        }}
      >
        Schedova
      </Text>

      <Text
        style={{
          fontSize: 16,
          color: "#555555",
          marginBottom: 24,
        }}
      >
        Sign up or log in with your email to manage your schedule.
      </Text>

      <Text>Email</Text>

      <TextInput
        value={email}
        onChangeText={setEmail}
        autoCapitalize="none"
        keyboardType="email-address"
        placeholder="you@example.com"
        style={{
          borderWidth: 1,
          borderColor: "#ccc",
          borderRadius: 10,
          padding: 14,
          marginBottom: 16,
          color: "#111111",
          backgroundColor: "#FFFFFF",
        }}
      />

      <Text>Password</Text>

      <TextInput
        value={password}
        onChangeText={setPassword}
        secureTextEntry
        placeholder="Password"
        style={{
          borderWidth: 1,
          borderColor: "#ccc",
          borderRadius: 10,
          padding: 14,
          marginBottom: 20,
          color: "#111111",
          backgroundColor: "#FFFFFF",
        }}
      />

      <Pressable
        onPress={login}
        style={{
          backgroundColor: "#111111",
          padding: 16,
          borderRadius: 12,
          alignItems: "center",
          marginBottom: 12,
        }}
      >
        <Text
          style={{
            color: "#ffffff",
            fontWeight: "bold",
          }}
        >
          Log In
        </Text>
      </Pressable>

      <Pressable
        onPress={signUp}
        style={{
          backgroundColor: "#2563EB",
          padding: 16,
          borderRadius: 12,
          alignItems: "center",
        }}
      >
        <Text
          style={{
            color: "#ffffff",
            fontWeight: "bold",
          }}
        >
          Create Account
        </Text>
      </Pressable>
    </AppScreen>
  );
}
