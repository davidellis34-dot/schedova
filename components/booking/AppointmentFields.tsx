import { Text, View } from "react-native";
import { DatePickerField } from "./DatePickerField";
import { PickerBox } from "./PickerBox";
import { TimeDropdown } from "./TimeDropdown";
import type { ThemeColors } from "./types";

type Props = {
  appointmentDate: string;
  setAppointmentDate: (date: string) => void;
  appointmentTime: string;
  setAppointmentTime: (time: string) => void;
  endTime: string;
  theme: ThemeColors;
  intervalMinutes?: number;
};

export default function AppointmentFields({
  appointmentDate,
  setAppointmentDate,
  appointmentTime,
  setAppointmentTime,
  endTime,
  theme,
  intervalMinutes = 30,
}: Props) {
  return (
    <View
      style={{
        backgroundColor: theme.card,
        borderRadius: 16,
        padding: 16,
        marginTop: 16,
        borderWidth: 1,
        borderColor: theme.border,
      }}
    >
      <DatePickerField
        colors={theme}
        value={appointmentDate}
        onChange={setAppointmentDate}
        isTablet={false}
      />

      <TimeDropdown
        label="Start Time"
        value={appointmentTime}
        onChange={setAppointmentTime}
        colors={theme}
        marginTop={16}
        use24Hour={false}
      />

      <PickerBox label="End Time" colors={theme}>
        <Text style={{ color: theme.text, fontSize: 16 }}>
          {endTime || "--:--"}
        </Text>
      </PickerBox>
    </View>
  );
}
