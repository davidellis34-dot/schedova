import { Picker } from "@react-native-picker/picker";
import { useRouter } from "expo-router";
import { useState } from "react";
import {
  Alert,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { supabase } from "../lib/supabase";

export default function BlockTimeScreen() {
  const router = useRouter();

  const [title, setTitle] = useState("");
  const [blockDate, setBlockDate] = useState("");
  const [startTime, setStartTime] = useState("09:00");
  const [endTime, setEndTime] = useState("10:00");
  const [blockType, setBlockType] = useState("personal");
  const [notes, setNotes] = useState("");

  async function saveBlock() {
    if (!title || !blockDate || !startTime || !endTime) {
      Alert.alert(
        "Missing Info",
        "Please complete title, date, start time, and end time.",
      );
      return;
    }
    Alert.alert("Debug", "about to insert block");
    const { data: userData } = await supabase.auth.getUser();
    const userId = userData.user?.id;
    if (!userId) {
      Alert.alert("Login Required", "You must be logged in.");
      return;
    }
    console.log("Saving block:", {
      user_id: userId,
      title,
      block_date: blockDate,
      start_time: startTime,
      end_time: endTime,
      block_type: blockType,
      notes,
    });

    const { data, error } = await supabase
      .from("blocked_times")
      .insert({
        user_id: userId,
        title,
        block_date: blockDate,
        start_time: startTime,
        end_time: endTime,
        block_type: blockType,
        notes,
      })
      .select();

    console.log("Save result:", data);
    console.log("Save error:", error);

    if (error) {
      Alert.alert("Error", error.message);
      return;
    }

    router.back();
  }

  return (
    <ScrollView style={{ flex: 1, backgroundColor: "#ffffff", padding: 20 }}>
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

      <Text style={{ color: "#111111", fontWeight: "bold", marginBottom: 8 }}>
        Start Time
      </Text>
      <TimePicker value={startTime} onChange={setStartTime} />

      <Text style={{ color: "#111111", fontWeight: "bold", marginBottom: 8 }}>
        End Time
      </Text>
      <TimePicker value={endTime} onChange={setEndTime} />

      <Text style={{ color: "#111111", fontWeight: "bold", marginBottom: 8 }}>
        Type
      </Text>
      <View
        style={{
          borderWidth: 1,
          borderColor: "#D1D5DB",
          borderRadius: 12,
          backgroundColor: "#ffffff",
          overflow: "hidden",
          marginBottom: 16,
        }}
      >
        <Picker selectedValue={blockType} onValueChange={setBlockType}>
          <Picker.Item label="Personal" value="personal" />
          <Picker.Item label="Vacation" value="vacation" />
          <Picker.Item label="Lunch" value="lunch" />
          <Picker.Item label="Closed" value="closed" />
        </Picker>
      </View>

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
    </ScrollView>
  );
}

function TimePicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  const times = [
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
  ];

  return (
    <View
      style={{
        borderWidth: 1,
        borderColor: "#D1D5DB",
        borderRadius: 12,
        backgroundColor: "#ffffff",
        overflow: "hidden",
        marginBottom: 16,
      }}
    >
      <Picker selectedValue={value} onValueChange={onChange}>
        {times.map((time) => (
          <Picker.Item key={time} label={time} value={time} />
        ))}
      </Picker>
    </View>
  );
}
