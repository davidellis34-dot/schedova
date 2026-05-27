import AsyncStorage from "@react-native-async-storage/async-storage";
import { useEffect, useState } from "react";
import { Alert, Pressable, Text, View } from "react-native";
import { AppSelectField } from "../../components/AppSelectField";
import { AppScreen } from "../../components/layout/AppScreen";
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
    { label: "12 AM", value: "0" },
    { label: "1 AM", value: "1" },
    { label: "2 AM", value: "2" },
    { label: "3 AM", value: "3" },
    { label: "4 AM", value: "4" },
    { label: "5 AM", value: "5" },
    { label: "6 AM", value: "6" },
    { label: "7 AM", value: "7" },
    { label: "8 AM", value: "8" },
    { label: "9 AM", value: "9" },
    { label: "10 AM", value: "10" },
    { label: "11 AM", value: "11" },
    { label: "12 PM", value: "12" },
    { label: "1 PM", value: "13" },
    { label: "2 PM", value: "14" },
    { label: "3 PM", value: "15" },
    { label: "4 PM", value: "16" },
    { label: "5 PM", value: "17" },
    { label: "6 PM", value: "18" },
    { label: "7 PM", value: "19" },
    { label: "8 PM", value: "20" },
    { label: "9 PM", value: "21" },
    { label: "10 PM", value: "22" },
    { label: "11 PM", value: "23" },
    { label: "12 AM Next Day", value: "24" },
    { label: "1 AM Next Day", value: "25" },
    { label: "2 AM Next Day", value: "26" },
    { label: "3 AM Next Day", value: "27" },
    { label: "4 AM Next Day", value: "28" },
    { label: "5 AM Next Day", value: "29" },
    { label: "6 AM Next Day", value: "30" },
  ];

  const intervalOptions = [
    { label: "15 minutes", value: "15" },
    { label: "30 minutes", value: "30" },
    { label: "60 minutes", value: "60" },
  ];

  const timeFormatOptions = [
    { label: "12-hour time, like 5:30 PM", value: "12" },
    { label: "24-hour time, like 17:30", value: "24" },
  ];

  return (
    <AppScreen scroll backgroundColor={colors.background}>
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
        <AppSelectField
          label="Start Time"
          value={startHour}
          options={hourOptions}
          onChange={setStartHour}
          colors={colors}
        />

        <AppSelectField
          label="End Time"
          value={endHour}
          options={hourOptions}
          onChange={setEndHour}
          colors={colors}
        />

        <AppSelectField
          label="Time Interval"
          value={interval}
          options={intervalOptions}
          onChange={setIntervalValue}
          colors={colors}
        />

        <AppSelectField
          label="Time Format"
          value={timeFormat}
          options={timeFormatOptions}
          onChange={setTimeFormat}
          colors={colors}
        />

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
    </AppScreen>
  );
}
