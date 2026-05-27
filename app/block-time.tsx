import { useRouter } from "expo-router";
import { useState } from "react";
import {
  Alert,
  Pressable,
  Text,
  TextInput,
  View,
} from "react-native";
import { AppSelectField } from "../components/AppSelectField";
import { AppScreen } from "../components/layout/AppScreen";
import { canUseFeature, useFeatureAccess } from "../lib/featureAccess";
import { supabase } from "../lib/supabase";

const BLOCK_COLORS = {
  background: "#ffffff",
  card: "#ffffff",
  text: "#111111",
  mutedText: "#666666",
  border: "#D1D5DB",
  primary: "#0F766E",
};

const BLOCK_TYPE_OPTIONS = [
  { label: "Personal", value: "personal" },
  { label: "Vacation", value: "vacation" },
  { label: "Lunch", value: "lunch" },
  { label: "Closed", value: "closed" },
];

const TIME_OPTIONS = [
  "00:00",
  "00:30",
  "01:00",
  "01:30",
  "02:00",
  "02:30",
  "03:00",
  "03:30",
  "04:00",
  "04:30",
  "05:00",
  "05:30",
  "06:00",
  "06:30",
  "07:00",
  "07:30",
  "08:00",
  "08:30",
  "09:00",
  "09:30",
  "10:00",
  "10:30",
  "11:00",
  "11:30",
  "12:00",
  "12:30",
  "13:00",
  "13:30",
  "14:00",
  "14:30",
  "15:00",
  "15:30",
  "16:00",
  "16:30",
  "17:00",
  "17:30",
  "18:00",
  "18:30",
  "19:00",
  "19:30",
  "20:00",
  "20:30",
  "21:00",
  "21:30",
  "22:00",
  "22:30",
  "23:00",
  "23:30",
].map((time) => ({ label: time, value: time }));

function timeToMinutes(time: string) {
  const [hours, minutes] = String(time || "00:00")
    .slice(0, 5)
    .split(":")
    .map(Number);

  return (Number.isFinite(hours) ? hours : 0) * 60 +
    (Number.isFinite(minutes) ? minutes : 0);
}

