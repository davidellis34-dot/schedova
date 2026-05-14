import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { Alert, Pressable, ScrollView, Text, TextInput } from "react-native";
import { supabase } from "../lib/supabase";

export default function EditClientScreen() {
  const router = useRouter();
  const { clientId } = useLocalSearchParams();

  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [notes, setNotes] = useState("");
  const [birthday, setBirthday] = useState("");
  const [rebookingWeeks, setRebookingWeeks] = useState("6");

  useEffect(() => {
    fetchClient();
  }, []);

  async function fetchClient() {
    const { data, error } = await supabase
      .from("clients")
      .select("*")
      .eq("id", clientId)
      .single();

    if (error) {
      Alert.alert("Error", error.message);
      return;
    }

    if (data) {
      setName(data.name || "");
      setPhone(data.phone || "");
      setEmail(data.email || "");
      setNotes(data.notes || "");
      setBirthday(data.birthday || "");
      setRebookingWeeks(String(data.rebooking_weeks || 6));
    }
  }

  async function saveClient() {
    if (!name.trim()) {
      Alert.alert("Missing Name", "Please enter a client name.");
      return;
    }

    const { error } = await supabase
      .from("clients")
      .update({
        name,
        phone,
        email,
        notes,
        birthday: birthday || null,
        rebooking_weeks: Number(rebookingWeeks || 6),
      })
      .eq("id", clientId);

    if (error) {
      Alert.alert("Error", error.message);
      return;
    }

    router.back();
  }

  return (
    <ScrollView
      style={{
        flex: 1,
        backgroundColor: "#ffffff",
        padding: 20,
      }}
    >
      <Text
        style={{
          fontSize: 30,
          fontWeight: "bold",
          marginBottom: 24,
          color: "#111111",
        }}
      >
        Edit Client
      </Text>

      <Text
        style={{
          color: "#111111",
          marginBottom: 6,
        }}
      >
        Client Name
      </Text>

      <TextInput
        value={name}
        onChangeText={setName}
        placeholder="Client name"
        placeholderTextColor="#888888"
        style={{
          borderWidth: 1,
          borderColor: "#D1D5DB",
          borderRadius: 12,
          padding: 14,
          marginBottom: 16,
          color: "#111111",
        }}
      />

      <Text
        style={{
          color: "#111111",
          marginBottom: 6,
        }}
      >
        Phone Number
      </Text>

      <TextInput
        value={phone}
        onChangeText={setPhone}
        keyboardType="phone-pad"
        placeholder="Phone number"
        placeholderTextColor="#888888"
        style={{
          borderWidth: 1,
          borderColor: "#D1D5DB",
          borderRadius: 12,
          padding: 14,
          marginBottom: 16,
          color: "#111111",
        }}
      />

      <Text
        style={{
          color: "#111111",
          marginBottom: 6,
        }}
      >
        Email
      </Text>

      <TextInput
        value={email}
        onChangeText={setEmail}
        keyboardType="email-address"
        placeholder="Email"
        placeholderTextColor="#888888"
        style={{
          borderWidth: 1,
          borderColor: "#D1D5DB",
          borderRadius: 12,
          padding: 14,
          marginBottom: 16,
          color: "#111111",
        }}
      />

      <Text
        style={{
          color: "#111111",
          marginBottom: 6,
        }}
      >
        Birthday
      </Text>

      <TextInput
        value={birthday}
        onChangeText={setBirthday}
        placeholder="YYYY-MM-DD"
        placeholderTextColor="#888888"
        style={{
          borderWidth: 1,
          borderColor: "#D1D5DB",
          borderRadius: 12,
          padding: 14,
          marginBottom: 16,
          color: "#111111",
        }}
      />

      <Text
        style={{
          color: "#111111",
          marginBottom: 6,
        }}
      >
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
          borderColor: "#D1D5DB",
          borderRadius: 12,
          padding: 14,
          marginBottom: 16,
          color: "#111111",
        }}
      />

      <Text
        style={{
          color: "#111111",
          marginBottom: 6,
        }}
      >
        Client Notes
      </Text>

      <TextInput
        value={notes}
        onChangeText={setNotes}
        multiline
        placeholder="Client preferences..."
        placeholderTextColor="#888888"
        style={{
          borderWidth: 1,
          borderColor: "#D1D5DB",
          borderRadius: 12,
          padding: 14,
          minHeight: 120,
          textAlignVertical: "top",
          marginBottom: 24,
          color: "#111111",
        }}
      />

      <Pressable
        onPress={saveClient}
        style={{
          backgroundColor: "#0F766E",
          padding: 16,
          borderRadius: 14,
          alignItems: "center",
          marginBottom: 40,
        }}
      >
        <Text
          style={{
            color: "#ffffff",
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
