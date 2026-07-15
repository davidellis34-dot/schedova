import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Alert, Switch, Text, View } from "react-native";

import { ClientTagPicker } from "../ClientTagPicker";
import { CommunicationRecipientsSection } from "./CommunicationRecipientsSection";
import { AppButton, AppCard, AppTextInput } from "../ui";
import { normalizeClientTag, type ClientTag } from "../../lib/clientTags";
import {
  createPrimaryRecipient,
  fetchClientCommunicationRecipients,
  saveClientCommunicationRecipients,
  type CommunicationRecipient,
} from "../../lib/communicationRecipients";
import { normalizePhoneForSmsWithUserDefault } from "../../lib/countrySettings";
import {
  getSavePerformanceNow,
  logSaveTiming,
  measureSaveStep,
  scheduleSaveCompletionTiming,
} from "../../lib/savePerformance";
import { supabase } from "../../lib/supabase";
import { useAppTheme } from "../../lib/useAppTheme";
import { useAuthSession } from "../../lib/authSession";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function isValidOptionalEmail(value: string) {
  return !value || EMAIL_PATTERN.test(value);
}

function formatBirthdayInput(text: string) {
  const numbers = text.replace(/\D/g, "").slice(0, 4);

  if (numbers.length <= 2) return numbers;

  return `${numbers.slice(0, 2)}/${numbers.slice(2, 4)}`;
}

function normalizeClientId(value: string | null | undefined) {
  return String(value || "").trim();
}

function getClientIdValidationMessage(value: string) {
  if (!value) return "Missing client ID.";
  if (value === "[object Object]") return "Invalid client ID.";
  return "";
}

type LoadErrorType =
  | "missing_client_id"
  | "not_signed_in"
  | "not_found"
  | "database"
  | "unexpected"
  | null;

type EditClientFormProps = {
  clientId: string;
  onCancel: () => void;
  onSaved: () => void;
};

