import { useRouter } from "expo-router";
import { useState } from "react";
import { Alert, Pressable, ScrollView, Switch, Text, TextInput, View } from "react-native";
import { ClientTagPicker } from "../components/ClientTagPicker";
import type { ClientTag } from "../lib/clientTags";
import { canUseFeature, FREE_TIER_LIMITS } from "../lib/featureAccess";
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
  const [smsOptIn, setSmsOptIn] = useState(false);
  const [clientTag, setClientTag] = useState<ClientTag>("New");

  async function saveClient() {
    const trimmedName = name.trim();
    const trimmedPhone = phone.trim();
    const trimmedEmail = email.trim();
    const displayName = trimmedName || trimmedPhone || trimmedEmail;

    if (!displayName) {
      Alert.alert("Missing Contact", "Enter a name, phone number, or email.");
      return;
    }

    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) {
      Alert.alert("Error", "You must be logged in.");
      return;
    }

    if (!canUseFeature("moreClients")) {
      const { data: existingClients, error: clientsError } = await supabase
        .from("clients")
        .select("id")
        .eq("user_id", user.id)
        .is("archived_at", null);

      if (clientsError) {
        Alert.alert("Error", clientsError.message);
        return;
      }

      if ((existingClients || []).length >= FREE_TIER_LIMITS.clients) {
        Alert.alert(
          "Schedova Pro",
          `Free includes up to ${FREE_TIER_LIMITS.clients} clients. Upgrade to add more.`,
        );
        return;
      }
    }

    const { error } = await supabase.from("clients").insert({
      user_id: user.id,
      name: displayName,
      phone: trimmedPhone || null,
      email: trimmedEmail || null,
      notes: notes.trim() || null,
      birthday: birthday.trim() || null,
      rebooking_weeks: Number(rebookingWeeks) || 6,
      client_tag: clientTag,
      sms_opt_in: smsOptIn,
    });

    if (error) {
      Alert.alert("Error", error.message);
      return;
    }

    Alert.alert("Success", "Client added.");

    router.replace("/clients" as any);
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
        onChangeText={(text) => {
          const numbers = text.replace(/\D/g, "");

          if (numbers.length <= 2) {
            setBirthday(numbers);
          } else {
            setBirthday(`${numbers.slice(0, 2)}/${numbers.slice(2, 4)}`);
          }
        }}
        placeholder="MM/DD"
        maxLength={5}
        keyboardType="number-pad"
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

      <ClientTagPicker
        value={clientTag}
        onChange={setClientTag}
        colors={colors}
      />

      <View
        style={{
          borderWidth: 1,
          borderColor: colors.border,
          borderRadius: 12,
          padding: 14,
          marginBottom: 16,
        }}
      >
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <Text style={{ color: colors.text, fontWeight: "700", flex: 1 }}>
            SMS appointment reminders
          </Text>
          <Switch value={smsOptIn} onValueChange={setSmsOptIn} />
        </View>

        <Text style={{ color: colors.mutedText, marginTop: 8, fontSize: 12 }}>
          Turn this on only if the client agreed to receive appointment text
          messages. They can opt out at any time.
        </Text>
      </View>

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
