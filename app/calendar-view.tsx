import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  Platform,
  Pressable,
  ScrollView,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { AppScreen } from "../components/layout/AppScreen";
import { confirmDestructiveAction } from "../lib/confirmDestructiveAction";
import { getCalendarPreferences } from "../lib/calendarPreferences";
import { canUseFeature, useFeatureAccess } from "../lib/featureAccess";
import { cancelAppointmentReminder } from "../lib/localNotifications";
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

const DEFAULT_INTERVAL_MINUTES = 30;
const DEFAULT_TIME_FORMAT: TimeFormat = "12h";

type CalendarIntervalMinutes = 15 | 30 | 60;
type TimeFormat = "12h" | "24h";

function todayIso() {
  const now = new Date();

  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(
    2,
    "0",
  )}-${String(now.getDate()).padStart(2, "0")}`;
}

function parseDateOnly(dateText?: string) {
  if (!dateText) return new Date();

  const [year, month, day] = String(dateText).split("-").map(Number);

  if (!year || !month || !day) return new Date();

  return new Date(year, month - 1, day, 12, 0, 0, 0);
}

function toDateOnly(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(
    2,
    "0",
  )}-${String(date.getDate()).padStart(2, "0")}`;
}

function normalizeTimeText(value: any) {
  if (!value) return "";

  const text = String(value).trim();

  const ampmMatch = text.match(/^(\d{1,2}):(\d{2})\s*([AP]M)$/i);

  if (ampmMatch) {
    let hour = Number(ampmMatch[1]);
    const minute = Number(ampmMatch[2]);
    const meridiem = ampmMatch[3].toUpperCase();

    if (meridiem === "PM" && hour < 12) {
      hour += 12;
    }

    if (meridiem === "AM" && hour === 12) {
      hour = 0;
    }

    return `${String(hour).padStart(2, "0")}:${String(minute).padStart(
      2,
      "0",
    )}`;
  }

  return text.slice(0, 5);
}

function formatTime(value: any, timeFormat: TimeFormat) {
  if (!value) return "";

  const text = normalizeTimeText(value);
  const [h, m] = text.split(":").map(Number);

  if (Number.isNaN(h)) return text;

  const minutes = String(Number.isFinite(m) ? m : 0).padStart(2, "0");

  if (timeFormat === "24h") {
    return `${String(h).padStart(2, "0")}:${minutes}`;
  }

  const ampm = h >= 12 ? "PM" : "AM";
  const hour = h % 12 || 12;

  return `${hour}:${minutes} ${ampm}`;
}

function toMinutes(time: string) {
  const normalized = normalizeTimeText(time);

  const [hours, minutes] = String(normalized || "00:00")
    .slice(0, 5)
    .split(":")
    .map(Number);

  return (
    (Number.isFinite(hours) ? hours : 0) * 60 +
    (Number.isFinite(minutes) ? minutes : 0)
  );
}

function formatBlockLabel(type: string) {
  switch (type) {
    case "vacation":
      return "Vacation";
    case "personal":
      return "Personal";
    case "blocked_time":
      return "Blocked Time";
    default:
      return "Calendar Block";
  }
}

function getBlockColors(type: string) {
  switch (type) {
    case "vacation":
      return { bg: "#DBEAFE", border: "#2563EB" };
    case "personal":
      return { bg: "#EDE9FE", border: "#7C3AED" };
    default:
      return { bg: "#FEF3C7", border: "#D97706" };
  }
}

function addWeeksToDate(dateText: string, weekOffset: number) {
  const date = parseDateOnly(dateText);
  date.setDate(date.getDate() + weekOffset * 7);

  return toDateOnly(date);
}

function getWeekDates(baseDate: string, weekOffset = 0) {
  const base = parseDateOnly(baseDate);
  base.setDate(base.getDate() + weekOffset * 7);

  const start = new Date(base);
  start.setDate(base.getDate() - base.getDay());

  return DAYS.map((day, index) => {
    const date = new Date(start);
    date.setDate(start.getDate() + index);

    return {
      day,
      date: toDateOnly(date),
      label: `${date.getMonth() + 1}/${date.getDate()}`,
      monthLabel: date.toLocaleString("default", { month: "short" }),
    };
  });
}

