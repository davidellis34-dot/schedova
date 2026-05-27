import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Alert,
  Pressable,
  ScrollView,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";
import { ClientTagPicker } from "../components/ClientTagPicker";
import { AppScreen } from "../components/layout/AppScreen";
import { normalizeClientTag, type ClientTag } from "../lib/clientTags";
import { supabase } from "../lib/supabase";
import { useAppTheme } from "../lib/useAppTheme";

export default function EditClientScreen() {
  const router = useRouter();
  const { clientId } = useLocalSearchParams();
  const clientIdValue = Array.isArray(clientId) ? clientId[0] : clientId;
  const scrollRef = useRef<ScrollView>(null);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [notes, setNotes] = useState("");
  const [birthday, setBirthday] = useState("");
  const [rebookingWeeks, setRebookingWeeks] = useState("6");
  const [smsOptIn, setSmsOptIn] = useState(false);
  const [clientTag, setClientTag] = useState<ClientTag>("New");
  const [deleting, setDeleting] = useState(false);
  const { colors } = useAppTheme();

  const fetchClient = useCallback(async () => {
    if (!clientIdValue) return;

    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) {
      Alert.alert("Not signed in", "Please sign in again.");
      return;
    }

    const { data, error } = await supabase
      .from("clients")
      .select("*")
      .eq("id", clientIdValue)
      .eq("user_id", user.id)
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
      setSmsOptIn(Boolean(data.sms_opt_in));
      setClientTag(normalizeClientTag(data.client_tag));
    }
  }, [clientIdValue]);

  useEffect(() => {
    fetchClient();
  }, [fetchClient]);

  if (!clientIdValue) return null;

  async function saveClient() {
    if (!clientIdValue) {
      Alert.alert("Error", "Missing client ID.");
      return;
    }

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
      Alert.alert("Not signed in", "Please sign in again.");
      return;
    }

    const { error } = await supabase
      .from("clients")
      .update({
        name: displayName,
        phone: trimmedPhone || null,
        email: trimmedEmail || null,
        notes: notes.trim() || null,
        birthday: birthday || null,
        rebooking_weeks: Number(rebookingWeeks || 6),
        client_tag: clientTag,
        sms_opt_in: smsOptIn,
      })
      .eq("id", clientIdValue)
      .eq("user_id", user.id);

    if (error) {
      Alert.alert("Error", error.message);
      return;
    }

    router.replace("/clients" as any);
  }

  async function archiveClient() {
    if (!clientIdValue || deleting) return;

    setDeleting(true);

    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) {
      setDeleting(false);
      Alert.alert("Not signed in", "Please sign in again.");
      return;
    }

    const { error } = await supabase
      .from("clients")
      .update({ archived_at: new Date().toISOString() })
      .eq("id", clientIdValue)
      .eq("user_id", user.id);

    setDeleting(false);

    if (error) {
      Alert.alert("Error", error.message);
      return;
    }

    Alert.alert("Client deleted", "Client removed from your active list.");
    router.replace("/clients" as any);
  }

  function confirmDeleteClient() {
    Alert.alert(
      "Delete client?",
      "This will remove the client from your active client list. Existing appointments will stay in your history.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete Client",
          style: "destructive",
          onPress: archiveClient,
        },
      ],
    );
  }

  return (
    <AppScreen
      scroll
      keyboardAware
      ref={scrollRef}
      backgroundColor={colors.background}
      keyboardShouldPersistTaps="handled"
    >
        <Text
          style={{
            fontSize: 30,
            fontWeight: "bold",
            marginBottom: 24,
            color: colors.text,
          }}
        >
          Edit Client
        </Text>

        <Text
          style={{
            color: colors.text,
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
            borderColor: colors.border,
            borderRadius: 12,
            padding: 14,
            marginBottom: 16,
            color: colors.text,
          }}
        />

        <Text
          style={{
            color: colors.text,
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
          placeholderTextColor={colors.mutedText}
          style={{
            borderWidth: 1,
            borderColor: colors.border,
            borderRadius: 12,
            padding: 14,
            marginBottom: 16,
            color: colors.text,
          }}
        />

        <Text
          style={{
            color: colors.text,
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
          placeholderTextColor={colors.mutedText}
          style={{
            borderWidth: 1,
            borderColor: colors.border,
            borderRadius: 12,
            padding: 14,
            marginBottom: 16,
            color: colors.text,
          }}
        />

        <Text
          style={{
            color: colors.text,
            marginBottom: 6,
          }}
        >
          Birthday
        </Text>

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
          placeholderTextColor={colors.mutedText}
          style={{
            borderWidth: 1,
            borderColor: colors.border,
            borderRadius: 12,
            padding: 14,
            marginBottom: 16,
            color: colors.text,
          }}
        />

        <Text
          style={{
            color: colors.text,
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
          placeholderTextColor={colors.mutedText}
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

        <Text
          style={{
            color: colors.text,
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
          placeholderTextColor={colors.mutedText}
          onFocus={() => {
            setTimeout(() => {
              scrollRef.current?.scrollToEnd({ animated: true });
            }, 250);
          }}
          style={{
            borderWidth: 1,
            borderColor: colors.border,
            borderRadius: 12,
            padding: 14,
            minHeight: 120,
            textAlignVertical: "top",
            marginBottom: 24,
            color: colors.text,
            backgroundColor: colors.background,
          }}
        />

        <Pressable
          onPress={saveClient}
          style={{
            backgroundColor: "#0F766E",
            padding: 16,
            borderRadius: 14,
            alignItems: "center",
            marginBottom: 14,
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

        <Pressable
          onPress={confirmDeleteClient}
          disabled={deleting}
          style={{
            backgroundColor: "#B91C1C",
            padding: 16,
            borderRadius: 14,
            alignItems: "center",
            marginBottom: 40,
            opacity: deleting ? 0.7 : 1,
          }}
        >
          <Text
            style={{
              color: "#ffffff",
              fontWeight: "bold",
              fontSize: 16,
            }}
          >
            Delete Client
          </Text>
        </Pressable>
    </AppScreen>
  );
}
