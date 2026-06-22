import { useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Platform,
  Pressable,
  Switch,
  Text,
  View,
} from "react-native";
import { AppScreen } from "../../components/layout/AppScreen";
import { canUseFeature, useFeatureAccess } from "../../lib/featureAccess";
import {
  EXPECTED_MESSAGE_PACK_IDS,
  fetchMessageCreditBalance,
  fetchMessagePackOptions,
  MESSAGE_CREDITS_EMPTY_COPY,
  purchaseMessagePack,
} from "../../lib/messageCredits";
import type {
  MessagePackFetchDebug,
  MessagePackOption,
} from "../../lib/messageCredits";
import { supabase } from "../../lib/supabase";
import { useAppTheme } from "../../lib/useAppTheme";

type SmsSettings = {
  enabled: boolean;
  appointment_confirmations_enabled: boolean;
  appointment_updates_enabled: boolean;
  appointment_cancellations_enabled: boolean;
  appointment_reminders_enabled: boolean;
  reminder_hours_before: number;
};

const DEFAULT_SMS_SETTINGS: SmsSettings = {
  enabled: false,
  appointment_confirmations_enabled: true,
  appointment_updates_enabled: true,
  appointment_cancellations_enabled: true,
  appointment_reminders_enabled: true,
  reminder_hours_before: 24,
};

const REMINDER_TIMING_OPTIONS = [24, 48, 72, 168];

