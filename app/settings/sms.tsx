import { useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { Alert, Pressable, Switch, Text, View } from "react-native";
import { AppScreen } from "../../components/layout/AppScreen";
import { useAuthSession } from "../../lib/authSession";
import { canUseFeature, useFeatureAccess } from "../../lib/featureAccess";
import { ENABLE_PRO } from "../../lib/proFeatureFlag";
import {
  openSchedovaProScreen,
  PRO_UPSELL_COPY,
  showProUpgradePrompt,
} from "../../lib/proUpsell";
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

function logSmsSettingsSupabaseError(
  label: string,
  error: {
    code?: string | null;
    message?: string | null;
    details?: string | null;
    hint?: string | null;
  } | null | undefined,
  extra: Record<string, unknown> = {},
) {
  console.log(`[SMS settings] ${label}`, {
    code: error?.code ?? null,
    message: error?.message ?? null,
    details: error?.details ?? null,
    hint: error?.hint ?? null,
    ...extra,
  });
}

export default function SmsSettingsScreen() {
  const { colors } = useAppTheme();
  const { authStatus, userId } = useAuthSession();
  useFeatureAccess();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [isPaid, setIsPaid] = useState(false);
  const [statusMessage, setStatusMessage] = useState("");
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

      if (authStatus !== "authenticated" || !userId) {
        setSettings(DEFAULT_SMS_SETTINGS);
        setStatusMessage("");
        return;
      }

      const settingsResult = await supabase
        .from("sms_settings")
        .select("*")
        .eq("user_id", userId)
        .maybeSingle();

      if (settingsResult.error) {
        logSmsSettingsSupabaseError("load failed", settingsResult.error, {
          userId,
        });
        setSettings(DEFAULT_SMS_SETTINGS);
        setStatusMessage("");
        Alert.alert(
          "SMS settings",
          "SMS settings could not be loaded right now. Please try again.",
        );
        return;
      }

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
  }, [authStatus, smsAvailable, userId]);

  useFocusEffect(
    useCallback(() => {
      void loadSettings();
    }, [loadSettings]),
  );

  async function saveSettings() {
    if (!smsAvailable) {
      if (ENABLE_PRO) {
        showProUpgradePrompt(PRO_UPSELL_COPY.sms);
      } else {
        Alert.alert(
          "SMS settings",
          "SMS appointment texts are not available yet.",
        );
      }
      return;
    }

    setSaving(true);

    try {
      if (authStatus !== "authenticated" || !userId) {
        Alert.alert("Not signed in", "Please sign in again.");
        return;
      }

      const settingsPayload = {
        enabled: Boolean(settings.enabled),
        appointment_confirmations_enabled: Boolean(
          settings.appointment_confirmations_enabled,
        ),
        appointment_updates_enabled: Boolean(
          settings.appointment_updates_enabled,
        ),
        appointment_cancellations_enabled: Boolean(
          settings.appointment_cancellations_enabled,
        ),
        appointment_reminders_enabled: Boolean(
          settings.appointment_reminders_enabled,
        ),
        reminder_hours_before: Number(settings.reminder_hours_before) || 24,
        updated_at: new Date().toISOString(),
      };

      const existingRowResult = await supabase
        .from("sms_settings")
        .select("user_id")
        .eq("user_id", userId)
        .maybeSingle();

      if (existingRowResult.error) {
        logSmsSettingsSupabaseError(
          "existing row lookup failed",
          existingRowResult.error,
          {
            userId,
          },
        );
        setStatusMessage("");
        Alert.alert(
          "SMS settings",
          "SMS text settings could not be saved. Please try again.",
        );
        return;
      }

      const saveResult = existingRowResult.data
        ? await supabase
            .from("sms_settings")
            .update(settingsPayload)
            .eq("user_id", userId)
            .select("user_id")
            .maybeSingle()
        : await supabase
            .from("sms_settings")
            .upsert(
              {
                user_id: userId,
                ...settingsPayload,
              },
              { onConflict: "user_id" },
            )
            .select("user_id")
            .maybeSingle();

      if (saveResult.error) {
        logSmsSettingsSupabaseError("save failed", saveResult.error, {
          userId,
          mode: existingRowResult.data ? "update" : "upsert",
          payload: settingsPayload,
        });
        setStatusMessage("");
        Alert.alert(
          "SMS settings",
          "SMS text settings could not be saved. Please try again.",
        );
        return;
      }

      console.log("[SMS settings] save success", {
        userId,
        mode: existingRowResult.data ? "update" : "upsert",
      });
      setStatusMessage("SMS settings saved.");
    } catch (error) {
      logSmsSettingsSupabaseError(
        "save exception",
        error instanceof Error ? { message: error.message } : null,
      );
      setStatusMessage("");
      Alert.alert(
        "SMS settings",
        "SMS text settings could not be saved. Please try again.",
      );
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

      {!isPaid && ENABLE_PRO ? (
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
            SMS appointment texts are included with Schedova Pro. SMS messaging
            is locked on Free.
          </Text>
          <Pressable
            onPress={() => {
              openSchedovaProScreen();
            }}
            style={{
              backgroundColor: colors.primary,
              borderRadius: 12,
              padding: 14,
              alignItems: "center",
              marginTop: 14,
            }}
          >
            <Text style={{ color: "#FFFFFF", fontWeight: "900" }}>
              Upgrade to Schedova Pro
            </Text>
          </Pressable>
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
