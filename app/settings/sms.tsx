import { useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  Switch,
  Text,
  View,
} from "react-native";
import { AppScreen } from "../../components/layout/AppScreen";
import {
  fetchAndroidMessagePacks,
  fetchMessageCredits,
  getAndroidMessagePackSupportStatus,
  isAndroidMessagePacksSupported,
  MESSAGE_CREDITS_EMPTY_COPY,
  purchaseAndroidMessagePack,
  shouldShowAndroidMessagePackArea,
  type AndroidMessagePack,
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

export default function SmsSettingsScreen() {
  const { colors } = useAppTheme();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [settings, setSettings] = useState<SmsSettings>(DEFAULT_SMS_SETTINGS);
  const [settingsNotice, setSettingsNotice] = useState<string | null>(null);
  const [messageCredits, setMessageCredits] = useState<number | null>(null);
  const [messagePacks, setMessagePacks] = useState<AndroidMessagePack[]>([]);
  const [messagePacksLoading, setMessagePacksLoading] = useState(false);
  const [messagePackNotice, setMessagePackNotice] = useState<string | null>(
    null,
  );
  const [messagePackError, setMessagePackError] = useState<string | null>(null);
  const [purchasingPackId, setPurchasingPackId] = useState<string | null>(null);
  const messagePackSupport = getAndroidMessagePackSupportStatus();

  const loadSettings = useCallback(async () => {
    setLoading(true);
    setSettingsNotice(null);

    try {
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
  }, []);

  const loadMessageCreditData = useCallback(async () => {
    if (!isAndroidMessagePacksSupported()) {
      console.log("Message packs unavailable in this build", {
        ...getAndroidMessagePackSupportStatus(),
      });

      setMessageCredits(null);
      setMessagePacks([]);
      setMessagePackError(null);
      return;
    }

    setMessagePacksLoading(true);
    setMessagePackError(null);

    try {
      const [credits, packs] = await Promise.all([
        fetchMessageCredits(),
        fetchAndroidMessagePacks(),
      ]);

      setMessageCredits(credits);
      setMessagePacks(packs);
    } catch (error) {
      console.log("Message credit load failed", {
        error,
        support: getAndroidMessagePackSupportStatus(),
      });
      setMessagePackError("Message packs are not available right now.");
    } finally {
      setMessagePacksLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void loadSettings();
      void loadMessageCreditData();
    }, [loadMessageCreditData, loadSettings]),
  );

  async function saveSettings() {
    setSaving(true);
    setSettingsNotice(null);

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
        Alert.alert("Error", error.message);
        return;
      }

      setSettingsNotice("SMS settings saved.");
    } finally {
      setSaving(false);
    }
  }

  function updateSetting(key: keyof SmsSettings, value: boolean | number) {
    setSettings((current) => ({
      ...current,
      [key]: value,
    }));
  }

  async function buyMessagePack(pack: AndroidMessagePack) {
    setPurchasingPackId(pack.id);
    setMessagePackError(null);
    setMessagePackNotice(null);

    try {
      const result = await purchaseAndroidMessagePack(pack);

      setMessageCredits(result.creditsRemaining);
      setMessagePackNotice(
        result.purchaseCreated
          ? `${result.creditsAdded} message credits added.`
          : "That purchase was already credited.",
      );
    } catch (error) {
      const record = error as { userCancelled?: boolean; message?: string };

      if (record?.userCancelled) {
        return;
      }

      console.log("Message pack purchase failed", error);
      setMessagePackError(
        record?.message || "Unable to buy message credits right now.",
      );
    } finally {
      setPurchasingPackId(null);
      void loadMessageCreditData();
    }
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
        Send appointment confirmations, updates, cancellations, and reminders
        using account message credits. Message packs are available on Android
        for both Free and Pro accounts.
      </Text>

      {shouldShowAndroidMessagePackArea() ? (
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
            Message Credits
          </Text>

          {!messagePackSupport.supported ? (
            <Text
              style={{ color: colors.mutedText, marginTop: 8, lineHeight: 20 }}
            >
              {messagePackSupport.reason ||
                "Message packs are not available in this build."}
            </Text>
          ) : (
            <Text
              style={{ color: colors.mutedText, marginTop: 8, lineHeight: 20 }}
            >
              {messageCredits === null
                ? "Checking your message credit balance..."
                : `${messageCredits} message credit${
                    messageCredits === 1 ? "" : "s"
                  } remaining.`}
            </Text>
          )}

          {messagePackSupport.supported && messageCredits === 0 ? (
            <Text style={{ color: colors.text, marginTop: 10, lineHeight: 20 }}>
              {MESSAGE_CREDITS_EMPTY_COPY}
            </Text>
          ) : null}

          {messagePackSupport.supported && messagePacksLoading ? (
            <View style={{ paddingVertical: 18, alignItems: "center" }}>
              <ActivityIndicator color={colors.primary} />
            </View>
          ) : null}

          {messagePackNotice ? (
            <Text
              style={{
                color: colors.primary,
                marginTop: 12,
                fontWeight: "800",
              }}
            >
              {messagePackNotice}
            </Text>
          ) : null}

          {messagePackError ? (
            <Text
              style={{
                color: "#B91C1C",
                marginTop: 12,
                fontWeight: "700",
              }}
            >
              {messagePackError}
            </Text>
          ) : null}

          {messagePackSupport.supported && messagePacks.length > 0 ? (
            <View style={{ gap: 10, marginTop: 14 }}>
              {messagePacks.map((pack) => {
                const purchasing = purchasingPackId === pack.id;

                return (
                  <Pressable
                    key={pack.id}
                    disabled={Boolean(purchasingPackId)}
                    onPress={() => void buyMessagePack(pack)}
                    style={{
                      backgroundColor: purchasing
                        ? colors.mutedText
                        : colors.primary,
                      borderRadius: 14,
                      padding: 14,
                      alignItems: "center",
                      opacity: purchasingPackId && !purchasing ? 0.55 : 1,
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
          ) : messagePackSupport.supported && !messagePacksLoading ? (
            <Text
              style={{ color: colors.mutedText, marginTop: 12, lineHeight: 20 }}
            >
              Message packs will appear here when the Android RevenueCat
              offering is available.
            </Text>
          ) : null}
        </View>
      ) : null}

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
        <ToggleRow
          label="Enable SMS"
          description="Master switch for appointment texts."
          value={settings.enabled}
          onValueChange={(value) => updateSetting("enabled", value)}
          disabled={loading}
        />

        <ToggleRow
          label="Confirmation texts"
          description="Send a text when a new appointment is created."
          value={settings.appointment_confirmations_enabled}
          onValueChange={(value) =>
            updateSetting("appointment_confirmations_enabled", value)
          }
          disabled={!settings.enabled || loading}
        />

        <ToggleRow
          label="Update texts"
          description="Send a text when an appointment changes."
          value={settings.appointment_updates_enabled}
          onValueChange={(value) =>
            updateSetting("appointment_updates_enabled", value)
          }
          disabled={!settings.enabled || loading}
        />

        <ToggleRow
          label="Cancellation texts"
          description="Send a text when an appointment is canceled or deleted."
          value={settings.appointment_cancellations_enabled}
          onValueChange={(value) =>
            updateSetting("appointment_cancellations_enabled", value)
          }
          disabled={!settings.enabled || loading}
        />
      </View>

      {settingsNotice ? (
        <Text
          style={{
            color: colors.primary,
            fontWeight: "800",
            marginBottom: 12,
          }}
        >
          {settingsNotice}
        </Text>
      ) : null}

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
    </AppScreen>
  );
}
