import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useState } from "react";
import { Alert, Pressable, ScrollView, Switch, Text, View } from "react-native";
import { Dropdown } from "react-native-element-dropdown";
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

const TIME_OPTIONS = [
  "00:00",
  "01:00",
  "02:00",
  "03:00",
  "04:00",
  "05:00",
  "06:00",
  "07:00",
  "08:00",
  "09:00",
  "10:00",
  "11:00",
  "12:00",
  "13:00",
  "14:00",
  "15:00",
  "16:00",
  "17:00",
  "18:00",
  "19:00",
  "20:00",
  "21:00",
  "22:00",
  "23:00",
];

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

export default function AvailabilitySettingsScreen() {
  const router = useRouter();
  const { colors } = useAppTheme();

  const [rules, setRules] = useState<AvailabilityRule[]>([]);
  const [saving, setSaving] = useState(false);

  const timeOptions = TIME_OPTIONS.map((time) => ({
    label: time,
    value: time,
  }));

  useFocusEffect(
    useCallback(() => {
      loadAvailability();
    }, []),
  );

  function defaultRules(): AvailabilityRule[] {
    return DAYS.map((_, index) => ({
      day_of_week: index,
      is_available: true,
      start_time: "09:00",
      end_time: "17:00",
    }));
  }

  async function loadAvailability() {
    const { data: userData } = await supabase.auth.getUser();
    const userId = userData.user?.id;

    if (!userId) {
      setRules(defaultRules());
      return;
    }

    const { data, error } = await supabase
      .from("availability_rules")
      .select("*")
      .eq("user_id", userId)
      .order("day_of_week");

    if (error) {
      console.log("🔥 LOAD AVAILABILITY ERROR:", error.message);
      setRules(defaultRules());
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

    setSaving(true);

    try {
      const { data: userData } = await supabase.auth.getUser();
      const userId = userData.user?.id;

      if (!userId) {
        Alert.alert("Login Required", "Please sign in to save availability.");
        return;
      }

      for (const rule of rules) {
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
            .eq("id", rule.id);

          if (error) throw error;
        } else {
          const { error } = await supabase
            .from("availability_rules")
            .insert(ruleData);

          if (error) throw error;
        }
      }

      Alert.alert("Saved", "Availability updated.");
      router.push("/settings");
    } catch (error: any) {
      console.log("🔥 SAVE AVAILABILITY ERROR:", error?.message || error);
      Alert.alert("Error", error?.message || "Could not save availability.");
    } finally {
      setSaving(false);
    }
  }

  function TimeDropdown({
    value,
    onChange,
  }: {
    value: string;
    onChange: (value: string) => void;
  }) {
    return (
      <Dropdown
        style={{
          borderWidth: 1,
          borderColor: colors.border,
          borderRadius: 12,
          padding: 14,
          backgroundColor: colors.card,
          minHeight: 56,
        }}
        containerStyle={{
          backgroundColor: colors.card,
          borderColor: colors.border,
        }}
        itemTextStyle={{
          color: colors.text,
        }}
        selectedTextStyle={{
          color: colors.text,
          fontSize: 16,
          fontWeight: "bold",
        }}
        placeholderStyle={{
          color: colors.mutedText,
        }}
        activeColor={colors.background}
        data={timeOptions}
        labelField="label"
        valueField="value"
        value={value}
        onChange={(item) => onChange(item.value)}
      />
    );
  }

  return (
    <ScrollView
      style={{
        flex: 1,
        backgroundColor: colors.background,
        padding: 20,
      }}
    >
      <Text
        style={{
          fontSize: 34,
          fontWeight: "bold",
          color: colors.text,
          marginBottom: 24,
        }}
      >
        Availability
      </Text>

      {rules.map((rule) => (
        <View
          key={rule.day_of_week}
          style={{
            backgroundColor: colors.card,
            padding: 18,
            borderRadius: 18,
            marginBottom: 18,
            borderWidth: 1,
            borderColor: colors.border,
          }}
        >
          <View
            style={{
              flexDirection: "row",
              justifyContent: "space-between",
              alignItems: "center",
              marginBottom: 18,
            }}
          >
            <Text
              style={{
                color: colors.text,
                fontSize: 24,
                fontWeight: "bold",
              }}
            >
              {DAYS[rule.day_of_week]}
            </Text>

            <Switch
              value={rule.is_available}
              onValueChange={(value) =>
                updateRule(rule.day_of_week, "is_available", value)
              }
            />
          </View>

          {rule.is_available ? (
            <>
              <Text
                style={{
                  color: colors.text,
                  fontWeight: "bold",
                  marginBottom: 8,
                  fontSize: 16,
                }}
              >
                Start Time
              </Text>

              <View style={{ marginBottom: 16 }}>
                <TimeDropdown
                  value={rule.start_time}
                  onChange={(value) =>
                    updateRule(rule.day_of_week, "start_time", value)
                  }
                />
              </View>

              <Text
                style={{
                  color: colors.text,
                  fontWeight: "bold",
                  marginBottom: 8,
                  fontSize: 16,
                }}
              >
                End Time
              </Text>

              <TimeDropdown
                value={rule.end_time}
                onChange={(value) =>
                  updateRule(rule.day_of_week, "end_time", value)
                }
              />
            </>
          ) : (
            <Text
              style={{
                color: colors.mutedText,
                fontSize: 16,
                marginTop: 4,
              }}
            >
              Not available this day
            </Text>
          )}
        </View>
      ))}

      <Pressable
        disabled={saving}
        onPress={saveAvailability}
        style={{
          backgroundColor: saving ? "#94A3B8" : colors.primary,
          padding: 16,
          borderRadius: 14,
          alignItems: "center",
          marginTop: 8,
          marginBottom: 14,
        }}
      >
        <Text
          style={{
            color: "#FFFFFF",
            fontWeight: "bold",
            fontSize: 16,
          }}
        >
          {saving ? "Saving..." : "Save Availability"}
        </Text>
      </Pressable>

      <Pressable
        onPress={() => router.push("/settings")}
        style={{
          backgroundColor: colors.card,
          padding: 16,
          borderRadius: 14,
          alignItems: "center",
          marginBottom: 40,
          borderWidth: 1,
          borderColor: colors.border,
        }}
      >
        <Text
          style={{
            color: colors.text,
            fontWeight: "bold",
            fontSize: 16,
          }}
        >
          Back to Settings
        </Text>
      </Pressable>
    </ScrollView>
  );
}
