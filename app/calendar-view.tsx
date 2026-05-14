import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { supabase } from "../lib/supabase";
import { useAppTheme } from "../lib/useAppTheme";

const DAYS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

function todayDate() {
  return new Date().toISOString().split("T")[0];
}

function formatTime(value: any) {
  if (!value) return "";
  const text = String(value).slice(0, 5);
  const [h, m] = text.split(":").map(Number);
  if (Number.isNaN(h)) return text;

  const ampm = h >= 12 ? "PM" : "AM";
  const hour = h % 12 || 12;
  return `${hour}:${String(m || 0).padStart(2, "0")} ${ampm}`;
}

function getWeekDates() {
  const now = new Date();
  const start = new Date(now);
  start.setDate(now.getDate() - now.getDay());

  return DAYS.map((day, index) => {
    const date = new Date(start);
    date.setDate(start.getDate() + index);
    const iso = date.toISOString().split("T")[0];

    return {
      day,
      date: iso,
      label: `${date.getMonth() + 1}/${date.getDate()}`,
    };
  });
}

export default function CalendarView() {
  const router = useRouter();
  const { colors } = useAppTheme();

  const [appointments, setAppointments] = useState<any[]>([]);
  const [blocks, setBlocks] = useState<any[]>([]);

  useFocusEffect(
    useCallback(() => {
      fetchCalendarData();
    }, []),
  );

  async function fetchCalendarData() {
    const { data: userData } = await supabase.auth.getUser();
    const userId = userData.user?.id;

    if (!userId) return;

    const appointmentsResult = await supabase
      .from("appointments")
      .select("*")
      .eq("user_id", userId);

    const blocksResult = await supabase
      .from("blocked_times")
      .select("*")
      .eq("user_id", userId);

    const safeAppointments = (appointmentsResult.data || []).filter(
      (appt: any) => {
        if (!appt) return false;
        if (!appt.appointment_date) return false;
        if (!appt.appointment_time) return false;

        return true;
      },
    );

    const safeBlocks = (blocksResult.data || []).filter((block: any) => {
      if (!block) return false;
      if (!block.block_date) return false;
      if (!block.start_time) return false;
      if (!block.end_time) return false;

      return true;
    });

    console.log("🔥 SAFE BLOCKS:", JSON.stringify(safeBlocks, null, 2));

    setAppointments(safeAppointments);
    setBlocks([]);
  }

  const weekDates = getWeekDates();

  return (
    <ScrollView
      style={{
        flex: 1,
        backgroundColor: colors.background,
        padding: 16,
      }}
    >
      <Text
        style={{
          color: colors.text,
          fontSize: 28,
          fontWeight: "bold",
          marginBottom: 16,
        }}
      >
        Calendar
      </Text>

      <Pressable
        onPress={() =>
          router.push({
            pathname: "/book-appointment",
            params: {
              appointmentDate: todayDate(),
              appointmentTime: "09:00",
            },
          })
        }
        style={{
          backgroundColor: "#0F766E",
          padding: 14,
          borderRadius: 14,
          alignItems: "center",
          marginBottom: 20,
        }}
      >
        <Text style={{ color: "white", fontWeight: "bold" }}>
          Add Calendar Entry
        </Text>
      </Pressable>

      {weekDates.map((item) => {
        const dayAppointments = appointments.filter(
          (appt) => appt.appointment_date === item.date,
        );

        const dayBlocks = blocks.filter(
          (block) => block.block_date === item.date,
        );

        return (
          <View
            key={item.date}
            style={{
              backgroundColor: colors.card,
              borderRadius: 16,
              padding: 14,
              marginBottom: 14,
              borderWidth: 1,
              borderColor: colors.border,
            }}
          >
            <Text
              style={{
                color: colors.text,
                fontSize: 18,
                fontWeight: "bold",
                marginBottom: 10,
              }}
            >
              {item.day} {item.label}
            </Text>

            {dayAppointments.length === 0 && dayBlocks.length === 0 ? (
              <Text style={{ color: colors.mutedText }}>No entries</Text>
            ) : null}

            {dayAppointments.map((appt) => (
              <Pressable
                key={appt.id}
                onPress={() =>
                  router.push({
                    pathname: "/book-appointment",
                    params: {
                      appointmentId: appt.id,
                      editMode: "true",
                    },
                  })
                }
                style={{
                  backgroundColor: "#CCFBF1",
                  padding: 10,
                  borderRadius: 12,
                  marginBottom: 8,
                }}
              >
                <Text style={{ color: "#111111", fontWeight: "bold" }}>
                  {formatTime(appt.appointment_time)} -{" "}
                  {appt.client_name || "Appointment"}
                </Text>
              </Pressable>
            ))}

            {dayBlocks.map((block) => (
              <Pressable
                key={block.id}
                onPress={() =>
                  router.push({
                    pathname: "/book-appointment",
                    params: {
                      blockId: block.id,
                      editMode: "true",
                    },
                  })
                }
                style={{
                  backgroundColor: "#FDE68A",
                  padding: 10,
                  borderRadius: 12,
                  marginBottom: 8,
                }}
              >
                <Text style={{ color: "#111111", fontWeight: "bold" }}>
                  {formatTime(block.start_time)} - {formatTime(block.end_time)}{" "}
                  · {block.title || block.block_type || "Blocked Time"}
                </Text>
              </Pressable>
            ))}
          </View>
        );
      })}
    </ScrollView>
  );
}
