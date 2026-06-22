import { useState } from "react";
import { Pressable, Text, View } from "react-native";

import { PickerModal } from "../PickerModal";
import { PickerBox } from "./PickerBox";
import type { EntryType, ThemeColors } from "./types";
import { ENABLE_PRO } from "../../lib/proFeatureFlag";

const ENTRY_TYPES: { label: string; value: EntryType }[] = [
  { label: "Appointment", value: "appointment" },
  { label: "Blocked Time", value: "blocked_time" },
  { label: "Vacation", value: "vacation" },
  { label: "Personal Event", value: "personal" },
];

function entryTypeLabel(value: EntryType) {
  return (
    ENTRY_TYPES.find((entryType) => entryType.value === value)?.label ||
    "Appointment"
  );
}

type Props = {
  value: EntryType;
  onChange: (value: EntryType) => void;
  colors: ThemeColors;
  proLocked?: boolean;
};

export function EntryTypePicker({
  value,
  onChange,
  colors,
  proLocked = false,
}: Props) {
  const [open, setOpen] = useState(false);
  const visibleEntryTypes = ENABLE_PRO
    ? ENTRY_TYPES
    : ENTRY_TYPES.filter((entryType) => entryType.value === "appointment");

  return (
    <>
      <PickerBox label="Entry Type" colors={colors}>
        <Pressable
          accessibilityRole="button"
          onPress={() => setOpen(true)}
          style={{
            minHeight: 56,
            paddingHorizontal: 16,
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <Text
            style={{
              color: colors.text,
              fontSize: 16,
              fontWeight: "800",
            }}
          >
            {entryTypeLabel(value)}
          </Text>
          <Text
            style={{
              color: colors.mutedText,
              fontSize: 18,
              fontWeight: "900",
            }}
          >
            v
          </Text>
        </Pressable>
      </PickerBox>

      <PickerModal
        visible={open}
        animationType="fade"
        onDismiss={() => setOpen(false)}
        backdropAccessibilityLabel="Close entry type picker"
        contentStyle={{
          backgroundColor: colors.background,
          borderWidth: 1,
          borderColor: colors.border,
          borderRadius: 18,
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
            Entry Type
          </Text>
        </View>

        {visibleEntryTypes.map((entryType) => {
          const selected = entryType.value === value;
          const locked =
            ENABLE_PRO && proLocked && entryType.value !== "appointment";

          return (
            <Pressable
              key={entryType.value}
              accessibilityRole="button"
              accessibilityLabel={
                locked ? `${entryType.label}, Pro feature` : entryType.label
              }
              onPress={() => {
                setOpen(false);
                onChange(entryType.value);
              }}
              style={{
                minHeight: 54,
                alignItems: "center",
                flexDirection: "row",
                justifyContent: "space-between",
                paddingHorizontal: 18,
                backgroundColor: selected ? colors.primary : colors.background,
              }}
            >
              <Text
                style={{
                  color: selected
                    ? "#FFFFFF"
                    : locked
                      ? colors.mutedText
                      : colors.text,
                  fontSize: 16,
                  fontWeight: selected ? "900" : "700",
                }}
              >
                {entryType.label}
              </Text>

              {locked ? (
                <View
                  style={{
                    borderWidth: 1,
                    borderColor: selected ? "#FFFFFF" : colors.border,
                    borderRadius: 999,
                    paddingHorizontal: 10,
                    paddingVertical: 4,
                  }}
                >
                  <Text
                    style={{
                      color: selected ? "#FFFFFF" : colors.mutedText,
                      fontSize: 12,
                      fontWeight: "900",
                    }}
                  >
                    Pro
                  </Text>
                </View>
              ) : null}
            </Pressable>
          );
        })}

        <Pressable
          accessibilityRole="button"
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
    </>
  );
}
