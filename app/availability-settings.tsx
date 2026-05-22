import { useRouter } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import { Alert, Pressable, ScrollView, Switch, Text, View } from "react-native";
import { Dropdown } from "react-native-element-dropdown";
import { canUseFeature } from "../lib/featureAccess";
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
  const customHoursAvailable = canUseFeature("customBusinessHours");

  const [rules, setRules] = useState<AvailabilityRule[]>(defaultRules());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const timeOptions = useMemo(() => TIME_OPTIONS, []);

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
      Alert.alert(
        "Schedova Pro",
        "Custom business hours are a Pro feature.",
      );
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

      Alert.alert("Saved", "Availability updated.");
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
      <ScrollView
        style={{ flex: 1, backgroundColor: colors.background }}
        contentContainerStyle={{ padding: 20, paddingBottom: 40 }}
      >
        <Text
          style={{
            fontSize: 30,
            fontWeight: "bold",
            marginBottom: 16,
            color: colors.text,
          }}
        >
          Availability Settings
        </Text>

        <View
          style={{
            backgroundColor: colors.card,
            borderWidth: 1,
            borderColor: colors.border,
            borderRadius: 16,
            padding: 18,
            marginBottom: 16,
          }}
        >
          <Text style={{ color: colors.text, fontSize: 20, fontWeight: "900" }}>
            Schedova Pro
          </Text>
          <Text style={{ color: colors.mutedText, marginTop: 8 }}>
            Custom business hours and blocked time are locked on Free.
          </Text>
        </View>

        <Pressable
          onPress={() => router.push("/settings")}
          style={{
            backgroundColor: colors.primary,
            padding: 14,
            borderRadius: 999,
            alignItems: "center",
          }}
        >
          <Text style={{ color: "#FFFFFF", fontWeight: "900" }}>Back</Text>
        </Pressable>
      </ScrollView>
    );
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
        maxHeight={300}
        showsVerticalScrollIndicator={false}
        data={timeOptions}
        labelField="label"
        valueField="value"
        value={value}
        onChange={(item) => onChange(item.value)}
        style={{
          borderWidth: 1,
          borderColor: colors.border,
          borderRadius: 12,
          paddingHorizontal: 12,
          backgroundColor: colors.card,
          minHeight: 52,
          flex: 1,
          width: "100%",
        }}
        containerStyle={{
          backgroundColor: colors.card,
          borderColor: colors.border,
          borderRadius: 12,
          overflow: "hidden",
          zIndex: 999,
          elevation: 10,
        }}
        itemTextStyle={{ color: colors.text }}
        selectedTextStyle={{
          color: colors.text,
          fontSize: 15,
          fontWeight: "700",
        }}
        placeholderStyle={{ color: colors.mutedText }}
        activeColor={colors.background}
      />
    );
  }

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.background }}
      contentContainerStyle={{ padding: 20, paddingBottom: 40 }}
      keyboardShouldPersistTaps="handled"
      nestedScrollEnabled
    >
      <Text
        style={{
          fontSize: 30,
          fontWeight: "bold",
          marginBottom: 8,
          color: colors.text,
        }}
      >
        Availability Settings
      </Text>

      <Text
        style={{
          fontSize: 15,
          color: colors.mutedText,
          marginBottom: 20,
          lineHeight: 22,
        }}
      >
        Choose which days your business accepts appointments.
      </Text>

      {loading ? (
        <Text style={{ color: colors.mutedText }}>Loading availability...</Text>
      ) : (
        rules.map((rule) => (
          <View
            key={rule.day_of_week}
            style={{
              backgroundColor: colors.card,
              borderRadius: 16,
              padding: 16,
              marginBottom: 14,
              borderWidth: 1,
              borderColor: colors.border,
            }}
          >
            <View
              style={{
                flexDirection: "row",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: rule.is_available ? 14 : 0,
              }}
            >
              <Text
                style={{
                  fontSize: 18,
                  fontWeight: "700",
                  color: colors.text,
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

            {rule.is_available && (
              <View style={{ flexDirection: "row", gap: 10 }}>
                <TimeDropdown
                  value={rule.start_time}
                  onChange={(value) =>
                    updateRule(rule.day_of_week, "start_time", value)
                  }
                />

                <TimeDropdown
                  value={rule.end_time}
                  onChange={(value) =>
                    updateRule(rule.day_of_week, "end_time", value)
                  }
                />
              </View>
            )}
          </View>
        ))
      )}

      <Pressable
        onPress={saveAvailability}
        disabled={saving}
        style={{
          backgroundColor: colors.primary,
          padding: 16,
          borderRadius: 14,
          alignItems: "center",
          marginTop: 10,
          opacity: saving ? 0.6 : 1,
        }}
      >
        <Text style={{ color: "#FFFFFF", fontWeight: "bold", fontSize: 16 }}>
          {saving ? "Saving..." : "Save Availability"}
        </Text>
      </Pressable>
    </ScrollView>
  );
}
