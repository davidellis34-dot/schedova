import { Alert, Pressable, Switch, Text, View } from "react-native";

import {
  getEmailRecipientCount,
  getSmsRecipientCount,
  sendConsentRequests,
  type CommunicationRecipient,
} from "../../lib/communicationRecipients";
import { AppButton, AppCard, AppTextInput } from "../ui";

type Props = {
  clientId?: string | null;
  colors: {
    background: string;
    card: string;
    text: string;
    mutedText: string;
    border: string;
    primary: string;
  };
  recipients: CommunicationRecipient[];
  onChange: (recipients: CommunicationRecipient[]) => void;
  showConsentRequest?: boolean;
};

function updateRecipient(
  recipients: CommunicationRecipient[],
  index: number,
  patch: Partial<CommunicationRecipient>,
) {
  return recipients.map((recipient, recipientIndex) =>
    recipientIndex === index ? { ...recipient, ...patch } : recipient,
  );
}

function newRecipient(): CommunicationRecipient {
  return {
    name: "",
    relationship: "",
    phone: "",
    email: "",
    smsEnabled: false,
    emailEnabled: false,
  };
}

export function CommunicationRecipientsSection({
  clientId,
  colors,
  recipients,
  onChange,
  showConsentRequest = true,
}: Props) {
  const safeRecipients = recipients.length > 0 ? recipients : [newRecipient()];
  const smsCount = getSmsRecipientCount(safeRecipients);
  const emailCount = getEmailRecipientCount(safeRecipients);

  function applyBulk(mode: "sms" | "email" | "both" | "clear") {
    onChange(
      safeRecipients.map((recipient) => ({
        ...recipient,
        smsEnabled:
          mode === "sms" || mode === "both"
            ? Boolean(recipient.phone)
            : mode === "clear"
              ? false
              : recipient.smsEnabled,
        emailEnabled:
          mode === "email" || mode === "both"
            ? Boolean(recipient.email)
            : mode === "clear"
              ? false
              : recipient.emailEnabled,
      })),
    );
  }

  async function requestConsent() {
    if (!clientId) {
      Alert.alert("Save client first", "Save the client before sending consent requests.");
      return;
    }

    try {
      const result = await sendConsentRequests({
        clientId,
        recipients: safeRecipients,
      });

      if (!result?.ok) {
        Alert.alert("Consent request not sent", "Select at least one recipient with SMS or Email enabled.");
        return;
      }

      Alert.alert("Consent requests sent", "Selected contacts were sent confirmation links.");
    } catch (error) {
      console.log("Consent request failed", error);
      Alert.alert("Consent request failed", "Please try again.");
    }
  }

  return (
    <AppCard
      style={{
        borderColor: colors.border,
        borderWidth: 1,
        marginBottom: 18,
      }}
    >
      <Text
        style={{
          color: colors.text,
          fontSize: 18,
          fontWeight: "900",
          marginBottom: 6,
        }}
      >
        Communication Recipients
      </Text>
      <Text style={{ color: colors.mutedText, lineHeight: 20, marginBottom: 14 }}>
        Choose who should receive appointment texts and emails. These settings are remembered for future appointments.
      </Text>

      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 14 }}>
        {[
          ["Select all for SMS", "sms"],
          ["Select all for Email", "email"],
          ["Select all for Both", "both"],
          ["Clear all", "clear"],
        ].map(([label, mode]) => (
          <Pressable
            key={mode}
            accessibilityRole="button"
            onPress={() => applyBulk(mode as "sms" | "email" | "both" | "clear")}
            style={{
              minHeight: 40,
              paddingHorizontal: 12,
              borderRadius: 999,
              borderWidth: 1,
              borderColor: colors.border,
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Text style={{ color: colors.text, fontWeight: "800", fontSize: 12 }}>
              {label}
            </Text>
          </Pressable>
        ))}
      </View>

      {safeRecipients.map((recipient, index) => (
        <View
          key={`${recipient.id || "new"}-${index}`}
          style={{
            borderWidth: 1,
            borderColor: colors.border,
            borderRadius: 14,
            padding: 12,
            marginBottom: 12,
            backgroundColor: colors.background,
          }}
        >
          <AppTextInput
            label="Contact name"
            value={recipient.name}
            onChangeText={(value) =>
              onChange(updateRecipient(safeRecipients, index, { name: value }))
            }
            placeholder="Emma Smith"
          />
          <AppTextInput
            label="Relationship"
            value={recipient.relationship}
            onChangeText={(value) =>
              onChange(
                updateRecipient(safeRecipients, index, { relationship: value }),
              )
            }
            placeholder="Parent, spouse, assistant..."
          />
          <AppTextInput
            label="Phone number"
            value={recipient.phone}
            onChangeText={(value) =>
              onChange(updateRecipient(safeRecipients, index, { phone: value }))
            }
            keyboardType="phone-pad"
            placeholder="Phone number"
          />
          <AppTextInput
            label="Email address"
            value={recipient.email}
            onChangeText={(value) =>
              onChange(updateRecipient(safeRecipients, index, { email: value }))
            }
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
            placeholder="Email address"
          />

          <View style={{ flexDirection: "row", gap: 12, marginTop: -4 }}>
            <View style={{ flex: 1 }}>
              <Text style={{ color: colors.text, fontWeight: "800", marginBottom: 8 }}>
                SMS
              </Text>
              <Switch
                value={Boolean(recipient.smsEnabled)}
                onValueChange={(value) =>
                  onChange(
                    updateRecipient(safeRecipients, index, {
                      smsEnabled: value,
                    }),
                  )
                }
                thumbColor={recipient.smsEnabled ? colors.primary : undefined}
              />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ color: colors.text, fontWeight: "800", marginBottom: 8 }}>
                Email
              </Text>
              <Switch
                value={Boolean(recipient.emailEnabled)}
                onValueChange={(value) =>
                  onChange(
                    updateRecipient(safeRecipients, index, {
                      emailEnabled: value,
                    }),
                  )
                }
                thumbColor={recipient.emailEnabled ? colors.primary : undefined}
              />
            </View>
          </View>

          {safeRecipients.length > 1 ? (
            <AppButton
              title="Remove Contact"
              variant="ghost"
              onPress={() =>
                onChange(
                  safeRecipients.filter((_, recipientIndex) => recipientIndex !== index),
                )
              }
              style={{ marginTop: 10 }}
            />
          ) : null}
        </View>
      ))}

      <AppButton
        title="Add Another Contact"
        variant="secondary"
        onPress={() => onChange([...safeRecipients, newRecipient()])}
        style={{ marginBottom: 10 }}
      />

      {showConsentRequest ? (
        <AppButton
          title="Send Consent Request"
          variant="secondary"
          onPress={() => {
            void requestConsent();
          }}
          style={{ marginBottom: 10 }}
        />
      ) : null}

      <Text style={{ color: colors.mutedText, lineHeight: 20 }}>
        Sending to: {smsCount} {smsCount === 1 ? "person" : "people"} by text, {emailCount} {emailCount === 1 ? "person" : "people"} by email.
      </Text>
    </AppCard>
  );
}
