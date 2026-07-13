import { Ionicons } from "@expo/vector-icons";
import { useState } from "react";
import { FlatList, Pressable, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { PickerModal } from "./PickerModal";

type Option = {
  label: string;
  value: string;
  description?: string;
};

type SelectColors = {
  background: string;
  card: string;
  text: string;
  mutedText: string;
  border: string;
  primary: string;
};

type Props = {
  label: string;
  value: string;
  options: Option[];
  onChange: (value: string) => void;
  colors: SelectColors;
  title?: string;
};

export function AppSelectField({
  label,
  value,
  options,
  onChange,
  colors,
  title = label,
}: Props) {
  const insets = useSafeAreaInsets();
  const [open, setOpen] = useState(false);
  const [draftValue, setDraftValue] = useState(value);

  const selectedLabel =
    options.find((option) => option.value === value)?.label || "Select";

  function openSelector() {
    setDraftValue(value);
    setOpen(true);
  }

  function cancel() {
    setDraftValue(value);
    setOpen(false);
  }

  function done() {
    onChange(draftValue);
    setOpen(false);
  }

  return (
    <View style={{ marginBottom: 18 }}>
      <Text style={{ color: colors.text, fontWeight: "700", marginBottom: 8 }}>
        {label}
      </Text>

      <Pressable
        accessibilityRole="button"
        onPress={openSelector}
        style={{
          minHeight: 56,
          borderWidth: 1,
          borderColor: colors.border,
          borderRadius: 14,
          backgroundColor: colors.card,
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
            flex: 1,
            marginRight: 12,
          }}
        >
          {selectedLabel}
        </Text>
        <Ionicons name="chevron-forward" size={20} color={colors.mutedText} />
      </Pressable>

      <PickerModal
        visible={open}
        align="bottom"
        animationType="slide"
        onDismiss={cancel}
        backdropAccessibilityLabel={`Close ${title} picker`}
        contentStyle={{
          backgroundColor: colors.background,
          borderTopLeftRadius: 20,
          borderTopRightRadius: 20,
          borderWidth: 1,
          borderColor: colors.border,
          maxHeight: "72%",
          paddingBottom: insets.bottom + 12,
          overflow: "hidden",
        }}
      >
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "space-between",
            paddingHorizontal: 18,
            paddingVertical: 14,
            borderBottomWidth: 1,
            borderBottomColor: colors.border,
          }}
        >
          <Pressable onPress={cancel} hitSlop={10}>
            <Text style={{ color: colors.mutedText, fontWeight: "800" }}>
              Cancel
            </Text>
          </Pressable>
          <Text
            style={{
              color: colors.text,
              fontSize: 18,
              fontWeight: "900",
            }}
          >
            {title}
          </Text>
          <Pressable onPress={done} hitSlop={10}>
            <Text style={{ color: colors.primary, fontWeight: "900" }}>
              Done
            </Text>
          </Pressable>
        </View>

        <FlatList
          data={options}
          keyExtractor={(item) => item.value}
          keyboardShouldPersistTaps="handled"
          renderItem={({ item }) => {
            const selected = item.value === draftValue;

            return (
              <Pressable
                accessibilityRole="button"
                onPress={() => setDraftValue(item.value)}
                style={{
                  minHeight: 56,
                  paddingHorizontal: 18,
                  paddingVertical: 12,
                  justifyContent: "center",
                  backgroundColor: selected ? colors.primary : colors.background,
                }}
              >
                <Text
                  style={{
                    color: selected ? "#FFFFFF" : colors.text,
                    fontSize: 16,
                    fontWeight: selected ? "900" : "700",
                  }}
                >
                  {item.label}
                </Text>
                {item.description ? (
                  <Text
                    style={{
                      color: selected ? "#FFFFFF" : colors.mutedText,
                      marginTop: 4,
                    }}
                  >
                    {item.description}
                  </Text>
                ) : null}
              </Pressable>
            );
          }}
        />
      </PickerModal>
    </View>
  );
}
