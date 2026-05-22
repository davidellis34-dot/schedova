import { Picker } from "@react-native-picker/picker";

import { PickerBox } from "./PickerBox";
import type { EntryType, ThemeColors } from "./types";

function normalizeEntryType(value: string): EntryType {
  if (value === "blocked" || value === "blocked_time") return "blocked_time";
  if (value === "vacation") return "vacation";
  if (value === "personal") return "personal";
  return "appointment";
}

type Props = {
  value: EntryType;
  onChange: (value: EntryType) => void;
  colors: ThemeColors;
};

export function EntryTypePicker({ value, onChange, colors }: Props) {
  return (
    <PickerBox label="Entry Type" colors={colors}>
      <Picker
        selectedValue={value}
        onValueChange={(nextValue) =>
          onChange(normalizeEntryType(String(nextValue)))
        }
        dropdownIconColor={colors.text}
        dropdownIconRippleColor={colors.card}
        mode="dropdown"
        style={{
          color: colors.text,
          backgroundColor: colors.card,
        }}
      >
        <Picker.Item
          label="Appointment"
          value="appointment"
          color={colors.text}
          style={{ backgroundColor: colors.card, color: colors.text }}
        />
        <Picker.Item
          label="Blocked Time"
          value="blocked_time"
          color={colors.text}
          style={{ backgroundColor: colors.card, color: colors.text }}
        />
        <Picker.Item
          label="Vacation"
          value="vacation"
          color={colors.text}
          style={{ backgroundColor: colors.card, color: colors.text }}
        />
        <Picker.Item
          label="Personal Event"
          value="personal"
          color={colors.text}
          style={{ backgroundColor: colors.card, color: colors.text }}
        />
      </Picker>
    </PickerBox>
  );
}
