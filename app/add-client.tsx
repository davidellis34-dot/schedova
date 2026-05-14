import { useRouter } from "expo-router";
import { useState } from "react";
import { Alert, Pressable, ScrollView, Text, TextInput } from "react-native";
import { supabase } from "../lib/supabase";
import { useAppTheme } from "../lib/useAppTheme";
export default function AddClientScreen() {
  const router = useRouter();
  const { colors } = useAppTheme();
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [notes, setNotes] = useState("");
  const [birthday, setBirthday] = useState("");
  const [rebookingWeeks, setRebookingWeeks] = useState("6");

  async function saveClient() {
    if (!name.trim()) {
      Alert.alert("Missing Name", "Please enter a client name.");
      return;
    }

    const { data: userData } = await supabase.auth.getUser();

    const userId = userData.user?.id;

    if (!userId) {
      Alert.alert("Error", "You must be logged in.");
      return;
    }

    const { error } = await supabase.from("clients").insert({
      user_id: userId,
      name,
      phone,
      email,
      notes,
      birthday: birthday || null,
      rebooking_weeks: Number(rebookingWeeks || 6),
    });

    if (error) {
      Alert.alert("Error", error.message);
      return;
    }

    Alert.alert("Success", "Client added.");

    router.back();
  }

  return (
    <ScrollView
      style={{
        flex: 1,
        backgroundColor: colors.card,
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
        Add Client
      </Text>

      <Text style={{ color: colors.text, marginBottom: 6 }}>Client Name</Text>

      <TextInput
        value={name}
        onChangeText={setName}
        placeholder="Client name"
        placeholderTextColor="#888888"
        style={{
          borderWidth: 1,
          borderColor: colors.border,
          borderRadius: 12,
          padding: 14,
          marginBottom: 16,
          color: colors.text,
        }}
      />

      <Text style={{ color: colors.text, marginBottom: 6 }}>Phone Number</Text>

      <TextInput
        value={phone}
        onChangeText={setPhone}
        keyboardType="phone-pad"
        placeholder="Phone number"
        placeholderTextColor="#888888"
        style={{
          borderWidth: 1,
          borderColor: colors.border,
          borderRadius: 12,
          padding: 14,
          marginBottom: 16,
          color: colors.text,
        }}
      />

      <Text style={{ color: colors.text, marginBottom: 6 }}>Email</Text>

      <TextInput
        value={email}
        onChangeText={setEmail}
        keyboardType="email-address"
        placeholder="Email"
        placeholderTextColor="#888888"
        style={{
          borderWidth: 1,
          borderColor: colors.border,
          borderRadius: 12,
          padding: 14,
          marginBottom: 16,
          color: colors.text,
        }}
      />

      <Text style={{ color: colors.text, marginBottom: 6 }}>Birthday</Text>

      <TextInput
        value={birthday}
        onChangeText={setBirthday}
        placeholder="YYYY-MM-DD"
        placeholderTextColor="#888888"
        style={{
          borderWidth: 1,
          borderColor: colors.border,
          borderRadius: 12,
          padding: 14,
          marginBottom: 16,
          color: colors.text,
        }}
      />

      <Text style={{ color: colors.text, marginBottom: 6 }}>
        Rebooking Weeks
      </Text>

      <TextInput
        value={rebookingWeeks}
        onChangeText={setRebookingWeeks}
        keyboardType="numeric"
        placeholder="6"
        placeholderTextColor="#888888"
        style={{
          borderWidth: 1,
          borderColor: colors.border,
          borderRadius: 12,
          padding: 14,
          marginBottom: 16,
          color: colors.text,
        }}
      />

      <Text style={{ color: colors.text, marginBottom: 6 }}>Client Notes</Text>

      <TextInput
        value={notes}
        onChangeText={setNotes}
        multiline
        placeholder="Client preferences, allergies, etc..."
        placeholderTextColor="#888888"
        style={{
          borderWidth: 1,
          borderColor: colors.border,
          borderRadius: 12,
          padding: 14,
          minHeight: 120,
          textAlignVertical: "top",
          marginBottom: 24,
          color: colors.text,
        }}
      />

      <Pressable
        onPress={saveClient}
        style={{
          backgroundColor: colors.primary,
          padding: 16,
          borderRadius: 14,
          alignItems: "center",
          marginBottom: 40,
        }}
      >
        <Text
          style={{
            color: colors.text,
            fontWeight: "bold",
            fontSize: 16,
          }}
        >
          Save Client
        </Text>
      </Pressable>
    </ScrollView>
  );
}
