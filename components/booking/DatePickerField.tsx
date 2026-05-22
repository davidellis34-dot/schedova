import DateTimePicker, {
    DateTimePickerEvent,
} from "@react-native-community/datetimepicker";
import { useState } from "react";
import { Pressable, Text } from "react-native";

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

  function handleDateChange(event: DateTimePickerEvent, selectedDate?: Date) {
    setShowPicker(false);

    if (event.type !== "set" || !selectedDate) return;

    onChange(dateObjectToDateString(selectedDate));
  }

  return (
    <>
      <PickerBox label="Date" colors={colors}>
        <Pressable
          onPress={() => setShowPicker(true)}
          style={{ padding: isTablet ? 24 : 16 }}
        >
          <Text style={{ color: colors.text, fontWeight: "800" }}>
            {cleanDateOnly(value) || "Choose date"}
          </Text>
        </Pressable>
      </PickerBox>

      {showPicker && (
        <DateTimePicker
          value={dateStringToLocalDate(value)}
          mode="date"
          display="default"
          onChange={handleDateChange}
        />
      )}
    </>
  );
}
