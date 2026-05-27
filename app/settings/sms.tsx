import { useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { Alert, Pressable, Switch, Text, View } from "react-native";
import { AppScreen } from "../../components/layout/AppScreen";
import { canUseFeature, useFeatureAccess } from "../../lib/featureAccess";
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
  useFeatureAccess();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [isPaid, setIsPaid] = useState(false);
  const [settings, setSettings] = useState<SmsSettings>(DEFAULT_SMS_SETTINGS);
  const smsAvailable = canUseFeature("smsAutomation");

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

  useFocusEffect(
    useCallback(() => {
      void loadSettings();
    }, [loadSettings]),
  );

  async function saveSettings() {
    if (!smsAvailable) {
      Alert.alert(
        "Schedova Pro",
        "Automatic SMS reminders and confirmations are Pro features.",
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
        Alert.alert("Error", error.message);
        return;
      }

      Alert.alert("Saved", "SMS settings updated.");
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
        Automatic SMS reminders and confirmations are a Schedova Pro feature.
        Free keeps the three copy/paste message templates.
      </Text>

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
            Schedova Pro
          </Text>
          <Text
            style={{ color: colors.mutedText, marginTop: 8, lineHeight: 20 }}
          >
            SMS automation is locked on Free. No automatic texts will be sent
            until Pro is wired up.
          </Text>
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
          description="Master switch for Twilio appointment texts."
          value={settings.enabled}
          onValueChange={(value) => updateSetting("enabled", value)}
          disabled={!isPaid || loading}
        />

        <ToggleRow
          label="Confirmation texts"
          description="Send a text when a new appointment is created."
          value={settings.appointment_confirmations_enabled}
          onValueChange={(value) =>
            updateSetting("appointment_confirmations_enabled", value)
          }
          disabled={!isPaid || !settings.enabled || loading}
        />

        <ToggleRow
          label="Update texts"
          description="Send a text when an appointment changes."
          value={settings.appointment_updates_enabled}
          onValueChange={(value) =>
            updateSetting("appointment_updates_enabled", value)
          }
          disabled={!isPaid || !settings.enabled || loading}
        />

        <ToggleRow
          label="Cancellation texts"
          description="Send a text when an appointment is canceled or deleted."
          value={settings.appointment_cancellations_enabled}
          onValueChange={(value) =>
            updateSetting("appointment_cancellations_enabled", value)
          }
          disabled={!isPaid || !settings.enabled || loading}
        />
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
    </AppScreen>
  );
}
