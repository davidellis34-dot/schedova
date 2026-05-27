import { useState } from "react";
import { Modal, Pressable, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { PickerBox } from "./PickerBox";
import type { EntryType, ThemeColors } from "./types";

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
};

export function EntryTypePicker({ value, onChange, colors }: Props) {
  const insets = useSafeAreaInsets();
  const [open, setOpen] = useState(false);

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

      <Modal
        visible={open}
        transparent
        animationType="fade"
        onRequestClose={() => setOpen(false)}
      >
        <View
          style={{
            flex: 1,
            backgroundColor: "rgba(0,0,0,0.45)",
            justifyContent: "center",
            paddingHorizontal: 20,
            paddingTop: insets.top + 20,
            paddingBottom: insets.bottom + 20,
          }}
        >
          <View
            style={{
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

            {ENTRY_TYPES.map((entryType) => {
              const selected = entryType.value === value;

              return (
                <Pressable
                  key={entryType.value}
                  accessibilityRole="button"
                  onPress={() => {
                    setOpen(false);
                    onChange(entryType.value);
                  }}
                  style={{
                    minHeight: 54,
                    justifyContent: "center",
                    paddingHorizontal: 18,
                    backgroundColor: selected
                      ? colors.primary
                      : colors.background,
                  }}
                >
                  <Text
                    style={{
                      color: selected ? "#FFFFFF" : colors.text,
                      fontSize: 16,
                      fontWeight: selected ? "900" : "700",
                    }}
                  >
                    {entryType.label}
                  </Text>
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
          </View>
        </View>
      </Modal>
    </>
  );
}
