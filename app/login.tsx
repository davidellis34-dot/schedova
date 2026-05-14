import { useRouter } from "expo-router";
import { useState } from "react";
import { Alert, Pressable, Text, TextInput, View } from "react-native";
import { supabase } from "../lib/supabase";

export default function LoginScreen() {
  const router = useRouter();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  async function signUp() {
    const { error } = await supabase.auth.signUp({
      email,
      password,
    });

    if (error) {
      Alert.alert("Sign Up Error", error.message);
      return;
    }

    Alert.alert("Account Created", "You can now log in.");
  }

  async function login() {
    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      Alert.alert("Login Error", error.message);
      return;
    }

    router.replace("/dashboard" as any);
  }

  function SocialButton({ title, color }: { title: string; color: string }) {
    return (
      <Pressable
        onPress={() =>
          Alert.alert("Coming Soon", `${title} needs provider setup first.`)
        }
        style={{
          backgroundColor: color,
          padding: 15,
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
          {title}
        </Text>
      </Pressable>
    );
  }

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
        Sign in to manage your schedule.
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
          marginBottom: 22,
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

      <Text
        style={{
          textAlign: "center",
          color: "#777777",
          marginBottom: 14,
        }}
      >
        Or continue with
      </Text>

      <SocialButton title="Continue with Google" color="#DB4437" />

      <SocialButton title="Continue with Apple" color="#111111" />

      <SocialButton title="Continue with Facebook" color="#1877F2" />
    </View>
  );
}
