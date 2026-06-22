import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  Switch,
  Text,
  View,
} from "react-native";
import { ClientTagPicker } from "../components/ClientTagPicker";
import {
  AppButton,
  AppCard,
  AppScreen,
  AppTextInput,
  ScreenHeader,
} from "../components/ui";
import { normalizeClientTag, type ClientTag } from "../lib/clientTags";
import { normalizePhoneForSmsWithUserDefault } from "../lib/countrySettings";
import { supabase } from "../lib/supabase";
import { useAppTheme } from "../lib/useAppTheme";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function isValidOptionalEmail(value: string) {
  return !value || EMAIL_PATTERN.test(value);
}

function formatBirthdayInput(text: string) {
  const numbers = text.replace(/\D/g, "").slice(0, 4);

  if (numbers.length <= 2) return numbers;

  return `${numbers.slice(0, 2)}/${numbers.slice(2, 4)}`;
}

function parseRebookingWeeks(value: string) {
  const weeks = Number(value);
  return Number.isFinite(weeks) && weeks > 0 ? weeks : 6;
}

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
  const [loadingClient, setLoadingClient] = useState(Boolean(clientIdValue));
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const { colors, themeName } = useAppTheme();
  const isDarkTheme = themeName === "dark" || themeName === "black";
  const infoAccent = isDarkTheme ? "#60A5FA" : "#2563EB";
  const infoAccentSoft = isDarkTheme
    ? "rgba(96, 165, 250, 0.16)"
    : "rgba(37, 99, 235, 0.10)";
  const infoAccentBorder = isDarkTheme
    ? "rgba(96, 165, 250, 0.34)"
    : "rgba(37, 99, 235, 0.24)";
  const greenAccentSoft = isDarkTheme
    ? "rgba(15, 118, 110, 0.26)"
    : "rgba(15, 118, 110, 0.12)";
  const polishedBorder = isDarkTheme
    ? "rgba(148, 163, 184, 0.28)"
    : "rgba(15, 23, 42, 0.12)";
  const destructiveSoft = isDarkTheme
    ? "rgba(220, 38, 38, 0.18)"
    : "rgba(220, 38, 38, 0.10)";
  const destructiveBorder = isDarkTheme
    ? "rgba(248, 113, 113, 0.36)"
    : "rgba(220, 38, 38, 0.22)";

  const fetchClient = useCallback(async () => {
    if (!clientIdValue) {
      setLoadingClient(false);
      return;
    }

    setLoadingClient(true);
    setErrorMessage("");

    try {
      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser();

      if (userError || !user) {
        const message = "Please sign in again.";
        setErrorMessage(message);
        Alert.alert("Not signed in", message);
        return;
      }

      const { data, error } = await supabase
        .from("clients")
        .select("*")
        .eq("id", clientIdValue)
        .eq("user_id", user.id)
        .single();

      if (error) {
        setErrorMessage(error.message);
        Alert.alert("Error", error.message);
        return;
      }

      if (data) {
        setName(String(data.name || ""));
        setPhone(String(data.phone || ""));
        setEmail(String(data.email || ""));
        setNotes(String(data.notes || ""));
        setBirthday(String(data.birthday || ""));
        setRebookingWeeks(String(data.rebooking_weeks || 6));
        setSmsOptIn(Boolean(data.sms_opt_in));
        setClientTag(normalizeClientTag(data.client_tag));
        return;
      }

      const message = "Client could not be found.";
      setErrorMessage(message);
      Alert.alert("Client not found", message);
    } catch (error) {
      console.log("Edit client load failed", error);
      const message = "Client could not be loaded. Please try again.";
      setErrorMessage(message);
      Alert.alert("Error", message);
    } finally {
      setLoadingClient(false);
    }
  }, [clientIdValue]);

  useEffect(() => {
    void fetchClient();
  }, [fetchClient]);

  if (!clientIdValue) return null;

  async function saveClient() {
    if (saving || loadingClient) return;

    setSaving(true);
    setErrorMessage("");

    try {
      if (!clientIdValue) {
        setErrorMessage("Missing client ID.");
        Alert.alert("Error", "Missing client ID.");
        return;
      }

      const trimmedName = name.trim();
      const trimmedPhoneInput = phone.trim();
      const trimmedPhone =
        await normalizePhoneForSmsWithUserDefault(trimmedPhoneInput);
      const trimmedEmail = email.trim();
      const trimmedNotes = notes.trim();
      const trimmedBirthday = birthday.trim();
      const displayName = trimmedName || trimmedPhone || trimmedEmail;

      if (!displayName) {
        const message = "Enter a name, phone number, or email.";
        setErrorMessage(message);
        Alert.alert("Missing Contact", message);
        return;
      }

      if (!isValidOptionalEmail(trimmedEmail)) {
        const message = "Enter a valid email address or leave email blank.";
        setErrorMessage(message);
        Alert.alert("Invalid Email", message);
        return;
      }

      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser();

      if (userError || !user) {
        const message = "Please sign in again.";
        setErrorMessage(message);
        Alert.alert("Not signed in", message);
        return;
      }

      const { error } = await supabase
        .from("clients")
        .update({
          name: displayName,
          phone: trimmedPhone || null,
          email: trimmedEmail || null,
          notes: trimmedNotes || null,
          birthday: trimmedBirthday || null,
          rebooking_weeks: parseRebookingWeeks(rebookingWeeks),
          client_tag: clientTag,
          sms_opt_in: smsOptIn,
        })
        .eq("id", clientIdValue)
        .eq("user_id", user.id);

      if (error) {
        setErrorMessage(error.message);
        Alert.alert("Error", error.message);
        return;
      }

      router.replace("/clients" as any);
    } catch (error) {
      console.log("Edit client save failed", error);
      const message = "Client could not be saved. Please try again.";
      setErrorMessage(message);
      Alert.alert("Error", message);
    } finally {
      setSaving(false);
    }
  }

  async function archiveClient() {
    if (!clientIdValue || deleting) return;

    setDeleting(true);

    try {
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
        .update({ archived_at: new Date().toISOString() })
        .eq("id", clientIdValue)
        .eq("user_id", user.id);

      if (error) {
        Alert.alert("Error", error.message);
        return;
      }

      router.replace("/clients" as any);
    } catch (error) {
      console.log("Archive client failed", error);
      Alert.alert("Error", "Client could not be deleted. Please try again.");
    } finally {
      setDeleting(false);
    }
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
      bottomPadding={64}
    >
      <ScreenHeader
        title="Edit Client"
        subtitle="Update client details and preferences."
      />

      <AppCard
        style={{
          borderColor: polishedBorder,
          borderTopColor: colors.primary,
          borderTopWidth: 4,
          borderWidth: 1,
          marginBottom: 18,
        }}
      >
        <View
          style={{
            flexDirection: "row",
            alignItems: "flex-start",
            gap: 12,
            marginBottom: 14,
          }}
        >
          <View
            style={{
              width: 38,
              height: 38,
              borderRadius: 19,
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: greenAccentSoft,
              borderWidth: 1,
              borderColor: colors.primary,
            }}
          >
            <Ionicons name="create-outline" size={19} color={colors.primary} />
          </View>
          <View style={{ flex: 1 }}>
            <Text
              style={{
                color: colors.text,
                fontSize: 20,
                fontWeight: "900",
                marginBottom: 6,
              }}
            >
              Client details
            </Text>
            <Text
              style={{
                color: colors.mutedText,
                lineHeight: 20,
              }}
            >
              Name, phone, or email is enough to save. Everything else is
              optional.
            </Text>
          </View>
        </View>

        <View
          style={{
            height: 1,
            backgroundColor: colors.border,
            marginBottom: 18,
          }}
        />

        {loadingClient ? (
          <View
            style={{
              alignItems: "center",
              paddingVertical: 18,
              marginBottom: 12,
            }}
          >
            <ActivityIndicator color={colors.primary} />
            <Text style={{ color: colors.mutedText, marginTop: 10 }}>
              Loading client...
            </Text>
          </View>
        ) : null}

        {errorMessage ? (
          <View
            style={{
              borderWidth: 1,
              borderColor: destructiveBorder,
              backgroundColor: destructiveSoft,
              borderRadius: 14,
              padding: 12,
              marginBottom: 16,
            }}
          >
            <Text
              style={{ color: colors.text, fontWeight: "800", lineHeight: 20 }}
            >
              {errorMessage}
            </Text>
          </View>
        ) : null}

        <AppTextInput
          label="Client name (optional)"
          value={name}
          onChangeText={setName}
          placeholder="Client name"
          helperText="Use at least one contact field: name, phone, or email."
        />

        <AppTextInput
          label="Phone number (optional)"
          value={phone}
          onChangeText={setPhone}
          onBlur={() => {
            void normalizePhoneForSmsWithUserDefault(phone.trim())
              .then(setPhone)
              .catch((error) => {
                console.log("Phone normalization failed", error);
              });
          }}
          keyboardType="phone-pad"
          placeholder="Phone number"
        />

        <AppTextInput
          label="Email (optional)"
          value={email}
          onChangeText={setEmail}
          keyboardType="email-address"
          autoCapitalize="none"
          autoCorrect={false}
          placeholder="Email"
        />

        <AppTextInput
          label="Birthday (optional)"
          value={birthday}
          onChangeText={(text) => setBirthday(formatBirthdayInput(text))}
          placeholder="MM/DD"
          maxLength={5}
          keyboardType="number-pad"
        />

        <AppTextInput
          label="Rebooking interval (weeks)"
          value={rebookingWeeks}
          onChangeText={setRebookingWeeks}
          keyboardType="numeric"
          placeholder="6"
        />

        <ClientTagPicker
          value={clientTag}
          onChange={setClientTag}
          colors={colors}
        />

        <View
          style={{
            borderWidth: 1,
            borderColor: infoAccentBorder,
            borderLeftColor: infoAccent,
            borderLeftWidth: 4,
            borderRadius: 14,
            padding: 14,
            marginBottom: 18,
            backgroundColor: infoAccentSoft,
          }}
        >
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 12,
            }}
          >
            <Text style={{ color: colors.text, fontWeight: "800", flex: 1 }}>
              Client agreed to receive appointment texts.
            </Text>
            <Switch
              value={smsOptIn}
              onValueChange={setSmsOptIn}
              thumbColor={smsOptIn ? colors.primary : undefined}
            />
          </View>

          <Text
            style={{
              color: colors.mutedText,
              marginTop: 8,
              fontSize: 12,
              lineHeight: 18,
            }}
          >
            Only enable this if the client has agreed to receive appointment
            text messages.
          </Text>
        </View>

        <AppTextInput
          label="Client notes (optional)"
          value={notes}
          onChangeText={setNotes}
          multiline
          placeholder="Client preferences..."
          onFocus={() => {
            setTimeout(() => {
              scrollRef.current?.scrollToEnd({ animated: true });
            }, 250);
          }}
          containerStyle={{ marginBottom: 0 }}
        />
      </AppCard>

      <AppButton
        title="Save Changes"
        loading={saving}
        disabled={saving || deleting || loadingClient}
        onPress={() => {
          void saveClient();
        }}
        style={{ marginBottom: 14 }}
      />

      <AppButton
        title={deleting ? "Deleting..." : "Delete Client"}
        variant="destructive"
        loading={deleting}
        disabled={saving || deleting || loadingClient}
        onPress={confirmDeleteClient}
      />
    </AppScreen>
  );
}
