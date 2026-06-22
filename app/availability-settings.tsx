import { useRouter } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import { Alert, Switch, Text, View } from "react-native";
import { AppSelectField } from "../components/AppSelectField";
import {
  AppButton,
  AppCard,
  AppScreen,
  ProPreviewCard,
  ScreenHeader,
  createSchedovaUiTheme,
} from "../components/ui";
import { canUseFeature, useFeatureAccess } from "../lib/featureAccess";
import { ENABLE_PRO } from "../lib/proFeatureFlag";
import {
  openSchedovaProScreen,
  PRO_UPSELL_COPY,
  showProUpgradePrompt,
} from "../lib/proUpsell";
import { supabase } from "../lib/supabase";
import { useAppTheme } from "../lib/useAppTheme";

const DAYS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

const TIME_OPTIONS = Array.from({ length: 24 }, (_, hour) => {
  const value = `${String(hour).padStart(2, "0")}:00`;
  return { label: value, value };
});

type AvailabilityRule = {
  id?: string;
  user_id?: string;
  day_of_week: number;
  is_available: boolean;
  start_time: string;
  end_time: string;
};

function toSqlTime(value: string) {
  if (!value) return "09:00:00";
  if (value.length === 5) return `${value}:00`;
  return value.slice(0, 8);
}

function toPickerTime(value: string | null | undefined, fallback: string) {
  if (!value) return fallback;
  return String(value).slice(0, 5);
}

function defaultRules(): AvailabilityRule[] {
  return DAYS.map((_, index) => ({
    day_of_week: index,
    is_available: true,
    start_time: "09:00",
    end_time: "17:00",
  }));
}