async function loadCalendarDisplayPreferences() {
  const preferences = await getCalendarPreferences();

  return {
    intervalMinutes: preferences.intervalMinutes,
    timeFormat: preferences.timeFormat,
    startHour: preferences.startHour,
    endHour: preferences.endHour,
  };
}

function hourToTimeText(hour: number) {
  const normalizedHour = Math.max(0, Math.min(30, Math.floor(hour)));
  const hourOfDay = normalizedHour % 24;

  return `${String(hourOfDay).padStart(2, "0")}:00`;
}

export default function CalendarView() {
  const router = useRouter();
  const { colors } = useAppTheme();
  useFeatureAccess();
  const insets = useSafeAreaInsets();
  const customScheduleAvailable = canUseFeature("customBusinessHours");
  const { selectedDate, selectedTime } = useLocalSearchParams();

  const initialDate =
    typeof selectedDate === "string" && selectedDate
      ? selectedDate
      : todayIso();

  const [baseDate, setBaseDate] = useState(initialDate);
  const [availabilityRules, setAvailabilityRules] = useState<any[]>([]);
  const [appointments, setAppointments] = useState<any[]>([]);
  const [blocks, setBlocks] = useState<any[]>([]);
  const [weekOffset, setWeekOffset] = useState(0);
  const [selectMode, setSelectMode] = useState(false);
  const [selectedAppointments, setSelectedAppointments] = useState<string[]>(
    [],
  );
  const [selectedBlocks, setSelectedBlocks] = useState<string[]>([]);
  const [openDays, setOpenDays] = useState<Record<string, boolean>>({});
  const [calendarIntervalMinutes, setCalendarIntervalMinutes] =
    useState<CalendarIntervalMinutes>(DEFAULT_INTERVAL_MINUTES);
  const [timeFormat, setTimeFormat] = useState<TimeFormat>(DEFAULT_TIME_FORMAT);
  const [calendarStartHour, setCalendarStartHour] = useState(7);
  const [calendarEndHour, setCalendarEndHour] = useState(19);

  const scrollRef = useRef<ScrollView>(null);
  const dayLayouts = useRef<Record<string, number>>({});
  const hasAutoScrolled = useRef(false);
  const fetchRequestId = useRef(0);

  const todayKey = initialDate;

  const weekDates = useMemo(
    () => getWeekDates(baseDate, weekOffset),
    [baseDate, weekOffset],
  );

  const currentMinutes = new Date().getHours() * 60 + new Date().getMinutes();

  const parsedSelectedHour =
    typeof selectedTime === "string" ? Number(selectedTime.slice(0, 2)) : NaN;
  const shouldAutoScrollToSelectedTime =
    typeof selectedTime === "string" && selectedTime.length >= 2;

  const scrollHour = Number.isFinite(parsedSelectedHour)
    ? parsedSelectedHour
    : new Date().getHours();
  const selectButtonBottom = Platform.OS === "ios" ? insets.bottom + 24 : 24;

  const getStatusColor = (status?: string) => {
    switch (status) {
      case "completed":
        return "#16A34A";
      case "canceled":
        return "#DC2626";
      case "no_show":
        return "#EA580C";
      default:
        return colors.primary;
    }
  };

  const effectiveSelectedDate = addWeeksToDate(baseDate, weekOffset);

  useEffect(() => {
    setOpenDays((current) => ({
      ...current,
      [effectiveSelectedDate]: true,
    }));
  }, [effectiveSelectedDate]);

  useFocusEffect(
    useCallback(() => {
      let active = true;

      async function loadPreferences() {
        const preferences = await loadCalendarDisplayPreferences();

        if (!active) return;

        setCalendarIntervalMinutes(preferences.intervalMinutes);
        setTimeFormat(preferences.timeFormat);
        setCalendarStartHour(preferences.startHour);
        setCalendarEndHour(preferences.endHour);
      }

      void loadPreferences();

      return () => {
        active = false;
      };
    }, []),
  );

  const fetchCalendarData = useCallback(async () => {
    const requestId = fetchRequestId.current + 1;
    fetchRequestId.current = requestId;

    const { data: userData } = await supabase.auth.getUser();
    const userId = userData.user?.id;

    if (!userId) return;

    const weekStart = weekDates[0]?.date;
    const weekEnd = weekDates[weekDates.length - 1]?.date;

    if (!weekStart || !weekEnd) return;

    if (customScheduleAvailable) {
      const availabilityResult = await supabase
        .from("availability_rules")
        .select("*")
        .eq("user_id", userId)
        .order("day_of_week", { ascending: true });

      if (requestId !== fetchRequestId.current) return;

      if (availabilityResult.error) {
        Alert.alert("Error", availabilityResult.error.message);
        setAvailabilityRules([]);
        return;
      }

      setAvailabilityRules(availabilityResult.data || []);
    } else {
      setAvailabilityRules([]);
    }

    const appointmentsResult = await supabase
      .from("appointments")
      .select("*")
      .eq("user_id", userId)
      .gte("appointment_date", weekStart)
      .lte("appointment_date", weekEnd)
      .order("appointment_date", { ascending: true })
      .order("appointment_time", { ascending: true });

    let nextBlocks: any[] = [];

    if (customScheduleAvailable) {
      const blocksResult = await supabase
        .from("blocked_times")
        .select("*")
        .eq("user_id", userId)
        .gte("block_date", weekStart)
        .lte("block_date", weekEnd)
        .order("block_date", { ascending: true })
        .order("start_time", { ascending: true });

      if (requestId !== fetchRequestId.current) return;

      if (blocksResult.error) {
        Alert.alert("Error", blocksResult.error.message);
        setBlocks([]);
        return;
      }

      nextBlocks = (blocksResult.data || []).filter((block: any) => {
        if (!block?.block_date) return false;
        if (!block?.start_time) return false;
        if (!block?.end_time) return false;

        return true;
      });
    }

    if (requestId !== fetchRequestId.current) return;

    if (appointmentsResult.error) {
      Alert.alert("Error", appointmentsResult.error.message);
      setAppointments([]);
      return;
    }

    setAppointments(
      (appointmentsResult.data || []).filter((appt: any) => {
        if (!appt?.appointment_date) return false;
        if (!appt?.appointment_time) return false;
        if (appt.status === "canceled") return false;

        return true;
      }),
    );

    setBlocks(nextBlocks);
  }, [customScheduleAvailable, weekDates]);

  useFocusEffect(
    useCallback(() => {
      void fetchCalendarData();
    }, [fetchCalendarData]),
  );

  function generateTimeSlots(start: string, end: string) {
    const slots: string[] = [];

    const [startHour, startMinute] = start.split(":").map(Number);
    const [endHour, endMinute] = end.split(":").map(Number);

    let current = startHour * 60 + startMinute;
    const finish = endHour * 60 + endMinute;

    while (current <= finish) {
      const hours = Math.floor(current / 60)
        .toString()
        .padStart(2, "0");
      const minutes = (current % 60).toString().padStart(2, "0");

      slots.push(`${hours}:${minutes}`);
      current += calendarIntervalMinutes;
    }

    return slots;
  }

  function toggleAppointment(id: string) {
    setSelectedAppointments((current) =>
      current.includes(id)
        ? current.filter((item) => item !== id)
        : [...current, id],
    );
  }

  function toggleBlock(id: string) {
    setSelectedBlocks((current) =>
      current.includes(id)
        ? current.filter((item) => item !== id)
        : [...current, id],
    );
  }

  function clearSelectedCalendarItems() {
    setSelectedAppointments([]);
    setSelectedBlocks([]);
  }

  function selectAllCalendarItems() {
    const visibleDates = weekDates.map((item) => item.date);

    setSelectedAppointments(
      appointments
        .filter((appointment) =>
          visibleDates.includes(appointment.appointment_date),
        )
        .map((appointment) => appointment.id),
    );

    setSelectedBlocks(
      blocks
        .filter((block) => visibleDates.includes(block.block_date))
        .map((block) => block.id),
    );
  }

  async function deleteSelectedCalendarItems() {
    const total = selectedAppointments.length + selectedBlocks.length;

    if (total === 0) {
      Alert.alert(
        "Nothing Selected",
        "Select appointments or blocks to delete.",
      );
      return;
    }

    await confirmDestructiveAction({
      title: "Delete Selected?",
      message: `Are you sure you want to delete ${total} item${
        total === 1 ? "" : "s"
      }?`,
      confirmText: "Delete",
      onConfirm: async () => {
        const {
          data: { user },
          error: userError,
        } = await supabase.auth.getUser();

        if (userError || !user) {
          Alert.alert("Not signed in", "Please sign in again.");
          return;
        }

        if (selectedAppointments.length > 0) {
          const { error } = await supabase
            .from("appointments")
            .delete()
            .in("id", selectedAppointments)
            .eq("user_id", user.id);

          if (error) {
            Alert.alert("Error", error.message);
            return;
          }

          await Promise.all(
            selectedAppointments.map((appointmentId) =>
              cancelAppointmentReminder(appointmentId),
            ),
          );
        }

        if (selectedBlocks.length > 0) {
          const { error } = await supabase
            .from("blocked_times")
            .delete()
            .in("id", selectedBlocks)
            .eq("user_id", user.id);

          if (error) {
            Alert.alert("Error", error.message);
            return;
          }
        }

        clearSelectedCalendarItems();
        setSelectMode(false);
        void fetchCalendarData();
      },
    });
  }

  function scrollToTodayAndTime(animated = false) {
    const dayY = dayLayouts.current[todayKey] || 0;
    const firstCalendarHour = 7;
    const timeOffset = Math.max((scrollHour - firstCalendarHour) * 85 - 220, 0);

    scrollRef.current?.scrollTo({
      y: dayY + timeOffset,
      animated,
    });
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <AppScreen
        scroll
        ref={scrollRef}
        backgroundColor={colors.background}
        horizontalPadding={10}
        topPadding={10}
        bottomPadding={96}
        androidBottomPadding={10}
        onContentSizeChange={() => {
          if (hasAutoScrolled.current) return;

          hasAutoScrolled.current = true;

          if (!shouldAutoScrollToSelectedTime) return;

          setTimeout(() => {
            scrollToTodayAndTime(false);
          }, 0);
        }}
        style={{
          flex: 1,
          backgroundColor: colors.background,
        }}
        contentContainerStyle={{
          marginBottom: 6,
          borderRadius: 10,
        }}
      >
        <Text
          style={{
            color: colors.text,
            fontSize: 30,
            fontWeight: "bold",
            marginBottom: 6,
          }}
        >
          Calendar
        </Text>

        <Text
          style={{
            color: colors.mutedText,
            fontSize: 15,
            marginBottom: 16,
          }}
        >
          Your week at a glance
        </Text>

        {!customScheduleAvailable ? (
          <View
            style={{
              backgroundColor: colors.card,
              borderWidth: 1,
              borderColor: colors.border,
              borderRadius: 14,
              padding: 14,
              marginBottom: 16,
            }}
          >
            <Text style={{ color: colors.text, fontWeight: "900" }}>
              Schedova Pro
            </Text>
            <Text style={{ color: colors.mutedText, marginTop: 6 }}>
              Custom business hours and blocked time are locked on Free.
            </Text>
          </View>
        ) : null}

        <View style={{ flexDirection: "row", gap: 10, marginBottom: 16 }}>
          <Pressable
            onPress={() => {
              hasAutoScrolled.current = false;
              setWeekOffset((current) => current - 1);
            }}
            style={{
              flex: 1,
              backgroundColor: "#243047",
              borderWidth: 1,
              borderColor: colors.border,
              padding: 10,
              marginBottom: 6,
              borderRadius: 10,
              alignItems: "center",
            }}
          >
            <Text style={{ color: "#FFFFFF", fontWeight: "bold" }}>
              Previous
            </Text>
          </Pressable>

          <Pressable
            onPress={() => {
              hasAutoScrolled.current = false;
              setBaseDate(todayIso());
              setWeekOffset(0);
            }}
            style={{
              flex: 1,
              backgroundColor: "#243047",
              borderWidth: 1,
              borderColor: colors.border,
              padding: 10,
              marginBottom: 6,
              borderRadius: 10,
              alignItems: "center",
            }}
          >
            <Text style={{ color: "#FFFFFF", fontWeight: "bold" }}>
              This Week
            </Text>
          </Pressable>

          <Pressable
            onPress={() => {
              hasAutoScrolled.current = false;
              setWeekOffset((current) => current + 1);
            }}
            style={{
              flex: 1,
              backgroundColor: "#243047",
              borderWidth: 1,
              borderColor: colors.border,
              padding: 10,
              marginBottom: 6,
              borderRadius: 10,
              alignItems: "center",
            }}
          >
            <Text style={{ color: "#FFFFFF", fontWeight: "bold" }}>Next</Text>
          </Pressable>
        </View>

        {selectMode ? (
          <View style={{ flexDirection: "row", gap: 10, marginBottom: 16 }}>
            <Pressable
              onPress={selectAllCalendarItems}
              style={{
                flex: 1,
                backgroundColor: "#243047",
                borderWidth: 1,
                borderColor: colors.border,
                padding: 10,
                marginBottom: 6,
                borderRadius: 10,
                alignItems: "center",
              }}
            >
              <Text style={{ color: "#FFFFFF", fontWeight: "bold" }}>
                Select All
              </Text>
            </Pressable>

            <Pressable
              onPress={deleteSelectedCalendarItems}
              style={{
                flex: 1,
                backgroundColor: "#991B1B",
                padding: 10,
                marginBottom: 6,
                borderRadius: 10,
                alignItems: "center",
              }}
            >
              <Text style={{ color: "#FFFFFF", fontWeight: "bold" }}>
                Delete
              </Text>
            </Pressable>
          </View>
        ) : null}

        {weekDates.map((item) => {
          const dayAppointments = appointments.filter(
            (appt) => appt.appointment_date === item.date,
          );

          const dayBlocks = blocks.filter(
            (block) => block.block_date === item.date,
          );

          const isDayOpen =
            openDays[item.date] ?? item.date === effectiveSelectedDate;

          const dayNumber = parseDateOnly(item.date).getDay();

          const dayRule = availabilityRules.find(
            (rule) => Number(rule.day_of_week) === dayNumber,
          );

          const fallbackStartTime = hourToTimeText(calendarStartHour);
          const fallbackEndTime = hourToTimeText(calendarEndHour);

          const timeSlots = dayRule
            ? generateTimeSlots(
                String(dayRule.start_time || fallbackStartTime).slice(0, 5),
                String(dayRule.end_time || fallbackEndTime).slice(0, 5),
              )
            : generateTimeSlots(fallbackStartTime, fallbackEndTime);

          return (
            <View
              key={item.date}
              onLayout={(event) => {
                dayLayouts.current[item.date] = event.nativeEvent.layout.y;
              }}
              style={{
                backgroundColor: "#243047",
                borderWidth: 1,
                borderColor: colors.border,
                padding: 10,
                marginBottom: 6,
                borderRadius: 10,
              }}
            >
              <Pressable
                onPress={() =>
                  setOpenDays((current) => ({
                    ...current,
                    [item.date]: !isDayOpen,
                  }))
                }
                style={{
                  paddingVertical: 2,
                  paddingHorizontal: 4,
                }}
              >
                <Text
                  style={{
                    fontSize: 18,
                    fontWeight: "700",
                    letterSpacing: 0.3,
                    color: "#FFFFFF",
                  }}
                >
                  {isDayOpen ? "⌄" : "›"} {item.day} {item.label}
                </Text>
              </Pressable>

              {isDayOpen ? (
                <View style={{ marginTop: 10 }}>
                  {dayAppointments.length === 0 && dayBlocks.length === 0 ? (
                    <>
                      <Text
                        style={{
                          color: colors.mutedText,
                          fontSize: 15,
                          fontWeight: "600",
                          textAlign: "center",
                          marginBottom: 4,
                          opacity: 0.9,
                        }}
                      >
                        No appointments for this day
                      </Text>

                      <Text
                        style={{
                          color: colors.mutedText,
                          fontSize: 13,
                          textAlign: "center",
                          opacity: 0.7,
                          marginBottom: 14,
                        }}
                      >
                        Tap + to book an appointment
                      </Text>
                    </>
                  ) : null}

                  {dayAppointments.map((appt) => {
                    const selected = selectedAppointments.includes(appt.id);

                    return (
                      <Pressable
                        key={appt.id}
                        onPress={() => {
                          if (selectMode) {
                            toggleAppointment(appt.id);
                            return;
                          }

                          router.push({
                            pathname: "/book-appointment",
                            params: {
                              appointmentId: appt.id,
                              mode: "edit",
                            },
                          } as any);
                        }}
                        style={({ pressed }) => ({
                          backgroundColor: selected
                            ? "rgba(15,118,110,0.08)"
                            : colors.card,
                          paddingVertical: 10,
                          paddingHorizontal: 12,
                          borderRadius: 14,
                          marginBottom: 8,
                          shadowColor: "#000",
                          shadowOffset: { width: 0, height: 2 },
                          shadowOpacity: 0.08,
                          shadowRadius: 4,
                          elevation: 2,
                          borderLeftWidth: 5,
                          borderLeftColor: getStatusColor(appt.status),
                          borderWidth: selected ? 2 : 1,
                          borderColor: selected ? "#DC2626" : colors.border,
                          opacity: pressed ? 0.92 : 1,
                          transform: [{ scale: pressed ? 0.985 : 1 }],
                        })}
                      >
                        <Text
                          style={{
                            color: colors.text,
                            fontWeight: "bold",
                            fontSize: 16,
                            marginBottom: 2,
                          }}
                        >
                          {appt.client_name || "Appointment"}
                        </Text>

                        <Text
                          style={{
                            color: colors.mutedText,
                            fontSize: 12,
                            fontWeight: "600",
                            marginTop: 2,
                          }}
                        >
                          {formatTime(appt.appointment_time, timeFormat)}
                          {appt.end_time
                            ? ` - ${formatTime(appt.end_time, timeFormat)}`
                            : ""}
                        </Text>

                        {selectMode ? (
                          <Text
                            style={{
                              color: selected ? "#991B1B" : colors.mutedText,
                              fontSize: 13,
                              marginTop: 6,
                              fontWeight: "bold",
                            }}
                          >
                            {selected ? "Selected" : "Tap to select"}
                          </Text>
                        ) : null}
                      </Pressable>
                    );
                  })}

                  {dayBlocks.map((block) => {
                    const blockColors = getBlockColors(block.block_type);
                    const selected = selectedBlocks.includes(block.id);
                    const blockDisplayTitle =
                      block.title || formatBlockLabel(block.block_type);

                    return (
                      <Pressable
                        key={block.id}
                        onPress={() => {
                          if (selectMode) {
                            toggleBlock(block.id);
                            return;
                          }

                          router.push({
                            pathname: "/book-appointment",
                            params: {
                              blockId: block.id,
                              mode: "edit",
                            },
                          } as any);
                        }}
                        style={({ pressed }) => ({
                          backgroundColor: blockColors.bg,
                          paddingVertical: 14,
                          paddingHorizontal: 14,
                          borderRadius: 16,
                          marginBottom: 10,
                          borderLeftWidth: 6,
                          borderLeftColor: blockColors.border,
                          borderWidth: selected ? 3 : 1,
                          borderColor: selected
                            ? "#991B1B"
                            : blockColors.border,
                          opacity: pressed ? 0.8 : 1,
                        })}
                      >
                        <Text
                          style={{
                            color: "#111111",
                            fontWeight: "bold",
                            fontSize: 17,
                            marginBottom: 3,
                          }}
                        >
                          {blockDisplayTitle}
                        </Text>

                        <Text style={{ color: "#111111", fontSize: 13 }}>
                          {formatTime(block.start_time, timeFormat)} -{" "}
                          {formatTime(block.end_time, timeFormat)}
                        </Text>

                        <Text
                          style={{
                            color: "#334155",
                            fontSize: 13,
                            marginTop: 4,
                          }}
                        >
                          {formatBlockLabel(block.block_type)}
                        </Text>

                        {selectMode ? (
                          <Text
                            style={{
                              color: selected ? "#991B1B" : "#334155",
                              fontSize: 13,
                              marginTop: 6,
                              fontWeight: "bold",
                            }}
                          >
                            {selected ? "Selected" : "Tap to select"}
                          </Text>
                        ) : null}
                      </Pressable>
                    );
                  })}

                  {timeSlots
                    .filter((slot) => {
                      const slotMinutes = toMinutes(slot);
                      const nextSlotMinutes =
                        slotMinutes + calendarIntervalMinutes;

                      const hasAppointment = dayAppointments.some((appt) => {
                        const appointmentStart = toMinutes(
                          String(appt.appointment_time || "").slice(0, 5),
                        );

                        const appointmentEnd = appt.end_time
                          ? toMinutes(String(appt.end_time).slice(0, 5))
                          : appointmentStart + calendarIntervalMinutes;

                        return (
                          slotMinutes < appointmentEnd &&
                          nextSlotMinutes > appointmentStart
                        );
                      });

                      const isBlocked = dayBlocks.some((block) => {
                        const blockStart = toMinutes(
                          String(block.start_time || "").slice(0, 5),
                        );

                        const blockEnd = toMinutes(
                          String(block.end_time || "").slice(0, 5),
                        );

                        return (
                          slotMinutes < blockEnd && nextSlotMinutes > blockStart
                        );
                      });

                      return !hasAppointment && !isBlocked;
                    })
                    .map((slot) => {
                      const slotMinutes = toMinutes(slot);
                      const nextSlotMinutes =
                        slotMinutes + calendarIntervalMinutes;

                      const isCurrentTimeSlot =
                        item.date === todayIso() &&
                        currentMinutes >= slotMinutes &&
                        currentMinutes < nextSlotMinutes;

                      return (
                        <Pressable
                          key={slot}
                          onPress={() => {
                            router.push({
                              pathname: "/book-appointment",
                              params: {
                                appointmentDate: item.date,
                                appointmentTime: slot,
                                mode: "new",
                              },
                            } as any);
                          }}
                          style={{
                            paddingVertical: 8,
                            paddingHorizontal: 10,
                            borderRadius: 10,
                            backgroundColor: isCurrentTimeSlot
                              ? "#FEF3C7"
                              : "rgba(255,255,255,0.7)",
                            borderWidth: isCurrentTimeSlot ? 1 : 0,
                            borderColor: isCurrentTimeSlot
                              ? "#F59E0B"
                              : "transparent",
                            marginBottom: 6,
                          }}
                        >
                          <Text
                            style={{
                              color: isCurrentTimeSlot
                                ? "#92400E"
                                : colors.text,
                              fontWeight: isCurrentTimeSlot ? "700" : "500",
                            }}
                          >
                            {formatTime(slot, timeFormat)}
                          </Text>
                        </Pressable>
                      );
                    })}
                </View>
              ) : null}
            </View>
          );
        })}
      </AppScreen>

      <Pressable
        onPress={() => {
          setSelectMode(!selectMode);
          clearSelectedCalendarItems();
        }}
        style={{
          position: "absolute",
          right: 20,
          bottom: selectButtonBottom,
          backgroundColor: selectMode ? "#991B1B" : colors.primary,
          paddingVertical: 14,
          paddingHorizontal: 18,
          borderRadius: 999,
          elevation: 8,
        }}
      >
        <Text style={{ color: "#FFFFFF", fontWeight: "900" }}>
          {selectMode ? "Cancel Select" : "Select"}
        </Text>
      </Pressable>
    </View>
  );
}