export function EditClientForm({
  clientId,
  onCancel,
  onSaved,
}: EditClientFormProps) {
  const { userId } = useAuthSession();
  const { colors, themeName } = useAppTheme();
  const normalizedClientId = normalizeClientId(clientId);
  const isDarkTheme = themeName === "dark" || themeName === "black";
  const infoAccent = isDarkTheme ? "#60A5FA" : "#2563EB";
  const infoAccentSoft = isDarkTheme
    ? "rgba(96, 165, 250, 0.16)"
    : "rgba(37, 99, 235, 0.10)";
  const infoAccentBorder = isDarkTheme
    ? "rgba(96, 165, 250, 0.34)"
    : "rgba(37, 99, 235, 0.24)";
  const polishedBorder = isDarkTheme
    ? "rgba(148, 163, 184, 0.28)"
    : "rgba(15, 23, 42, 0.12)";
  const destructiveSoft = isDarkTheme
    ? "rgba(220, 38, 38, 0.18)"
    : "rgba(220, 38, 38, 0.10)";
  const destructiveBorder = isDarkTheme
    ? "rgba(248, 113, 113, 0.36)"
    : "rgba(220, 38, 38, 0.22)";

  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [birthday, setBirthday] = useState("");
  const [clientTag, setClientTag] = useState<ClientTag>("New");
  const [notes, setNotes] = useState("");
  const [smsOptIn, setSmsOptIn] = useState(false);
  const [emailOptIn, setEmailOptIn] = useState(false);
  const [recipients, setRecipients] = useState<CommunicationRecipient[]>([
    createPrimaryRecipient({ clientId: normalizedClientId }),
  ]);
  const [loadingClient, setLoadingClient] = useState(Boolean(normalizedClientId));
  const [saving, setSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [loadErrorType, setLoadErrorType] = useState<LoadErrorType>(null);

  const fetchClient = useCallback(async () => {
    const clientIdMessage = getClientIdValidationMessage(normalizedClientId);

    if (clientIdMessage) {
      setLoadingClient(false);
      setLoadErrorType("missing_client_id");
      setErrorMessage(clientIdMessage);
      if (__DEV__) {
        console.log("[EditClient] load", {
          clientId: normalizedClientId || null,
          userId: null,
          error: clientIdMessage,
        });
      }
      return;
    }

    setLoadingClient(true);
    setErrorMessage("");
    setLoadErrorType(null);

    try {
      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser();

      if (userError || !user) {
        const message = "User not signed in. Please sign in again.";
        setLoadErrorType("not_signed_in");
        setErrorMessage(message);
        if (__DEV__) {
          console.log("[EditClient] load", {
            clientId: normalizedClientId,
            userId: user?.id || null,
            error: userError || message,
          });
        }
        return;
      }

      const { data, error } = await supabase
        .from("clients")
        .select(
          "id, name, phone, email, birthday, client_tag, notes, sms_opt_in, email_opt_in",
        )
        .eq("id", normalizedClientId)
        .eq("user_id", user.id)
        .maybeSingle();

      if (__DEV__) {
        console.log("[EditClient] load", {
          clientId: normalizedClientId,
          userId: user.id,
          error: error || null,
        });
      }

      if (error) {
        setLoadErrorType("database");
        setErrorMessage(`Database error loading client: ${error.message}`);
        return;
      }

      if (!data) {
        const message =
          "Client not found. It may have been deleted, or you may not have access.";
        setLoadErrorType("not_found");
        setErrorMessage(message);
        return;
      }

      setLoadErrorType(null);
      setName(String(data.name || ""));
      setPhone(String(data.phone || ""));
      setEmail(String(data.email || ""));
      setBirthday(String(data.birthday || ""));
      setClientTag(normalizeClientTag(data.client_tag));
      setNotes(String(data.notes || ""));
      setSmsOptIn(Boolean(data.sms_opt_in));
      setEmailOptIn(Boolean(data.email_opt_in));
      const loadedRecipients = await fetchClientCommunicationRecipients({
        userId: user.id,
        clientId: normalizedClientId,
        primary: {
          name: data.name,
          phone: data.phone,
          email: data.email,
          smsOptIn: data.sms_opt_in,
          emailOptIn: data.email_opt_in,
        },
      });
      setRecipients(loadedRecipients);
    } catch (error) {
      console.log("Edit client load failed", error);
      const message = "Unexpected error loading client. Please try again.";
      setLoadErrorType("unexpected");
      setErrorMessage(message);
      if (__DEV__) {
        console.log("[EditClient] load", {
          clientId: normalizedClientId || null,
          userId: null,
          error,
        });
      }
    } finally {
      setLoadingClient(false);
    }
  }, [normalizedClientId]);

  useEffect(() => {
    void fetchClient();
  }, [fetchClient]);

  useEffect(() => {
    if (!phone.trim() && smsOptIn) {
      setSmsOptIn(false);
    }
  }, [phone, smsOptIn]);

  async function saveClient() {
    if (saving || loadingClient) return;

    const flowName = "client save (edit)";
    const saveStartedAt = getSavePerformanceNow();
    let postSupabaseStartedAt: number | null = null;
    const validationStartedAt = getSavePerformanceNow();
    setSaving(true);
    setErrorMessage("");

    try {
      const trimmedName = name.trim();
      const trimmedPhoneInput = phone.trim();
      const trimmedPhone =
        await normalizePhoneForSmsWithUserDefault(trimmedPhoneInput);
      const trimmedEmail = email.trim();
      const trimmedBirthday = birthday.trim();
      const trimmedNotes = notes.trim();
      const displayName = trimmedName || trimmedPhone || trimmedEmail;
      const clientIdMessage = getClientIdValidationMessage(normalizedClientId);
      const now = new Date().toISOString();
      const nextSmsOptIn = Boolean(trimmedPhone) && smsOptIn;

      if (clientIdMessage) {
        setErrorMessage(clientIdMessage);
        Alert.alert("Missing client ID", clientIdMessage);
        return;
      }

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

      logSaveTiming(
        flowName,
        "validation",
        getSavePerformanceNow() - validationStartedAt,
      );

      let currentUserId = userId || "";

      if (currentUserId) {
        logSaveTiming(flowName, "auth lookup", 0, {
          source: "cached_user_id",
        });
      } else {
        const {
          data: { user },
          error: userError,
        } = await measureSaveStep(flowName, "auth lookup", () =>
          supabase.auth.getUser(),
        );

        if (userError || !user) {
          const message = "Please sign in again.";
          setErrorMessage(message);
          Alert.alert("Not signed in", message);
          return;
        }

        currentUserId = user.id;
      }

      if (!currentUserId) {
        const message = "Please sign in again.";
        setErrorMessage(message);
        Alert.alert("Not signed in", message);
        return;
      }

      const mutationStartedAt = getSavePerformanceNow();
      logSaveTiming(
        flowName,
        "time before supabase request starts",
        mutationStartedAt - saveStartedAt,
      );

      const { error } = await measureSaveStep(
        flowName,
        "supabase request duration",
        () =>
          supabase
            .from("clients")
            .update({
              name: displayName,
              phone: trimmedPhone || null,
              email: trimmedEmail || null,
              birthday: trimmedBirthday || null,
              client_tag: clientTag,
              notes: trimmedNotes || null,
              sms_opt_in: nextSmsOptIn,
              sms_opt_in_at: nextSmsOptIn ? now : null,
              sms_opt_in_source: nextSmsOptIn ? "Edit Client" : null,
              email_opt_in: emailOptIn,
              email_opt_in_at: emailOptIn ? now : null,
              email_opt_in_source: emailOptIn ? "Edit Client" : null,
            })
            .eq("id", normalizedClientId)
            .eq("user_id", currentUserId),
      );

      if (error) {
        setErrorMessage(error.message);
        Alert.alert("Error", error.message);
        return;
      }

      postSupabaseStartedAt = getSavePerformanceNow();

      scheduleSaveCompletionTiming(flowName, saveStartedAt, {
        postSupabaseStartedAt,
      });
      onSaved();

      requestAnimationFrame(() => {
        setTimeout(() => {
          void measureSaveStep(flowName, "post-save queries", () =>
            saveClientCommunicationRecipients({
              userId: currentUserId,
              clientId: normalizedClientId,
              recipients: recipients.map((recipient, index) =>
                index === 0
                  ? (() => {
                      const primaryPhone = recipient.phone || trimmedPhone;

                      return {
                        ...recipient,
                        name: recipient.name || displayName,
                        phone: primaryPhone,
                        email: recipient.email || trimmedEmail,
                        smsEnabled:
                          Boolean(primaryPhone) &&
                          (recipient.smsEnabled || nextSmsOptIn),
                        emailEnabled: recipient.emailEnabled || emailOptIn,
                        isPrimary: true,
                      };
                    })()
                  : recipient,
              ),
            }),
          ).catch((recipientError) => {
            console.log("Edit client recipient save failed", recipientError);
          });
        }, 0);
      });
    } catch (error) {
      console.log("Edit client save failed", error);
      const message = "Client could not be saved. Please try again.";
      setErrorMessage(message);
      Alert.alert("Error", message);
    } finally {
      setSaving(false);
    }
  }

  if (loadingClient) {
    return (
      <>
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
              alignItems: "center",
              paddingVertical: 24,
            }}
          >
            <ActivityIndicator color={colors.primary} />
            <Text style={{ color: colors.mutedText, marginTop: 10 }}>
              Loading client...
            </Text>
          </View>
        </AppCard>

        <AppButton
          title="Cancel"
          variant="secondary"
          disabled={saving}
          onPress={onCancel}
        />
      </>
    );
  }

  if (loadErrorType) {
    return (
      <>
        <AppCard
          style={{
            borderColor: destructiveBorder,
            borderTopColor: destructiveBorder,
            borderTopWidth: 4,
            borderWidth: 1,
            marginBottom: 18,
          }}
        >
          <Text
            style={{
              color: colors.text,
              fontSize: 18,
              fontWeight: "900",
              marginBottom: 8,
            }}
          >
            {errorMessage}
          </Text>
          <Text style={{ color: colors.mutedText, lineHeight: 20 }}>
            Go back and try opening the client again. If this keeps happening,
            the client may not be linked to this account.
          </Text>
        </AppCard>

        <AppButton title="Back" variant="secondary" onPress={onCancel} />
      </>
    );
  }

  return (
    <>
      <AppCard
        style={{
          borderColor: polishedBorder,
          borderTopColor: colors.primary,
          borderTopWidth: 4,
          borderWidth: 1,
          marginBottom: 18,
        }}
      >
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
          label="Name"
          value={name}
          onChangeText={setName}
          placeholder="Client name"
        />

        <AppTextInput
          label="Phone number"
          value={phone}
          onChangeText={setPhone}
          onBlur={() => {
            if (!phone.trim()) {
              setPhone("");
              return;
            }

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
          label="Email"
          value={email}
          onChangeText={setEmail}
          keyboardType="email-address"
          autoCapitalize="none"
          autoCorrect={false}
          placeholder="Email"
        />

        <AppTextInput
          label="Birthday"
          value={birthday}
          onChangeText={(text) => setBirthday(formatBirthdayInput(text))}
          placeholder="MM/DD"
          maxLength={5}
          keyboardType="number-pad"
        />

        <ClientTagPicker
          value={clientTag}
          onChange={setClientTag}
          colors={colors}
        />

        <AppTextInput
          label="Notes"
          value={notes}
          onChangeText={setNotes}
          multiline
          placeholder="Client preferences..."
        />

        <View
          style={{
            borderWidth: 1,
            borderColor: infoAccentBorder,
            borderLeftColor: infoAccent,
            borderLeftWidth: 4,
            borderRadius: 14,
            padding: 14,
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
              SMS appointment messages
            </Text>
            <Switch
              value={Boolean(phone.trim()) && smsOptIn}
              disabled={!phone.trim()}
              onValueChange={(value) => {
                setSmsOptIn(Boolean(phone.trim()) && value);
              }}
              thumbColor={phone.trim() && smsOptIn ? colors.primary : undefined}
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
            {phone.trim()
              ? "Only enable this if the client has agreed to receive appointment text messages."
              : "Add a phone number before enabling SMS appointment texts."}
          </Text>
        </View>

        <View
          style={{
            borderWidth: 1,
            borderColor: infoAccentBorder,
            borderLeftColor: infoAccent,
            borderLeftWidth: 4,
            borderRadius: 14,
            padding: 14,
            backgroundColor: infoAccentSoft,
            marginTop: 12,
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
              Email appointment messages
            </Text>
            <Switch
              value={emailOptIn}
              onValueChange={setEmailOptIn}
              thumbColor={emailOptIn ? colors.primary : undefined}
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
            emails.
          </Text>
        </View>
      </AppCard>

      <CommunicationRecipientsSection
        clientId={normalizedClientId}
        colors={colors}
        recipients={recipients}
        onChange={setRecipients}
      />

      <AppButton
        title="Save"
        loading={saving}
        disabled={saving || loadingClient}
        onPress={() => {
          void saveClient();
        }}
        style={{ marginBottom: 12 }}
      />

      <AppButton
        title="Cancel"
        variant="secondary"
        disabled={saving}
        onPress={onCancel}
      />
    </>
  );
}