export default function SmsSettingsScreen() {
  const { colors } = useAppTheme();
  useFeatureAccess();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [isPaid, setIsPaid] = useState(false);
  const [statusMessage, setStatusMessage] = useState("");
  const [settings, setSettings] = useState<SmsSettings>(DEFAULT_SMS_SETTINGS);
  const [messageCreditBalance, setMessageCreditBalance] = useState<
    number | null
  >(null);
  const [messagePacks, setMessagePacks] = useState<MessagePackOption[]>([]);
  const [messagePacksLoading, setMessagePacksLoading] = useState(false);
  const [messagePackStatus, setMessagePackStatus] = useState("");
  const [messagePackDebug, setMessagePackDebug] =
    useState<MessagePackFetchDebug | null>(null);
  const [purchasingPackId, setPurchasingPackId] = useState<string | null>(null);
  const smsAvailable = canUseFeature("smsAutomation");
  const canShowMessageCredits =
    Platform.OS === "ios" || Platform.OS === "android";

  const loadSettings = useCallback(async () => {
    setLoading(true);

    try {
      setIsPaid(smsAvailable);

      if (!smsAvailable) {
        setSettings(DEFAULT_SMS_SETTINGS);
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

      const settingsResult = await supabase
        .from("sms_settings")
        .select("*")
        .eq("user_id", user.id)
        .maybeSingle();

      if (settingsResult.data) {
        setSettings({
          enabled: Boolean(settingsResult.data.enabled),
          appointment_confirmations_enabled: Boolean(
            settingsResult.data.appointment_confirmations_enabled,
          ),
          appointment_updates_enabled: Boolean(
            settingsResult.data.appointment_updates_enabled,
          ),
          appointment_cancellations_enabled: Boolean(
            settingsResult.data.appointment_cancellations_enabled,
          ),
          appointment_reminders_enabled: Boolean(
            settingsResult.data.appointment_reminders_enabled,
          ),
          reminder_hours_before:
            Number(settingsResult.data.reminder_hours_before) || 24,
        });
      } else {
        setSettings(DEFAULT_SMS_SETTINGS);
      }
    } finally {
      setLoading(false);
    }
  }, [smsAvailable]);

  const loadMessageCredits = useCallback(async () => {
    if (!canShowMessageCredits) return;

    setMessagePacksLoading(true);

    try {
      const [balanceResult, packResult] = await Promise.allSettled([
        fetchMessageCreditBalance(),
        fetchMessagePackOptions(),
      ]);

      if (balanceResult.status === "fulfilled") {
        setMessageCreditBalance(balanceResult.value);
      } else {
        console.log("Message credit balance load failed", balanceResult.reason);
        setMessageCreditBalance(null);
      }

      if (packResult.status === "fulfilled") {
        setMessagePacks(packResult.value.packs);
        setMessagePackDebug(packResult.value.debug);
      } else {
        console.log("Message pack load failed", packResult.reason);
        setMessagePacks([]);
        setMessagePackDebug({
          defaultOfferingLoaded: false,
          packageCount: 0,
          packageIdentifiers: [],
          storeProductIdentifiers: [],
          foundMessagePacks: Object.fromEntries(
            EXPECTED_MESSAGE_PACK_IDS.map((packId) => [packId, false]),
          ),
          platform: Platform.OS,
          revenueCatSupported: false,
          fetchError: String(packResult.reason || "Unknown error"),
        });
      }
    } finally {
      setMessagePacksLoading(false);
    }
  }, [canShowMessageCredits]);

  useFocusEffect(
    useCallback(() => {
      void loadSettings();
      void loadMessageCredits();
    }, [loadMessageCredits, loadSettings]),
  );

  async function buyMessagePack(pack: MessagePackOption) {
    setMessagePackStatus("");
    setPurchasingPackId(pack.id);

    try {
      const result = await purchaseMessagePack(pack);

      if (result.cancelled) {
        return;
      }

      setMessageCreditBalance(result.creditsRemaining);
      setMessagePackStatus(`Added ${result.creditsAdded} message credits.`);
      void loadMessageCredits();
    } catch (error) {
      console.log("Message pack purchase failed", error);
      Alert.alert(
        "Message packs",
        "Message pack purchase could not be completed. Please try again.",
      );
    } finally {
      setPurchasingPackId(null);
    }
  }

  async function saveSettings() {
    if (!smsAvailable) {
      Alert.alert(
        "SMS settings",
        "SMS appointment texts are not available yet.",
      );
      return;
    }

    setSaving(true);

    try {
      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser();

      if (userError || !user) {
        Alert.alert("Not signed in", "Please sign in again.");
        return;
      }

      const { error } = await supabase.from("sms_settings").upsert({
        user_id: user.id,
        ...settings,
        updated_at: new Date().toISOString(),
      });

      if (error) {
        console.log("SMS settings save failed", error.message);
        setStatusMessage("");
        Alert.alert(
          "SMS settings",
          "SMS text settings could not be saved. Please try again.",
        );
        return;
      }

      setStatusMessage("SMS settings saved.");
    } finally {
      setSaving(false);
    }
  }

  function updateSetting(key: keyof SmsSettings, value: boolean | number) {
    setStatusMessage("");
    setSettings((current) => ({
      ...current,
      [key]: value,
    }));
  }

  function getReminderTimingLabel(hours: number) {
    return hours === 168 ? "1 week" : `${hours}h`;
  }

  function ToggleRow({
    label,
    description,
    value,
    onValueChange,
    disabled,
  }: {
    label: string;
    description: string;
    value: boolean;
    onValueChange: (value: boolean) => void;
    disabled?: boolean;
  }) {
    return (
      <View
        style={{
          borderWidth: 1,
          borderColor: colors.border,
          borderRadius: 14,
          padding: 14,
          marginBottom: 12,
          opacity: disabled ? 0.55 : 1,
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
            {label}
          </Text>
          <Switch
            value={value}
            onValueChange={onValueChange}
            disabled={disabled}
          />
        </View>
        <Text style={{ color: colors.mutedText, marginTop: 6, lineHeight: 19 }}>
          {description}
        </Text>
      </View>
    );
  }

  return (
    <AppScreen scroll backgroundColor={colors.background}>
      <Text
        style={{
          color: colors.text,
          fontSize: 30,
          fontWeight: "bold",
          marginBottom: 10,
        }}
      >
        SMS Settings
      </Text>

      <Text
        style={{ color: colors.mutedText, marginBottom: 20, lineHeight: 21 }}
      >
        Schedova can help send appointment texts when SMS is enabled and the
        client has opted in.
      </Text>

      {canShowMessageCredits ? (
        <View
          style={{
            backgroundColor: colors.card,
            borderWidth: 1,
            borderColor: colors.border,
            borderRadius: 16,
            padding: 16,
            marginBottom: 18,
          }}
        >
          <Text style={{ color: colors.text, fontWeight: "900", fontSize: 17 }}>
            Message credits
          </Text>
          <Text
            style={{ color: colors.mutedText, marginTop: 8, lineHeight: 20 }}
          >
            {MESSAGE_CREDITS_EMPTY_COPY}
          </Text>
          <Text
            style={{
              color: colors.text,
              fontWeight: "900",
              marginTop: 12,
              marginBottom: 10,
            }}
          >
            Balance:{" "}
            {messageCreditBalance === null
              ? "Not loaded"
              : `${messageCreditBalance} messages`}
          </Text>

          {messagePacksLoading ? (
            <View style={{ alignItems: "flex-start", paddingVertical: 6 }}>
              <ActivityIndicator color={colors.primary} />
            </View>
          ) : messagePacks.length > 0 ? (
            <View style={{ gap: 10 }}>
              {messagePacks.map((pack) => {
                const purchasing = purchasingPackId === pack.id;

                return (
                  <Pressable
                    key={`${pack.packageIdentifier}:${pack.productIdentifier}`}
                    disabled={Boolean(purchasingPackId)}
                    onPress={() => {
                      void buyMessagePack(pack);
                    }}
                    style={{
                      backgroundColor: purchasing
                        ? colors.mutedText
                        : colors.primary,
                      borderRadius: 12,
                      padding: 14,
                      alignItems: "center",
                    }}
                  >
                    <Text style={{ color: "#FFFFFF", fontWeight: "900" }}>
                      {purchasing
                        ? "Purchasing..."
                        : `Buy ${pack.title} - ${pack.priceString}`}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          ) : (
            <Text
              style={{ color: colors.mutedText, lineHeight: 20, marginTop: 4 }}
            >
              Message packs are being set up. Please check back soon.
            </Text>
          )}

          {messagePackStatus ? (
            <Text
              accessibilityLiveRegion="polite"
              style={{
                color: colors.primary,
                fontSize: 13,
                fontWeight: "800",
                marginTop: 10,
              }}
            >
              {messagePackStatus}
            </Text>
          ) : null}

          {__DEV__ && messagePackDebug ? (
            <Text
              style={{
                color: colors.mutedText,
                fontSize: 12,
                lineHeight: 17,
                marginTop: 12,
              }}
            >
              {`Debug: default offering loaded ${
                messagePackDebug.defaultOfferingLoaded ? "yes" : "no"
              }; packages ${messagePackDebug.packageCount}; package IDs ${
                messagePackDebug.packageIdentifiers.join(", ") || "none"
              }; product IDs ${
                messagePackDebug.storeProductIdentifiers.join(", ") || "none"
              }; 100 ${
                messagePackDebug.foundMessagePacks.message_pack_100
                  ? "yes"
                  : "no"
              }; 250 ${
                messagePackDebug.foundMessagePacks.message_pack_250
                  ? "yes"
                  : "no"
              }; 500 ${
                messagePackDebug.foundMessagePacks.message_pack_500
                  ? "yes"
                  : "no"
              }; error ${messagePackDebug.fetchError || "none"}`}
            </Text>
          ) : null}
        </View>
      ) : null}

      {!isPaid ? (
        <View
          style={{
            backgroundColor: colors.card,
            borderWidth: 1,
            borderColor: colors.border,
            borderRadius: 16,
            padding: 16,
            marginBottom: 18,
          }}
        >
          <Text style={{ color: colors.text, fontWeight: "900", fontSize: 17 }}>
            SMS messaging unavailable
          </Text>
          <Text
            style={{ color: colors.mutedText, marginTop: 8, lineHeight: 20 }}
          >
            Appointment texting will be available after messaging approval is
            complete.
          </Text>
        </View>
      ) : null}

      {isPaid ? (
        <>
          <View
            style={{
              backgroundColor: colors.card,
              borderWidth: 1,
              borderColor: colors.border,
              borderRadius: 16,
              padding: 16,
              marginBottom: 18,
            }}
          >
            <Text
              style={{
                color: colors.text,
                fontSize: 17,
                fontWeight: "900",
                marginBottom: 8,
              }}
            >
              Client opt-in requirement
            </Text>
            <Text
              style={{
                color: colors.mutedText,
                lineHeight: 20,
                marginBottom: 14,
              }}
            >
              Only send SMS texts to clients who have agreed to receive
              appointment messages.
            </Text>
            <Text
              style={{
                color: colors.mutedText,
                lineHeight: 20,
                marginBottom: 14,
              }}
            >
              SMS texts are sent when supported appointment actions happen, such
              as booking or updating an appointment. Only clients who have opted
              in and have a phone number will receive texts.
            </Text>

            <ToggleRow
              label="Enable SMS appointment texts"
              description="Master switch for Schedova appointment text messages."
              value={settings.enabled}
              onValueChange={(value) => updateSetting("enabled", value)}
              disabled={loading}
            />

            <ToggleRow
              label="Reminder text preference"
              description="Send automatic appointment reminder texts using your selected timing."
              value={settings.appointment_reminders_enabled}
              onValueChange={(value) =>
                updateSetting("appointment_reminders_enabled", value)
              }
              disabled={!settings.enabled || loading}
            />

            <View
              style={{
                borderWidth: 1,
                borderColor: colors.border,
                borderRadius: 14,
                padding: 14,
                marginBottom: 12,
                opacity:
                  !settings.enabled ||
                  !settings.appointment_reminders_enabled ||
                  loading
                    ? 0.55
                    : 1,
              }}
            >
              <Text
                style={{ color: colors.text, fontWeight: "800", marginBottom: 8 }}
              >
                Reminder timing preference
              </Text>
              <Text
                style={{
                  color: colors.mutedText,
                  lineHeight: 19,
                  marginBottom: 12,
                }}
              >
                Choose when Schedova should send automatic reminder texts.
              </Text>
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                {REMINDER_TIMING_OPTIONS.map((hours) => {
                  const selected = settings.reminder_hours_before === hours;

                  return (
                    <Pressable
                      key={hours}
                      disabled={
                        !settings.enabled ||
                        !settings.appointment_reminders_enabled ||
                        loading
                      }
                      onPress={() =>
                        updateSetting("reminder_hours_before", hours)
                      }
                      style={{
                        flexGrow: 1,
                        minWidth: "46%",
                        backgroundColor: selected
                          ? colors.primary
                          : colors.background,
                        borderColor: selected ? colors.primary : colors.border,
                        borderWidth: 1,
                        borderRadius: 12,
                        paddingVertical: 12,
                        alignItems: "center",
                      }}
                    >
                      <Text
                        style={{
                          color: selected ? "#FFFFFF" : colors.text,
                          fontWeight: "900",
                        }}
                      >
                        {getReminderTimingLabel(hours)}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>

            <ToggleRow
              label="Confirmation texts"
              description="Send a text when a new appointment is created and the client has opted in."
              value={settings.appointment_confirmations_enabled}
              onValueChange={(value) =>
                updateSetting("appointment_confirmations_enabled", value)
              }
              disabled={!settings.enabled || loading}
            />

            <ToggleRow
              label="Update texts"
              description="Send a text when an appointment changes and the client has opted in."
              value={settings.appointment_updates_enabled}
              onValueChange={(value) =>
                updateSetting("appointment_updates_enabled", value)
              }
              disabled={!settings.enabled || loading}
            />

            <ToggleRow
              label="Cancellation texts"
              description="Send a text when an appointment is canceled or deleted and the client has opted in."
              value={settings.appointment_cancellations_enabled}
              onValueChange={(value) =>
                updateSetting("appointment_cancellations_enabled", value)
              }
              disabled={!settings.enabled || loading}
            />

            <Text
              style={{
                color: colors.mutedText,
                fontSize: 13,
                lineHeight: 19,
                marginTop: 2,
              }}
            >
              Schedova uses default appointment SMS wording for now. Message
              delivery depends on your SMS setup and the client carrier.
            </Text>
          </View>

          <Pressable
            disabled={saving || loading}
            onPress={saveSettings}
            style={{
              backgroundColor:
                saving || loading ? colors.mutedText : colors.primary,
              padding: 16,
              borderRadius: 14,
              alignItems: "center",
            }}
          >
            <Text style={{ color: "#FFFFFF", fontWeight: "900" }}>
              {saving ? "Saving..." : "Save SMS Settings"}
            </Text>
          </Pressable>

          {statusMessage ? (
            <Text
              accessibilityLiveRegion="polite"
              style={{
                color: colors.mutedText,
                fontSize: 13,
                fontWeight: "700",
                lineHeight: 18,
                marginTop: 10,
                textAlign: "center",
              }}
            >
              {statusMessage}
            </Text>
          ) : null}
        </>
      ) : null}
    </AppScreen>
  );
}