export default function BlockTimeScreen() {
  const router = useRouter();
  useFeatureAccess();
  const customScheduleAvailable = canUseFeature("customBusinessHours");

  const [title, setTitle] = useState("");
  const [blockDate, setBlockDate] = useState("");
  const [startTime, setStartTime] = useState("09:00");
  const [endTime, setEndTime] = useState("10:00");
  const [blockType, setBlockType] = useState("personal");
  const [notes, setNotes] = useState("");

  async function saveBlock() {
    if (!customScheduleAvailable) {
      Alert.alert(
        "Schedova Pro",
        "Blocked time and custom business hours are Pro features.",
      );
      return;
    }

    if (!title || !blockDate || !startTime || !endTime) {
      Alert.alert(
        "Missing Info",
        "Please complete title, date, start time, and end time.",
      );
      return;
    }

    const { data: userData } = await supabase.auth.getUser();
    const userId = userData.user?.id;
    if (!userId) {
      Alert.alert("Login Required", "You must be logged in.");
      return;
    }
    if (timeToMinutes(startTime) >= timeToMinutes(endTime)) {
      Alert.alert("Invalid Time", "End time must be after start time.");
      return;
    }

    const { data: overlappingAppointments, error: appointmentError } =
      await supabase
        .from("appointments")
        .select("id")
        .eq("user_id", userId)
        .eq("appointment_date", blockDate)
        .neq("status", "canceled")
        .lt("appointment_time", endTime)
        .gt("end_time", startTime);

    if (appointmentError) {
      Alert.alert("Error", appointmentError.message);
      return;
    }

    if (overlappingAppointments?.length) {
      Alert.alert("Conflict", "This blocked time overlaps an appointment.");
      return;
    }

    const { data: overlappingBlocks, error: blockError } = await supabase
      .from("blocked_times")
      .select("id")
      .eq("user_id", userId)
      .eq("block_date", blockDate)
      .lt("start_time", endTime)
      .gt("end_time", startTime);

    if (blockError) {
      Alert.alert("Error", blockError.message);
      return;
    }

    if (overlappingBlocks?.length) {
      Alert.alert("Conflict", "This time overlaps an existing blocked time.");
      return;
    }

    const { error } = await supabase
      .from("blocked_times")
      .insert({
        user_id: userId,
        title,
        block_date: blockDate,
        start_time: startTime,
        end_time: endTime,
        block_type: blockType,
        notes,
      });

    if (error) {
      Alert.alert("Error", error.message);
      return;
    }

    router.back();
  }

  if (!customScheduleAvailable) {
    return (
      <AppScreen scroll backgroundColor="#ffffff">
        <Text
          style={{
            fontSize: 30,
            fontWeight: "bold",
            marginBottom: 24,
            color: "#111111",
          }}
        >
          Block Time
        </Text>

        <View
          style={{
            borderWidth: 1,
            borderColor: "#D1D5DB",
            borderRadius: 16,
            padding: 18,
            marginBottom: 16,
          }}
        >
          <Text style={{ color: "#111111", fontSize: 20, fontWeight: "900" }}>
            Schedova Pro
          </Text>
          <Text style={{ color: "#666666", marginTop: 8 }}>
            Blocked time, vacation blocks, and custom business hours are locked
            on Free.
          </Text>
        </View>

        <Pressable
          onPress={() => router.back()}
          style={{
            backgroundColor: "#0F766E",
            padding: 16,
            borderRadius: 14,
            alignItems: "center",
          }}
        >
          <Text style={{ color: "#ffffff", fontWeight: "bold", fontSize: 16 }}>
            Back
          </Text>
        </Pressable>
      </AppScreen>
    );
  }

  return (
    <AppScreen scroll keyboardAware backgroundColor="#ffffff">
      <Text
        style={{
          fontSize: 30,
          fontWeight: "bold",
          marginBottom: 24,
          color: "#111111",
        }}
      >
        Block Time
      </Text>

      <Text style={{ color: "#111111", fontWeight: "bold", marginBottom: 8 }}>
        Title
      </Text>
      <TextInput
        value={title}
        onChangeText={setTitle}
        placeholder="Vacation, Lunch, Personal Event"
        placeholderTextColor="#888888"
        style={{
          borderWidth: 1,
          borderColor: "#D1D5DB",
          borderRadius: 12,
          padding: 14,
          marginBottom: 16,
          color: "#111111",
        }}
      />

      <Text style={{ color: "#111111", fontWeight: "bold", marginBottom: 8 }}>
        Date
      </Text>
      <TextInput
        value={blockDate}
        onChangeText={setBlockDate}
        placeholder="YYYY-MM-DD"
        placeholderTextColor="#888888"
        style={{
          borderWidth: 1,
          borderColor: "#D1D5DB",
          borderRadius: 12,
          padding: 14,
          marginBottom: 16,
          color: "#111111",
        }}
      />

      <TimePicker label="Start Time" value={startTime} onChange={setStartTime} />

      <TimePicker label="End Time" value={endTime} onChange={setEndTime} />

      <AppSelectField
        label="Type"
        value={blockType}
        options={BLOCK_TYPE_OPTIONS}
        onChange={setBlockType}
        colors={BLOCK_COLORS}
      />

      <Text style={{ color: "#111111", fontWeight: "bold", marginBottom: 8 }}>
        Notes
      </Text>
      <TextInput
        value={notes}
        onChangeText={setNotes}
        multiline
        placeholder="Optional notes..."
        placeholderTextColor="#888888"
        style={{
          borderWidth: 1,
          borderColor: "#D1D5DB",
          borderRadius: 12,
          padding: 14,
          minHeight: 100,
          textAlignVertical: "top",
          marginBottom: 24,
          color: "#111111",
        }}
      />

      <Pressable
        onPress={saveBlock}
        style={{
          backgroundColor: "#7C3AED",
          padding: 16,
          borderRadius: 14,
          alignItems: "center",
          marginBottom: 40,
        }}
      >
        <Text style={{ color: "#ffffff", fontWeight: "bold", fontSize: 16 }}>
          Save Blocked Time
        </Text>
      </Pressable>
    </AppScreen>
  );
}

function TimePicker({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <AppSelectField
      label={label}
      value={value}
      options={TIME_OPTIONS}
      onChange={onChange}
      colors={BLOCK_COLORS}
    />
  );
}
