import DateTimePicker, {
  DateTimePickerEvent,
} from "@react-native-community/datetimepicker";
import { useState } from "react";
import { Platform, Pressable, Text, View } from "react-native";

import { PickerModal } from "../PickerModal";
import {
  cleanDateOnly,
  dateObjectToDateString,
  dateStringToLocalDate,
} from "./dateUtils";
import { PickerBox } from "./PickerBox";
import type { ThemeColors } from "./types";

type Props = {
  colors: ThemeColors;
  value: string;
  onChange: (date: string) => void;
  isTablet: boolean;
};

export function DatePickerField({ colors, value, onChange, isTablet }: Props) {
  const [showPicker, setShowPicker] = useState(false);
  const [tempDate, setTempDate] = useState(dateStringToLocalDate(value));

  function openPicker() {
    setTempDate(dateStringToLocalDate(value));
    setShowPicker(true);
  }

  function handleAndroidDateChange(
    event: DateTimePickerEvent,
    selectedDate?: Date,
  ) {
    setShowPicker(false);

    if (event.type !== "set" || !selectedDate) return;

    onChange(dateObjectToDateString(selectedDate));
  }

  function cancelIosPicker() {
    setTempDate(dateStringToLocalDate(value));
    setShowPicker(false);
  }

  function confirmIosPicker() {
    onChange(dateObjectToDateString(tempDate));
    setShowPicker(false);
  }

  const field = (
    <PickerBox label="Date" colors={colors}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Date"
        accessibilityHint="Opens date picker"
        onPress={openPicker}
        style={{
          minHeight: 56,
          justifyContent: "center",
          paddingHorizontal: isTablet ? 24 : 16,
          paddingVertical: isTablet ? 18 : 14,
        }}
      >
        <Text style={{ color: colors.text, fontWeight: "800" }}>
          {cleanDateOnly(value) || "Choose date"}
        </Text>
      </Pressable>
    </PickerBox>
  );

  if (Platform.OS === "android") {
    return (
      <>
        {field}
        {showPicker ? (
          <DateTimePicker
            value={dateStringToLocalDate(value)}
            mode="date"
            display="default"
            onChange={handleAndroidDateChange}
          />
        ) : null}
      </>
    );
  }

  return (
    <>
      {field}
      {showPicker ? (
        <PickerModal
          visible
          animationType="fade"
          onDismiss={cancelIosPicker}
          backdropAccessibilityLabel="Cancel date selection"
          horizontalPadding={18}
          contentStyle={{
            backgroundColor: "#111827",
            borderRadius: 20,
            overflow: "hidden",
            borderWidth: 1,
            borderColor: "#374151",
            shadowColor: "#000000",
            shadowOffset: { width: 0, height: 16 },
            shadowOpacity: 0.35,
            shadowRadius: 24,
            elevation: 12,
          }}
        >
          <View
            style={{
              minHeight: 56,
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "space-between",
              paddingHorizontal: 18,
              borderBottomWidth: 1,
              borderBottomColor: "#374151",
            }}
          >
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Cancel"
              onPress={cancelIosPicker}
              style={{ paddingVertical: 12, paddingRight: 16 }}
            >
              <Text
                style={{
                  color: "#CBD5E1",
                  fontSize: 16,
                  fontWeight: "800",
                }}
              >
                Cancel
              </Text>
            </Pressable>

            <Text
              style={{
                color: "#FFFFFF",
                fontSize: 16,
                fontWeight: "900",
              }}
            >
              Select Date
            </Text>

            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Done"
              onPress={confirmIosPicker}
              style={{ paddingVertical: 12, paddingLeft: 16 }}
            >
              <Text
                style={{
                  color: colors.primary,
                  fontSize: 16,
                  fontWeight: "900",
                }}
              >
                Done
              </Text>
            </Pressable>
          </View>

          <DateTimePicker
            value={tempDate}
            mode="date"
            display="inline"
            themeVariant="dark"
            textColor="#FFFFFF"
            onChange={(_, selectedDate) => {
              if (selectedDate) setTempDate(selectedDate);
            }}
            style={{
              backgroundColor: "#111827",
              alignSelf: "stretch",
            }}
          />
        </PickerModal>
      ) : null}
    </>
  );
}
