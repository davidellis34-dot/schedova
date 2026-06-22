import { useMemo, useState } from "react";
import { FlatList, Pressable, Text, View } from "react-native";
import { PickerModal } from "../PickerModal";
import type { ThemeColors } from "./types";

type Props = {
  label: string;
  value: string;
  onChange: (time: string) => void;
  colors: ThemeColors;
  use24Hour: boolean;
  marginTop?: number;
  intervalMinutes?: number;
  helperText?: string;
};

function formatTimeLabel(time: string, use24Hour: boolean) {
  if (use24Hour) return time;

  const [hourText, minuteText] = time.split(":");
  const hour = Number(hourText);
  const minute = Number(minuteText);

  if (Number.isNaN(hour) || Number.isNaN(minute)) return time;

  const suffix = hour >= 12 ? "PM" : "AM";
  const displayHour = hour % 12 || 12;

  return `${displayHour}:${String(minute).padStart(2, "0")} ${suffix}`;
}

function buildTimeOptions(intervalMinutes: number, use24Hour: boolean) {
  const options: { label: string; value: string }[] = [];
  const safeInterval =
    Number.isFinite(intervalMinutes) && intervalMinutes > 0
      ? Math.max(5, Math.min(240, Math.round(intervalMinutes)))
      : 30;

  for (let minutes = 0; minutes < 24 * 60; minutes += safeInterval) {
    const hour = Math.floor(minutes / 60);
    const minute = minutes % 60;

    const value = `${String(hour).padStart(2, "0")}:${String(minute).padStart(
      2,
      "0",
    )}`;

    options.push({
      label: formatTimeLabel(value, use24Hour),
      value,
    });
  }

  return options;
}

function timeToMinutes(time: string) {
  const [hourText, minuteText] = String(time || "").slice(0, 5).split(":");
  const hours = Number(hourText);
  const minutes = Number(minuteText);

  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null;

  return hours * 60 + minutes;
}

function getSelectedIndex(options: { value: string }[], value: string) {
  const exactIndex = options.findIndex((item) => item.value === value);
  if (exactIndex >= 0) return exactIndex;

  const selectedMinutes = timeToMinutes(value);
  if (selectedMinutes === null) return 0;

  let nearestIndex = 0;
  let nearestDistance = Number.POSITIVE_INFINITY;

  options.forEach((item, index) => {
    const optionMinutes = timeToMinutes(item.value);
    if (optionMinutes === null) return;

    const distance = Math.abs(optionMinutes - selectedMinutes);
    if (distance < nearestDistance) {
      nearestDistance = distance;
      nearestIndex = index;
    }
  });

  return nearestIndex;
}

export function TimeDropdown({
  label,
  value,
  onChange,
  colors,
  use24Hour,
  marginTop = 0,
  intervalMinutes = 30,
  helperText,
}: Props) {
  const [open, setOpen] = useState(false);

  const timeOptions = useMemo(
    () => buildTimeOptions(intervalMinutes, use24Hour),
    [intervalMinutes, use24Hour],
  );

  const selectedLabel =
    timeOptions.find((item) => item.value === value)?.label ||
    (timeToMinutes(value) !== null
      ? formatTimeLabel(value, use24Hour)
      : "Select time");

  const selectedIndex = getSelectedIndex(timeOptions, value);

  return (
    <View style={{ marginTop, marginBottom: 4 }}>
      <Text
        style={{
          color: colors.text,
          fontWeight: "800",
          marginBottom: 8,
        }}
      >
        {label}
      </Text>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        onPress={() => setOpen(true)}
        style={{
          minHeight: 56,
          paddingHorizontal: 14,
          backgroundColor: colors.card,
          borderWidth: 1,
          borderColor: colors.border,
          borderRadius: 14,
          justifyContent: "center",
        }}
      >
        <Text
          style={{
            color: colors.text,
            fontSize: 16,
            fontWeight: "700",
          }}
        >
          {selectedLabel}
        </Text>
      </Pressable>

      {helperText ? (
        <Text
          style={{
            color: colors.mutedText,
            fontSize: 12,
            marginTop: 6,
            paddingHorizontal: 2,
          }}
        >
          {helperText}
        </Text>
      ) : null}

      <PickerModal
        visible={open}
        animationType="fade"
        onDismiss={() => setOpen(false)}
        backdropAccessibilityLabel={`Close ${label} picker`}
        contentStyle={{
          backgroundColor: colors.background,
          borderRadius: 18,
          borderWidth: 1,
          borderColor: colors.border,
          maxHeight: "70%",
          overflow: "hidden",
        }}
      >
        <View
          style={{
            padding: 16,
            borderBottomWidth: 1,
            borderBottomColor: colors.border,
          }}
        >
          <Text
            style={{
              color: colors.text,
              fontSize: 20,
              fontWeight: "900",
            }}
          >
            {label}
          </Text>
        </View>

        <FlatList
          data={timeOptions}
          keyExtractor={(item) => item.value}
          initialScrollIndex={selectedIndex}
          getItemLayout={(_, index) => ({
            length: 52,
            offset: 52 * index,
            index,
          })}
          keyboardShouldPersistTaps="handled"
          renderItem={({ item }) => {
            const selected = item.value === value;

            return (
              <Pressable
                onPress={() => {
                  onChange(item.value);
                  setOpen(false);
                }}
                style={{
                  height: 52,
                  justifyContent: "center",
                  paddingHorizontal: 18,
                  backgroundColor: selected ? colors.primary : colors.background,
                }}
              >
                <Text
                  style={{
                    color: selected ? "#FFFFFF" : colors.text,
                    fontSize: 16,
                    fontWeight: selected ? "900" : "600",
                  }}
                >
                  {item.label}
                </Text>
              </Pressable>
            );
          }}
        />

        <Pressable
          onPress={() => setOpen(false)}
          style={{
            padding: 16,
            alignItems: "center",
            borderTopWidth: 1,
            borderTopColor: colors.border,
          }}
        >
          <Text style={{ color: colors.mutedText, fontWeight: "900" }}>
            Cancel
          </Text>
        </Pressable>
      </PickerModal>
    </View>
  );
}

export default TimeDropdown;
