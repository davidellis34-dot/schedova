import AsyncStorage from "@react-native-async-storage/async-storage";
import { Picker } from "@react-native-picker/picker";
import { ReactNode, useEffect, useState } from "react";
import { Alert, Pressable, ScrollView, Text, View } from "react-native";
import { useAppTheme } from "../../lib/useAppTheme";

export default function CalendarSettingsScreen() {
  const { colors } = useAppTheme();

  const [startHour, setStartHour] = useState("7");
  const [endHour, setEndHour] = useState("19");
  const [interval, setIntervalValue] = useState("30");
  const [timeFormat, setTimeFormat] = useState("12");

  useEffect(() => {
    loadSettings();
  }, []);

  async function loadSettings() {
    const savedStart = await AsyncStorage.getItem("calendar_start_hour");
    const savedEnd = await AsyncStorage.getItem("calendar_end_hour");
    const savedInterval = await AsyncStorage.getItem("calendar_interval");
    const savedTimeFormat = await AsyncStorage.getItem("time_format");

    if (savedStart) setStartHour(savedStart);
    if (savedEnd) setEndHour(savedEnd);
    if (savedInterval) setIntervalValue(savedInterval);
    if (savedTimeFormat) setTimeFormat(savedTimeFormat);
  }

  async function saveSettings() {
    await AsyncStorage.setItem("calendar_start_hour", startHour);
    await AsyncStorage.setItem("calendar_end_hour", endHour);
    await AsyncStorage.setItem("calendar_interval", interval);
    await AsyncStorage.setItem("time_format", timeFormat);

    Alert.alert("Saved", "Calendar settings updated.");
  }

  const hourOptions = [
    ["12 AM", "0"],
    ["1 AM", "1"],
    ["2 AM", "2"],
    ["3 AM", "3"],
    ["4 AM", "4"],
    ["5 AM", "5"],
    ["6 AM", "6"],
    ["7 AM", "7"],
    ["8 AM", "8"],
    ["9 AM", "9"],
    ["10 AM", "10"],
    ["11 AM", "11"],
    ["12 PM", "12"],
    ["1 PM", "13"],
    ["2 PM", "14"],
    ["3 PM", "15"],
    ["4 PM", "16"],
    ["5 PM", "17"],
    ["6 PM", "18"],
    ["7 PM", "19"],
    ["8 PM", "20"],
    ["9 PM", "21"],
    ["10 PM", "22"],
    ["11 PM", "23"],
    ["12 AM Next Day", "24"],
    ["1 AM Next Day", "25"],
    ["2 AM Next Day", "26"],
    ["3 AM Next Day", "27"],
    ["4 AM Next Day", "28"],
    ["5 AM Next Day", "29"],
    ["6 AM Next Day", "30"],
  ];

  function PickerBox({
    label,
    value,
    onChange,
    children,
  }: {
    label: string;
    value: string;
    onChange: (value: string) => void;
    children: ReactNode;
  }) {
    return (
      <View style={{ marginBottom: 18 }}>
        <Text
          style={{ color: colors.text, fontWeight: "700", marginBottom: 8 }}
        >
          {label}
        </Text>

        <View
          style={{
            borderWidth: 1,
            borderColor: colors.border,
            borderRadius: 14,
            backgroundColor: colors.card,
            overflow: "hidden",
            minHeight: 56,
            justifyContent: "center",
          }}
        >
          <Picker
            selectedValue={value}
            onValueChange={onChange}
            dropdownIconColor={colors.text}
            style={{
              color: colors.text,
              backgroundColor: colors.card,
            }}
          >
            {children}
          </Picker>
        </View>
      </View>
    );
  }

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.background }}
      contentContainerStyle={{ padding: 20, paddingBottom: 40 }}
    >
      <Text
        style={{
          fontSize: 30,
          fontWeight: "bold",
          marginBottom: 24,
          color: colors.text,
        }}
      >
        Calendar Settings
      </Text>

      <View
        style={{
          backgroundColor: colors.card,
          padding: 18,
          borderRadius: 16,
          marginBottom: 20,
          borderWidth: 1,
          borderColor: colors.border,
        }}
      >
        <PickerBox label="Start Time" value={startHour} onChange={setStartHour}>
          {hourOptions.map(([label, value]) => (
            <Picker.Item key={value} label={label} value={value} />
          ))}
        </PickerBox>

        <PickerBox label="End Time" value={endHour} onChange={setEndHour}>
          {hourOptions.map(([label, value]) => (
            <Picker.Item key={value} label={label} value={value} />
          ))}
        </PickerBox>

        <PickerBox
          label="Time Interval"
          value={interval}
          onChange={setIntervalValue}
        >
          <Picker.Item label="15 minutes" value="15" />
          <Picker.Item label="30 minutes" value="30" />
          <Picker.Item label="60 minutes" value="60" />
        </PickerBox>

        <PickerBox
          label="Time Format"
          value={timeFormat}
          onChange={setTimeFormat}
        >
          <Picker.Item label="12-hour time, like 5:30 PM" value="12" />
          <Picker.Item label="24-hour time, like 17:30" value="24" />
        </PickerBox>

        <Pressable
          onPress={saveSettings}
          style={{
            backgroundColor: colors.primary,
            padding: 16,
            borderRadius: 12,
            alignItems: "center",
            marginTop: 6,
          }}
        >
          <Text style={{ color: "#FFFFFF", fontWeight: "bold" }}>
            Save Calendar Settings
          </Text>
        </Pressable>
      </View>
    </ScrollView>
  );
}