export default function AvailabilitySettingsScreen() {
  const router = useRouter();
  const { colors } = useAppTheme();
  const theme = createSchedovaUiTheme(colors);
  const { spacing, radii, typography } = theme;
  useFeatureAccess();
  const customHoursAvailable = canUseFeature("customBusinessHours");

  const [rules, setRules] = useState<AvailabilityRule[]>(defaultRules());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const timeOptions = useMemo(() => TIME_OPTIONS, []);
  const selectColors = useMemo(
    () => ({
      background: colors.background,
      card: colors.card,
      text: colors.text,
      mutedText: colors.mutedText,
      border: colors.border,
      primary: colors.primary,
    }),
    [
      colors.background,
      colors.border,
      colors.card,
      colors.mutedText,
      colors.primary,
      colors.text,
    ],
  );

  useEffect(() => {
    if (!customHoursAvailable) {
      setLoading(false);
      return;
    }

    loadAvailability();
  }, [customHoursAvailable]);

  async function loadAvailability() {
    setLoading(true);

    const { data: userData } = await supabase.auth.getUser();
    const userId = userData.user?.id;

    if (!userId) {
      setRules(defaultRules());
      setLoading(false);
      return;
    }

    const { data, error } = await supabase
      .from("availability_rules")
      .select("*")
      .eq("user_id", userId)
      .order("day_of_week");

    if (error) {
      console.log("LOAD AVAILABILITY ERROR:", error.message);
      setRules(defaultRules());
      setLoading(false);
      return;
    }

    const savedRules = data || [];

    const mergedRules = defaultRules().map((defaultRule) => {
      const saved = savedRules.find(
        (item: any) => Number(item.day_of_week) === defaultRule.day_of_week,
      );

      if (!saved) return defaultRule;

      return {
        id: saved.id,
        user_id: saved.user_id,
        day_of_week: Number(saved.day_of_week),
        is_available:
          saved.is_available === undefined || saved.is_available === null
            ? true
            : Boolean(saved.is_available),
        start_time: toPickerTime(saved.start_time, "09:00"),
        end_time: toPickerTime(saved.end_time, "17:00"),
      };
    });

    setRules(mergedRules);
    setLoading(false);
  }

  function updateRule(
    dayIndex: number,
    field: "is_available" | "start_time" | "end_time",
    value: boolean | string,
  ) {
    setRules((currentRules) =>
      currentRules.map((rule) =>
        rule.day_of_week === dayIndex ? { ...rule, [field]: value } : rule,
      ),
    );
  }

  async function saveAvailability() {
    if (saving) return;

    if (!customHoursAvailable) {
      if (ENABLE_PRO) {
        showProUpgradePrompt(PRO_UPSELL_COPY.customBusinessHours);
      } else {
        Alert.alert(
          "Availability",
          "Custom availability is not available in this version of Schedova.",
        );
      }
      return;
    }

    setSaving(true);

    try {
      const { data: userData } = await supabase.auth.getUser();
      const userId = userData.user?.id;

      if (!userId) {
        Alert.alert("Login Required", "Please sign in to save availability.");
        return;
      }

      for (const rule of rules) {
        if (
          rule.is_available &&
          toSqlTime(rule.start_time) >= toSqlTime(rule.end_time)
        ) {
          Alert.alert(
            "Invalid Time",
            `${DAYS[rule.day_of_week]} has an end time before the start time.`,
          );
          return;
        }

        const ruleData = {
          user_id: userId,
          day_of_week: rule.day_of_week,
          is_available: rule.is_available,
          start_time: toSqlTime(rule.start_time),
          end_time: toSqlTime(rule.end_time),
        };

        if (rule.id) {
          const { error } = await supabase
            .from("availability_rules")
            .update(ruleData)
            .eq("id", rule.id)
            .eq("user_id", userId);

          if (error) throw error;
        } else {
          const { error } = await supabase
            .from("availability_rules")
            .insert(ruleData);

          if (error) throw error;
        }
      }

      router.push("/settings");
    } catch (error: any) {
      console.log("SAVE AVAILABILITY ERROR:", error?.message || error);
      Alert.alert("Error", error?.message || "Could not save availability.");
    } finally {
      setSaving(false);
    }
  }

  if (!customHoursAvailable) {
    return (
      <AppScreen scroll backgroundColor={colors.background}>
        <ScreenHeader
          title="Availability"
          subtitle="Set the days and hours your business is open."
          showBack
          onBackPress={() => router.push("/settings")}
        />

        {ENABLE_PRO ? (
          <ProPreviewCard
            message={PRO_UPSELL_COPY.customBusinessHours}
            features={[
              "Set custom hours for each day",
              "Keep closed days clear on your calendar",
              "Control when clients can be booked",
            ]}
            onPress={openSchedovaProScreen}
          />
        ) : (
          <AppCard>
            <Text
              style={{
                color: colors.text,
                fontSize: typography.sizes.body,
                fontWeight: typography.weights.heavy,
              }}
            >
              Custom availability unavailable
            </Text>
            <Text
              style={{
                color: colors.mutedText,
                lineHeight: 20,
                marginTop: spacing.sm,
              }}
            >
              Custom availability is not available in this version of Schedova.
            </Text>
          </AppCard>
        )}

        <AppButton
          title="Back"
          variant="ghost"
          onPress={() => router.push("/settings")}
          style={{ marginTop: spacing.md }}
        />
      </AppScreen>
    );
  }

  function TimeDropdown({
    label,
    value,
    onChange,
  }: {
    label: string;
    value: string;
    onChange: (value: string) => void;
  }) {
    return (
      <AppSelectField
        label={label}
        value={value}
        options={timeOptions}
        onChange={onChange}
        colors={selectColors}
        title={label}
      />
    );
  }

  return (
    <AppScreen
      scroll
      backgroundColor={colors.background}
      keyboardShouldPersistTaps="handled"
      nestedScrollEnabled
    >
      <ScreenHeader
        title="Availability"
        subtitle="Set the days and hours your business is open."
        showBack
      />

      {loading ? (
        <AppCard>
          <Text style={{ color: colors.mutedText }}>Loading availability...</Text>
        </AppCard>
      ) : (
        <View style={{ gap: spacing.md }}>
          {rules.map((rule) => (
            <AppCard
              key={rule.day_of_week}
              style={{
                opacity: rule.is_available ? 1 : 0.82,
              }}
            >
              <View
                style={{
                  flexDirection: "row",
                  justifyContent: "space-between",
                  alignItems: "center",
                  gap: spacing.md,
                  marginBottom: rule.is_available ? spacing.md : 0,
                }}
              >
                <View style={{ flex: 1 }}>
                  <Text
                    style={{
                      fontSize: typography.sizes.cardTitle,
                      fontWeight: typography.weights.heavy,
                      color: colors.text,
                    }}
                  >
                    {DAYS[rule.day_of_week]}
                  </Text>

                  <Text
                    style={{
                      color: rule.is_available
                        ? colors.mutedText
                        : theme.colors.disabled,
                      marginTop: spacing.xs,
                    }}
                  >
                    {rule.is_available
                      ? `${rule.start_time} - ${rule.end_time}`
                      : "Closed"}
                  </Text>
                </View>

                <View
                  style={{
                    borderWidth: 1,
                    borderColor: rule.is_available
                      ? colors.primary
                      : colors.border,
                    borderRadius: radii.pill,
                    paddingHorizontal: spacing.md,
                    paddingVertical: spacing.xs,
                    backgroundColor: rule.is_available
                      ? "rgba(15, 118, 110, 0.18)"
                      : "rgba(100, 116, 139, 0.14)",
                  }}
                >
                  <Text
                    style={{
                      color: rule.is_available ? colors.text : colors.mutedText,
                      fontSize: typography.sizes.caption,
                      fontWeight: typography.weights.heavy,
                    }}
                  >
                    {rule.is_available ? "Open" : "Closed"}
                  </Text>
                </View>

                <Switch
                  value={rule.is_available}
                  onValueChange={(value) =>
                    updateRule(rule.day_of_week, "is_available", value)
                  }
                />
              </View>

              {rule.is_available && (
                <View style={{ flexDirection: "row", gap: spacing.sm }}>
                  <View style={{ flex: 1 }}>
                    <TimeDropdown
                      label="Start"
                      value={rule.start_time}
                      onChange={(value) =>
                        updateRule(rule.day_of_week, "start_time", value)
                      }
                    />
                  </View>

                  <View style={{ flex: 1 }}>
                    <TimeDropdown
                      label="End"
                      value={rule.end_time}
                      onChange={(value) =>
                        updateRule(rule.day_of_week, "end_time", value)
                      }
                    />
                  </View>
                </View>
              )}
            </AppCard>
          ))}
        </View>
      )}

      <AppButton
        title={saving ? "Saving..." : "Save Availability"}
        onPress={saveAvailability}
        disabled={saving}
        loading={saving}
        style={{ marginTop: spacing.lg }}
      />
    </AppScreen>
  );
}
