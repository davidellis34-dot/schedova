import { Ionicons } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { AppScreen } from "../components/layout/AppScreen";
import { confirmDestructiveAction } from "../lib/confirmDestructiveAction";
import {
  getAppointmentServiceNames,
  getAppointmentServices,
  getAppointmentServiceTotal,
} from "../lib/appointmentServices";
import {
  getAppointmentConfirmationLabel,
  getAppointmentConfirmationStatus,
  type AppointmentReplySummary,
} from "../lib/appointmentConfirmationStatus";
import { sendAppointmentSmsNonBlocking } from "../lib/appointmentSms";
import { getCalendarPreferences } from "../lib/calendarPreferences";
import { canUseFeature, useFeatureAccess } from "../lib/featureAccess";
import { cancelAppointmentReminder } from "../lib/localNotifications";
import { ENABLE_PRO } from "../lib/proFeatureFlag";
import { openSchedovaProScreen, PRO_UPSELL_COPY } from "../lib/proUpsell";
import { supabase } from "../lib/supabase";
import { getUSHolidaysForYears, type USHoliday } from "../lib/usHolidays";
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
const DEFAULT_BUSINESS_START_MINUTES = 8 * 60;
const DEFAULT_BUSINESS_END_MINUTES = 18 * 60;
const CALENDAR_LAYOUT_STORAGE_KEY = "schedova_calendar_layout";

type CalendarIntervalMinutes = 15 | 30 | 60;
type CalendarLayout = "list" | "grid";
type AppointmentStatusValue =
  | "scheduled"
  | "confirmed"
  | "completed"
  | "canceled"
  | "no_show";
type GridQuickAction = "today" | "this_week" | "next_week" | "open";
type TimeFormat = "12h" | "24h";
type SearchFilter =
  | "selected_day"
  | "today"
  | "all"
  | "upcoming"
  | "this_week"
  | "next_week"
  | "past"
  | "open"
  | "client"
  | "date"
  | "status"
  | "service";

const SEARCH_FILTERS: { label: string; value: SearchFilter }[] = [
  { label: "Selected day", value: "selected_day" },
  { label: "Today", value: "today" },
  { label: "Upcoming", value: "upcoming" },
  { label: "Past", value: "past" },
  { label: "All", value: "all" },
  { label: "This week", value: "this_week" },
  { label: "Next week", value: "next_week" },
  { label: "Open", value: "open" },
  { label: "Client", value: "client" },
  { label: "Date", value: "date" },
  { label: "Status", value: "status" },
  { label: "Service", value: "service" },
];

const QUICK_SEARCH_FILTERS: { label: string; value: SearchFilter }[] = [
  { label: "Today", value: "today" },
  { label: "Upcoming", value: "upcoming" },
  { label: "Past", value: "past" },
  { label: "All", value: "all" },
];

const GRID_QUICK_ACTIONS: { label: string; value: GridQuickAction }[] = [
  { label: "Today", value: "today" },
  { label: "This week", value: "this_week" },
  { label: "Next week", value: "next_week" },
  { label: "Open", value: "open" },
];

function getLayoutLabel(layout: CalendarLayout) {
  return layout === "grid" ? "Calendar" : "List";
}

const APPOINTMENT_STATUS_OPTIONS: {
  label: string;
  value: AppointmentStatusValue;
}[] = [
  { label: "Scheduled", value: "scheduled" },
  { label: "Confirmed", value: "confirmed" },
  { label: "Completed", value: "completed" },
  { label: "Canceled", value: "canceled" },
  { label: "No-show", value: "no_show" },
];

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

function addDaysToIso(dateText: string, days: number) {
  const date = parseDateOnly(dateText);
  date.setDate(date.getDate() + days);

  return toDateOnly(date);
}

function getWeekRange(weekOffset = 0) {
  const start = parseDateOnly(todayIso());
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - start.getDay() + weekOffset * 7);

  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  end.setHours(23, 59, 59, 999);

  return { start, end };
}

function isAppointmentInDateRange(appointment: any, start: Date, end: Date) {
  const appointmentDate = parseDateOnly(appointment?.appointment_date);
  appointmentDate.setHours(12, 0, 0, 0);

  return (
    appointmentDate.getTime() >= start.getTime() &&
    appointmentDate.getTime() <= end.getTime()
  );
}

function isValidAppointmentForDisplay(appointment: any) {
  if (!appointment || typeof appointment !== "object") return false;
  if (!appointment.id) return false;
  if (!appointment?.appointment_date) return false;
  if (!appointment?.appointment_time) return false;

  return true;
}

function getAvailabilityWindowForDate(dateText: string, rules: any[] = []) {
  const dayNumber = parseDateOnly(dateText).getDay();
  const rule = rules.find(
    (item) => Number(item?.day_of_week) === Number(dayNumber),
  );

  if (!rule) {
    return {
      isAvailable: true,
      startMinutes: DEFAULT_BUSINESS_START_MINUTES,
      endMinutes: DEFAULT_BUSINESS_END_MINUTES,
      hasRule: false,
    };
  }

  const startMinutes = toMinutes(String(rule.start_time || "08:00").slice(0, 5));
  const endMinutes = toMinutes(String(rule.end_time || "18:00").slice(0, 5));
  const safeStart = Number.isFinite(startMinutes)
    ? startMinutes
    : DEFAULT_BUSINESS_START_MINUTES;
  const safeEnd =
    Number.isFinite(endMinutes) && endMinutes > safeStart
      ? endMinutes
      : DEFAULT_BUSINESS_END_MINUTES;

  return {
    isAvailable:
      rule.is_available === undefined || rule.is_available === null
        ? true
        : Boolean(rule.is_available),
    startMinutes: safeStart,
    endMinutes: safeEnd,
    hasRule: true,
  };
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

function toValidMinutes(value: unknown) {
  const normalized = normalizeTimeText(value);

  if (!/^\d{1,2}:\d{2}$/.test(normalized)) return null;

  const [hours, minutes] = normalized.split(":").map(Number);

  if (
    !Number.isFinite(hours) ||
    !Number.isFinite(minutes) ||
    hours < 0 ||
    hours > 23 ||
    minutes < 0 ||
    minutes > 59
  ) {
    return null;
  }

  return hours * 60 + minutes;
}

function positiveDurationMinutes(value: unknown) {
  const numberValue = Number(value);
  if (!Number.isFinite(numberValue) || numberValue <= 0) return null;

  return Math.max(5, Math.round(numberValue / 5) * 5);
}

function minutesToTimeText(minutes: number) {
  const safeMinutes = ((Math.round(minutes) % 1440) + 1440) % 1440;
  const hours = Math.floor(safeMinutes / 60);
  const remainingMinutes = safeMinutes % 60;

  return `${String(hours).padStart(2, "0")}:${String(
    remainingMinutes,
  ).padStart(2, "0")}`;
}

function getAppointmentEndMinutes(
  appointment: any,
  fallbackDurationMinutes: number,
) {
  const appointmentStart = toMinutes(
    String(appointment?.appointment_time || "").slice(0, 5),
  );
  const explicitEnd = appointment?.end_time
    ? toMinutes(String(appointment.end_time).slice(0, 5))
    : Number.NaN;
  const savedDuration = positiveDurationMinutes(appointment?.duration_minutes);

  if (Number.isFinite(appointmentStart) && savedDuration) {
    return appointmentStart + savedDuration;
  }

  if (
    Number.isFinite(appointmentStart) &&
    Number.isFinite(explicitEnd) &&
    explicitEnd > appointmentStart
  ) {
    return explicitEnd;
  }

  const fallbackDuration =
    positiveDurationMinutes(fallbackDurationMinutes) || DEFAULT_INTERVAL_MINUTES;

  if (Number.isFinite(appointmentStart)) {
    return appointmentStart + fallbackDuration;
  }

  return Number.isFinite(explicitEnd) ? explicitEnd : fallbackDuration;
}

function getAppointmentEndTimeText(
  appointment: any,
  fallbackDurationMinutes: number,
) {
  return minutesToTimeText(
    getAppointmentEndMinutes(appointment, fallbackDurationMinutes),
  );
}

function getSlotStartsForHour(
  hourStartMinutes: number,
  intervalMinutes: number,
) {
  const safeInterval =
    positiveDurationMinutes(intervalMinutes) || DEFAULT_INTERVAL_MINUTES;
  const starts: number[] = [];
  let current = hourStartMinutes;
  const hourEnd = hourStartMinutes + 60;

  while (current < hourEnd) {
    starts.push(current);
    current += safeInterval;
  }

  return starts;
}

function rangesOverlap(
  startA: number,
  endA: number,
  startB: number,
  endB: number,
) {
  return startA < endB && endA > startB;
}

function appointmentOverlapsSlot(
  appointment: any,
  slotStart: number,
  slotEnd: number,
  fallbackDurationMinutes: number,
) {
  const appointmentStart = toMinutes(
    String(appointment?.appointment_time || "").slice(0, 5),
  );
  const appointmentEnd = getAppointmentEndMinutes(
    appointment,
    fallbackDurationMinutes,
  );

  if (!Number.isFinite(appointmentStart) || !Number.isFinite(appointmentEnd)) {
    return false;
  }

  return rangesOverlap(slotStart, slotEnd, appointmentStart, appointmentEnd);
}

function blockOverlapsSlot(block: any, slotStart: number, slotEnd: number) {
  const blockStart = toValidMinutes(block?.start_time);
  const blockEnd = toValidMinutes(block?.end_time);

  if (blockStart === null || blockEnd === null || blockEnd <= blockStart) {
    return true;
  }

  return rangesOverlap(slotStart, slotEnd, blockStart, blockEnd);
}

function isGridSlotAvailable({
  slotStart,
  slotEnd,
  availabilityWindow,
  appointments,
  blocks,
  intervalMinutes,
}: {
  slotStart: number;
  slotEnd: number;
  availabilityWindow: ReturnType<typeof getAvailabilityWindowForDate>;
  appointments: any[];
  blocks: any[];
  intervalMinutes: number;
}) {
  if (!availabilityWindow.isAvailable) return false;
  if (slotStart < availabilityWindow.startMinutes) return false;
  if (slotEnd > availabilityWindow.endMinutes) return false;

  const hasAppointment = appointments.some((appointment) =>
    appointmentOverlapsSlot(
      appointment,
      slotStart,
      slotEnd,
      intervalMinutes,
    ),
  );

  if (hasAppointment) return false;

  return !blocks.some((block) => blockOverlapsSlot(block, slotStart, slotEnd));
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

function formatStatusText(status?: string | null) {
  switch (status) {
    case "completed":
      return "Completed";
    case "canceled":
    case "cancelled":
    case "customer_canceled":
    case "customer_cancelled":
    case "business_canceled":
    case "business_cancelled":
      return "Canceled";
    case "no_show":
      return "No show";
    case "scheduled":
      return "Scheduled";
    case "confirmed":
      return "Confirmed";
    default:
      return "Appointment";
  }
}

function normalizeStatusValue(status?: string | null): AppointmentStatusValue {
  switch (status) {
    case "confirmed":
      return "confirmed";
    case "completed":
      return "completed";
    case "canceled":
    case "cancelled":
    case "customer_canceled":
    case "customer_cancelled":
    case "business_canceled":
    case "business_cancelled":
      return "canceled";
    case "no_show":
      return "no_show";
    case "scheduled":
    default:
      return "scheduled";
  }
}

function isCanceledAppointment(appointment: any) {
  return [
    "canceled",
    "cancelled",
    "customer_canceled",
    "customer_cancelled",
    "business_canceled",
    "business_cancelled",
  ].includes(String(appointment?.status || ""));
}

function isArchivedAppointment(appointment: any) {
  return Boolean(appointment?.archived || appointment?.archived_at);
}

function isCompletedAppointment(appointment: any) {
  return String(appointment?.status || "") === "completed";
}

function isOpenAppointment(appointment: any, now = Date.now()) {
  return (
    getAppointmentSortTime(appointment) >= now &&
    !isArchivedAppointment(appointment) &&
    !isCanceledAppointment(appointment) &&
    !isCompletedAppointment(appointment)
  );
}

function getSearchFilterLabel(filter: SearchFilter) {
  return (
    SEARCH_FILTERS.find((item) => item.value === filter)?.label || "All"
  );
}

function getSearchPlaceholder(_filter: SearchFilter) {
  return "Find appointment";
}

function getSearchRelativeDateWords(dateText?: string | null) {
  const words: string[] = [];
  const targetDate = parseDateOnly(String(dateText || ""));
  const today = parseDateOnly(todayIso());
  const tomorrow = parseDateOnly(todayIso());
  tomorrow.setDate(tomorrow.getDate() + 1);

  if (toDateOnly(targetDate) === toDateOnly(today)) {
    words.push("today");
  }

  if (toDateOnly(targetDate) === toDateOnly(tomorrow)) {
    words.push("tomorrow");
  }

  return words;
}

function getAppointmentDateSearchText(appointment: any) {
  const dateText = String(appointment?.appointment_date || "");
  const date = parseDateOnly(dateText);
  const readableDate = date.toLocaleDateString(undefined, {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
  const shortMonthDate = date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
  const numericDate = `${date.getMonth() + 1}/${date.getDate()}/${date.getFullYear()}`;
  const numericDateWithoutYear = `${date.getMonth() + 1}/${date.getDate()}`;

  return [
    dateText,
    readableDate,
    shortMonthDate,
    numericDate,
    numericDateWithoutYear,
    String(date.getDate()),
    date.toLocaleDateString(undefined, { month: "long" }),
    date.toLocaleDateString(undefined, { month: "short" }),
    ...getSearchRelativeDateWords(dateText),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function getAppointmentTimeWindowSearchText(appointment: any) {
  const words: string[] = [];
  const sortTime = getAppointmentEndSortTime(appointment);
  const now = Date.now();
  const thisWeek = getWeekRange(0);
  const nextWeek = getWeekRange(1);

  if (sortTime >= now) words.push("upcoming");
  if (sortTime < now) words.push("past");
  if (isOpenAppointment(appointment, now)) words.push("open");
  if (isAppointmentInDateRange(appointment, thisWeek.start, thisWeek.end)) {
    words.push("this week");
  }
  if (isAppointmentInDateRange(appointment, nextWeek.start, nextWeek.end)) {
    words.push("next week");
  }

  return words.join(" ").toLowerCase();
}

function getAppointmentSearchText(
  appointment: any,
  filter: SearchFilter,
  services: any[] = [],
  clients: any[] = [],
) {
  const matchedClient = clients.find(
    (client) => String(client?.id) === String(appointment?.client_id),
  );
  const clientText = [
    appointment?.client_name,
    matchedClient?.name,
    matchedClient?.phone,
    matchedClient?.email,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  const dateText = getAppointmentDateSearchText(appointment);
  const statusText = formatStatusText(appointment?.status).toLowerCase();
  const serviceText = getAppointmentServiceNames(appointment, services)
    .join(" ")
    .toLowerCase();
  const notesText = String(
    appointment?.notes || appointment?.appointment_notes || "",
  ).toLowerCase();
  const timeWindowText = getAppointmentTimeWindowSearchText(appointment);

  switch (filter) {
    case "client":
      return clientText;
    case "date":
      return dateText;
    case "status":
      return statusText;
    case "service":
      return serviceText;
    default:
      return [
        clientText,
        dateText,
        statusText,
        serviceText,
        notesText,
        timeWindowText,
      ].join(" ");
  }
}

function getAppointmentSortTime(appointment: any) {
  const dateText = String(appointment?.appointment_date || "");
  const timeText = normalizeTimeText(appointment?.appointment_time) || "12:00";
  const timestamp = new Date(`${dateText}T${timeText}:00`).getTime();

  return Number.isFinite(timestamp) ? timestamp : 0;
}

function getAppointmentEndSortTime(appointment: any) {
  const dateText = String(appointment?.appointment_date || "");
  const endMinutes = getAppointmentEndMinutes(
    appointment,
    DEFAULT_INTERVAL_MINUTES,
  );
  const endTimeText = minutesToTimeText(endMinutes);
  const timestamp = new Date(`${dateText}T${endTimeText}:00`).getTime();

  return Number.isFinite(timestamp)
    ? timestamp
    : getAppointmentSortTime(appointment);
}

function formatAppointmentDateLabel(dateText?: string | null) {
  const date = parseDateOnly(String(dateText || ""));

  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function getAppointmentDisplayPrice(appointment: any, services: any[] = []) {
  if (
    appointment?.final_price !== null &&
    appointment?.final_price !== undefined &&
    appointment?.final_price !== ""
  ) {
    const finalPrice = Number(appointment.final_price);

    return Number.isFinite(finalPrice) ? finalPrice : 0;
  }

  return getAppointmentServiceTotal(appointment, services);
}

function normalizeHexColor(value: unknown) {
  if (typeof value !== "string") return "";

  const trimmed = value.trim();

  if (/^#[0-9A-F]{6}$/i.test(trimmed)) {
    return trimmed;
  }

  if (/^[0-9A-F]{6}$/i.test(trimmed)) {
    return `#${trimmed}`;
  }

  return "";
}

function getReadableTextColor(backgroundColor: string) {
  const hex = normalizeHexColor(backgroundColor);

  if (!hex) return "#FFFFFF";

  const red = parseInt(hex.slice(1, 3), 16);
  const green = parseInt(hex.slice(3, 5), 16);
  const blue = parseInt(hex.slice(5, 7), 16);
  const brightness = (red * 299 + green * 587 + blue * 114) / 1000;

  return brightness > 168 ? "#111827" : "#FFFFFF";
}

function getAppointmentBlockColor(
  appointment: any,
  services: any[] = [],
  fallbackColor = "#2563EB",
) {
  if (isCanceledAppointment(appointment)) return "#64748B";
  if (isCompletedAppointment(appointment)) return "#047857";
  if (String(appointment?.status || "") === "no_show") return "#C2410C";

  const serviceColor = getAppointmentServices(appointment, services).find(
    (service) => normalizeHexColor(service.color_hex),
  )?.color_hex;

  return normalizeHexColor(serviceColor) || fallbackColor;
}

function shouldShowResultsWithoutSearch(filter: SearchFilter) {
  return !["selected_day", "client", "date", "status", "service"].includes(
    filter,
  );
}

function isGridScheduleFilter(filter: SearchFilter) {
  return ["selected_day", "this_week", "next_week"].includes(filter);
}

function appointmentMatchesFinderFilter(
  appointment: any,
  filter: SearchFilter,
  now: number,
) {
  const endSortTime = getAppointmentEndSortTime(appointment);

  switch (filter) {
    case "today":
      return String(appointment?.appointment_date || "") === todayIso();
    case "upcoming":
      return endSortTime >= now;
    case "this_week": {
      const range = getWeekRange(0);
      return isAppointmentInDateRange(appointment, range.start, range.end);
    }
    case "next_week": {
      const range = getWeekRange(1);
      return isAppointmentInDateRange(appointment, range.start, range.end);
    }
    case "past":
      return endSortTime < now;
    case "open":
      return isOpenAppointment(appointment, now);
    default:
      return true;
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
  const { colors, themeName } = useAppTheme();
  useFeatureAccess();
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const isLandscape = width > height;
  const customScheduleAvailable = canUseFeature("customBusinessHours");
  const { selectedDate, selectedTime } = useLocalSearchParams();

  const initialDate =
    typeof selectedDate === "string" && selectedDate
      ? selectedDate
      : todayIso();

  const [baseDate, setBaseDate] = useState(initialDate);
  const [availabilityRules, setAvailabilityRules] = useState<any[]>([]);
  const [appointments, setAppointments] = useState<any[]>([]);
  const [finderAppointments, setFinderAppointments] = useState<any[]>([]);
  const [services, setServices] = useState<any[]>([]);
  const [clients, setClients] = useState<any[]>([]);
  const [latestRepliesByAppointmentId, setLatestRepliesByAppointmentId] =
    useState<Record<string, AppointmentReplySummary>>({});
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
  const [calendarLayout, setCalendarLayout] = useState<CalendarLayout>("list");
  const [timeFormat, setTimeFormat] = useState<TimeFormat>(DEFAULT_TIME_FORMAT);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchFilter, setSearchFilter] = useState<SearchFilter>(
    typeof selectedDate === "string" && selectedDate
      ? "selected_day"
      : "today",
  );
  const [filterModalVisible, setFilterModalVisible] = useState(false);
  const [statusMenuAppointment, setStatusMenuAppointment] =
    useState<any | null>(null);
  const [statusUpdatingId, setStatusUpdatingId] = useState<string | null>(null);

  const scrollRef = useRef<ScrollView>(null);
  const dayLayouts = useRef<Record<string, number>>({});
  const hasAutoScrolled = useRef(false);
  const fetchRequestId = useRef(0);

  const todayKey = initialDate;

  const weekDates = useMemo(
    () => getWeekDates(baseDate, weekOffset),
    [baseDate, weekOffset],
  );
  const holidaysByDate = useMemo(() => {
    const todayYear = parseDateOnly(todayIso()).getFullYear();
    const visibleYears = weekDates.map((item) =>
      parseDateOnly(item.date).getFullYear(),
    );
    const holidayYears = [
      todayYear - 1,
      todayYear,
      todayYear + 1,
      ...visibleYears,
      ...visibleYears.map((year) => year - 1),
      ...visibleYears.map((year) => year + 1),
    ];

    return getUSHolidaysForYears(holidayYears).reduce<
      Record<string, USHoliday[]>
    >((groupedHolidays, holiday) => {
      groupedHolidays[holiday.date] = [
        ...(groupedHolidays[holiday.date] || []),
        holiday,
      ];

      return groupedHolidays;
    }, {});
  }, [weekDates]);

  const currentMinutes = new Date().getHours() * 60 + new Date().getMinutes();

  const parsedSelectedHour =
    typeof selectedTime === "string" ? Number(selectedTime.slice(0, 2)) : NaN;
  const shouldAutoScrollToSelectedTime =
    typeof selectedTime === "string" && selectedTime.length >= 2;

  const scrollHour = Number.isFinite(parsedSelectedHour)
    ? parsedSelectedHour
    : new Date().getHours();
  const selectButtonBottom = Platform.OS === "ios" ? insets.bottom + 24 : 24;
  const isDarkTheme = themeName === "dark" || themeName === "black";
  const infoAccent = isDarkTheme ? "#60A5FA" : "#2563EB";
  const infoAccentSoft = isDarkTheme
    ? "rgba(96, 165, 250, 0.16)"
    : "rgba(37, 99, 235, 0.10)";
  const infoAccentBorder = isDarkTheme
    ? "rgba(96, 165, 250, 0.32)"
    : "rgba(37, 99, 235, 0.24)";
  const polishedBorder = isDarkTheme
    ? "rgba(148, 163, 184, 0.28)"
    : "rgba(15, 23, 42, 0.12)";

  const getStatusColor = (status?: string) => {
    switch (status) {
      case "completed":
        return "#16A34A";
      case "canceled":
      case "cancelled":
      case "customer_canceled":
      case "customer_cancelled":
      case "business_canceled":
      case "business_cancelled":
        return "#DC2626";
      case "no_show":
        return "#EA580C";
      case "confirmed":
        return infoAccent;
      default:
        return infoAccent;
    }
  };

  const effectiveSelectedDate = addWeeksToDate(baseDate, weekOffset);
  const trimmedSearchQuery = searchQuery.trim().toLowerCase();
  const hasSearchQuery = trimmedSearchQuery.length > 0;
  const finderActive =
    hasSearchQuery ||
    (calendarLayout === "grid"
      ? !isGridScheduleFilter(searchFilter)
      : searchFilter !== "selected_day");

  const searchResults = useMemo(() => {
    if (!finderActive) return [];
    if (!trimmedSearchQuery && !shouldShowResultsWithoutSearch(searchFilter)) {
      return [];
    }

    const now = Date.now();

    return finderAppointments
      .filter((appointment) => isValidAppointmentForDisplay(appointment))
      .filter((appointment) => !isArchivedAppointment(appointment))
      .filter((appointment) =>
        appointmentMatchesFinderFilter(appointment, searchFilter, now),
      )
      .filter((appointment) => {
        if (!trimmedSearchQuery) return true;

        return getAppointmentSearchText(
          appointment,
          searchFilter,
          services,
          clients,
        ).includes(trimmedSearchQuery);
      })
      .sort((a, b) => {
        const sortA = getAppointmentSortTime(a);
        const sortB = getAppointmentSortTime(b);

        return searchFilter === "past" ? sortB - sortA : sortA - sortB;
      });
  }, [
    finderActive,
    finderAppointments,
    clients,
    searchFilter,
    services,
    trimmedSearchQuery,
  ]);
  const finderResultCountText =
    searchResults.length === 0
      ? "No appointments found"
      : `${searchResults.length} appointment${
          searchResults.length === 1 ? "" : "s"
        } found`;
  const selectedGridDate = effectiveSelectedDate;
  const selectedGridDay =
    weekDates.find((item) => item.date === selectedGridDate) || weekDates[0];
  const selectedGridAppointments = useMemo(
    () =>
      appointments.filter(
        (appointment) =>
          isValidAppointmentForDisplay(appointment) &&
          appointment.appointment_date === selectedGridDate,
      ),
    [appointments, selectedGridDate],
  );
  const selectedGridBlocks = useMemo(
    () => blocks.filter((block) => block.block_date === selectedGridDate),
    [blocks, selectedGridDate],
  );
  const selectedAvailabilityWindow = useMemo(
    () => getAvailabilityWindowForDate(selectedGridDate, availabilityRules),
    [availabilityRules, selectedGridDate],
  );
  const gridRangeDates = useMemo(
    () =>
      calendarLayout === "grid" && isLandscape
        ? weekDates.map((item) => item.date)
        : [selectedGridDate],
    [calendarLayout, isLandscape, selectedGridDate, weekDates],
  );
  const gridRangeAppointments = useMemo(
    () =>
      appointments.filter(
        (appointment) =>
          isValidAppointmentForDisplay(appointment) &&
          gridRangeDates.includes(String(appointment.appointment_date || "")),
      ),
    [appointments, gridRangeDates],
  );
  const gridRangeBlocks = useMemo(
    () =>
      blocks.filter((block) =>
        gridRangeDates.includes(String(block.block_date || "")),
      ),
    [blocks, gridRangeDates],
  );
  const gridAvailabilityWindows = useMemo(
    () =>
      gridRangeDates.map((date) =>
        getAvailabilityWindowForDate(date, availabilityRules),
      ),
    [availabilityRules, gridRangeDates],
  );
  const gridStartHour = useMemo(() => {
    const starts = [
      ...gridAvailabilityWindows
        .filter((window) => window.isAvailable)
        .map((window) => window.startMinutes),
      ...gridRangeAppointments.map((appointment) =>
        toMinutes(String(appointment.appointment_time || "").slice(0, 5)),
      ),
      ...gridRangeBlocks
        .map((block) => toValidMinutes(block.start_time))
        .filter((minutes) => minutes !== null),
    ].filter((minutes) => Number.isFinite(Number(minutes)));

    if (starts.length === 0) {
      return Math.floor(DEFAULT_BUSINESS_START_MINUTES / 60);
    }

    return Math.max(0, Math.floor(Math.min(...starts.map(Number)) / 60));
  }, [
    gridAvailabilityWindows,
    gridRangeAppointments,
    gridRangeBlocks,
  ]);
  const gridEndHour = useMemo(() => {
    const ends = [
      ...gridAvailabilityWindows
        .filter((window) => window.isAvailable)
        .map((window) => window.endMinutes),
      ...gridRangeAppointments.map((appointment) =>
        getAppointmentEndMinutes(appointment, calendarIntervalMinutes),
      ),
      ...gridRangeBlocks
        .map((block) => toValidMinutes(block.end_time))
        .filter((minutes) => minutes !== null),
    ].filter((minutes) => Number.isFinite(Number(minutes)));

    if (ends.length === 0) {
      return Math.ceil(DEFAULT_BUSINESS_END_MINUTES / 60);
    }

    return Math.min(
      30,
      Math.max(gridStartHour + 1, Math.ceil(Math.max(...ends.map(Number)) / 60)),
    );
  }, [
    calendarIntervalMinutes,
    gridAvailabilityWindows,
    gridStartHour,
    gridRangeAppointments,
    gridRangeBlocks,
  ]);
  const gridHourSlots = useMemo(
    () =>
      Array.from(
        { length: Math.max(1, gridEndHour - gridStartHour) },
        (_, index) => gridStartHour + index,
      ),
    [gridEndHour, gridStartHour],
  );

  function handleSearchChange(value: string) {
    setSearchQuery(value);
  }

  function handleSearchFilterChange(filter: SearchFilter) {
    setSearchFilter(filter);

    if (filter === "selected_day") {
      setSearchQuery("");
    }

    if (filter === "today") {
      setBaseDate(todayIso());
      setWeekOffset(0);
    }

    if (calendarLayout === "grid" && !searchQuery.trim()) {
      if (filter === "this_week") {
        setBaseDate(todayIso());
        setWeekOffset(0);
      }

      if (filter === "next_week") {
        setBaseDate(todayIso());
        setWeekOffset(1);
      }
    }
  }

  async function handleLayoutChange(layout: CalendarLayout) {
    setCalendarLayout(layout);

    if (layout === "grid") {
      setSearchQuery("");

      if (!isGridScheduleFilter(searchFilter)) {
        setSearchFilter("selected_day");
      }
    }

    try {
      await AsyncStorage.setItem(CALENDAR_LAYOUT_STORAGE_KEY, layout);
    } catch (error) {
      console.log("Unable to save calendar layout preference", error);
    }
  }

  function handleGridQuickAction(action: GridQuickAction) {
    hasAutoScrolled.current = false;

    switch (action) {
      case "today":
        setSearchQuery("");
        setSearchFilter("selected_day");
        selectGridDate(todayIso());
        return;
      case "this_week":
        setSearchQuery("");
        setSearchFilter("this_week");
        setBaseDate(todayIso());
        setWeekOffset(0);
        return;
      case "next_week":
        setSearchQuery("");
        setSearchFilter("next_week");
        setBaseDate(todayIso());
        setWeekOffset(1);
        return;
      case "open":
        setSearchQuery("");
        setSearchFilter("open");
        return;
      default:
        return;
    }
  }

  function isGridQuickActionSelected(action: GridQuickAction) {
    if (action === "open") return searchFilter === "open";
    if (finderActive) return false;
    if (action === "today") {
      return selectedGridDate === todayIso() && searchFilter === "selected_day";
    }
    if (action === "this_week") {
      return searchFilter === "this_week";
    }
    if (action === "next_week") {
      return searchFilter === "next_week";
    }

    return false;
  }

  useEffect(() => {
    setOpenDays((current) => ({
      ...current,
      [effectiveSelectedDate]: true,
    }));
  }, [effectiveSelectedDate]);

  useEffect(() => {
    let mounted = true;

    async function loadLayoutPreference() {
      try {
        const savedLayout = await AsyncStorage.getItem(
          CALENDAR_LAYOUT_STORAGE_KEY,
        );

        if (!mounted) return;

        if (savedLayout === "list" || savedLayout === "grid") {
          setCalendarLayout(savedLayout);

          if (savedLayout === "grid") {
            setSearchQuery("");
            setSearchFilter("selected_day");
          }
        }
      } catch (error) {
        console.log("Unable to load calendar layout preference", error);
      }
    }

    void loadLayoutPreference();

    return () => {
      mounted = false;
    };
  }, []);

  useFocusEffect(
    useCallback(() => {
      let active = true;

      async function loadPreferences() {
        const preferences = await loadCalendarDisplayPreferences();

        if (!active) return;

        setCalendarIntervalMinutes(preferences.intervalMinutes);
        setTimeFormat(preferences.timeFormat);
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

    const finderStart = addDaysToIso(todayIso(), -180);
    const finderEnd = addDaysToIso(todayIso(), 365);

    const [
      appointmentsResult,
      finderAppointmentsResult,
      servicesResult,
      clientsResult,
    ] =
      await Promise.all([
        supabase
          .from("appointments")
          .select("*")
          .eq("user_id", userId)
          .gte("appointment_date", weekStart)
          .lte("appointment_date", weekEnd)
          .order("appointment_date", { ascending: true })
          .order("appointment_time", { ascending: true }),
        supabase
          .from("appointments")
          .select("*")
          .eq("user_id", userId)
          .gte("appointment_date", finderStart)
          .lte("appointment_date", finderEnd)
          .order("appointment_date", { ascending: true })
          .order("appointment_time", { ascending: true }),
        supabase.from("services").select("*").eq("user_id", userId),
        supabase
          .from("clients")
          .select("id, name, phone, email")
          .eq("user_id", userId),
      ]);

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

        return true;
      });
    }

    if (requestId !== fetchRequestId.current) return;

    if (appointmentsResult.error) {
      Alert.alert("Error", appointmentsResult.error.message);
      setAppointments([]);
      return;
    }

    const nextAppointments = (appointmentsResult.data || []).filter((appt: any) => {
      if (!isValidAppointmentForDisplay(appt)) return false;
      if (appt.status === "canceled") return false;

      return true;
    });
    let nextFinderAppointments: any[] = [];

    if (finderAppointmentsResult.error) {
      console.log(
        "Unable to load calendar finder appointments",
        finderAppointmentsResult.error.message,
      );
      setFinderAppointments([]);
    } else {
      nextFinderAppointments = (finderAppointmentsResult.data || []).filter(
        isValidAppointmentForDisplay,
      );
      setFinderAppointments(nextFinderAppointments);
    }

    if (servicesResult.error) {
      console.log("Unable to load calendar services", servicesResult.error.message);
      setServices([]);
    } else {
      setServices(servicesResult.data || []);
    }

    if (clientsResult.error) {
      console.log("Unable to load calendar clients", clientsResult.error.message);
      setClients([]);
    } else {
      setClients(clientsResult.data || []);
    }

    const appointmentIds = Array.from(
      new Set(
        [...nextAppointments, ...nextFinderAppointments]
          .map((appointment) => appointment?.id)
          .filter(Boolean)
          .map(String),
      ),
    );

    if (appointmentIds.length > 0) {
      const repliesResult = await supabase
        .from("sms_message_logs")
        .select("id, appointment_id, body, message_body, needs_attention, created_at")
        .eq("user_id", userId)
        .eq("direction", "inbound")
        .in("appointment_id", appointmentIds)
        .order("created_at", { ascending: false });

      if (requestId !== fetchRequestId.current) return;

      if (repliesResult.error) {
        console.log(
          "Unable to load latest appointment replies",
          repliesResult.error.message,
        );
        setLatestRepliesByAppointmentId({});
      } else {
        const nextRepliesByAppointmentId: Record<string, AppointmentReplySummary> =
          {};

        for (const reply of repliesResult.data || []) {
          const appointmentId = String(reply?.appointment_id || "");
          if (!appointmentId || nextRepliesByAppointmentId[appointmentId]) {
            continue;
          }

          nextRepliesByAppointmentId[appointmentId] = reply;
        }

        setLatestRepliesByAppointmentId(nextRepliesByAppointmentId);
      }
    } else {
      setLatestRepliesByAppointmentId({});
    }

    setAppointments(nextAppointments);

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
          isValidAppointmentForDisplay(appointment) &&
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

  function applyAppointmentUpdate(updatedAppointment: any) {
    const updatedAppointmentId = updatedAppointment?.id;

    if (!updatedAppointmentId) return;

    if (!isValidAppointmentForDisplay(updatedAppointment)) {
      console.log("Ignoring malformed appointment update", {
        appointmentId: updatedAppointmentId,
      });
      setAppointments((current) =>
        current.filter((appointment) => isValidAppointmentForDisplay(appointment)),
      );
      setFinderAppointments((current) =>
        current.filter((appointment) => isValidAppointmentForDisplay(appointment)),
      );
      setStatusMenuAppointment(null);
      void fetchCalendarData();
      return;
    }

    setAppointments((current) =>
      current
        .filter((appointment) => isValidAppointmentForDisplay(appointment))
        .map((appointment) =>
          String(appointment.id) === String(updatedAppointmentId)
            ? updatedAppointment
            : appointment,
        ),
    );
    setFinderAppointments((current) =>
      current
        .filter((appointment) => isValidAppointmentForDisplay(appointment))
        .map((appointment) =>
          String(appointment.id) === String(updatedAppointmentId)
            ? updatedAppointment
            : appointment,
        ),
    );
    setStatusMenuAppointment((current: any | null) =>
      String(current?.id || "") === String(updatedAppointmentId)
        ? updatedAppointment
        : current,
    );
  }

  async function updateAppointmentStatus(
    appointment: any,
    status: AppointmentStatusValue,
  ) {
    if (!appointment?.id || statusUpdatingId) return;

    setStatusUpdatingId(appointment.id);

    try {
      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser();

      if (userError || !user) {
        Alert.alert("Not signed in", "Please sign in again.");
        return;
      }

      const { data, error } = await supabase
        .from("appointments")
        .update({ status })
        .eq("id", appointment.id)
        .eq("user_id", user.id)
        .select("*")
        .maybeSingle();

      if (error) {
        Alert.alert(
          "Status not updated",
          "Unable to update appointment status. Please try again.",
        );
        return;
      }

      const updatedAppointment = data || { ...appointment, status };
      applyAppointmentUpdate(updatedAppointment);

      if (status === "canceled") {
        if (canUseFeature("smsAutomation")) {
          void sendAppointmentSmsNonBlocking(appointment.id, "cancellation");
        }

        await cancelAppointmentReminder(appointment.id);
      }

      setStatusMenuAppointment(null);
    } catch (error) {
      console.log("Unable to update appointment status", error);
      Alert.alert(
        "Status not updated",
        "Unable to update appointment status. Please try again.",
      );
    } finally {
      setStatusUpdatingId(null);
    }
  }

  function renderStatusPill(
    appointment: any,
    options: {
      compact?: boolean;
      onColor?: boolean;
      textColor?: string;
    } = {},
  ) {
    const normalizedStatus = normalizeStatusValue(appointment?.status);
    const statusLabel = formatStatusText(normalizedStatus);
    const isUpdating = statusUpdatingId === appointment?.id;
    const pillText = isUpdating ? "Updating..." : statusLabel;
    const statusColor = getStatusColor(normalizedStatus);
    const textColor = options.onColor
      ? options.textColor || "#FFFFFF"
      : statusColor;
    const borderColor = options.onColor
      ? "rgba(255,255,255,0.42)"
      : statusColor;
    const backgroundColor = options.onColor
      ? "rgba(255,255,255,0.18)"
      : `${statusColor}14`;

    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Update appointment status for ${
          appointment?.client_name || "Client"
        }`}
        disabled={Boolean(isUpdating)}
        hitSlop={4}
        onPress={(event) => {
          event.stopPropagation();
          setStatusMenuAppointment(appointment);
        }}
        style={({ pressed }) => ({
          alignSelf: "flex-start",
          backgroundColor,
          borderColor,
          borderWidth: 1,
          borderRadius: 999,
          opacity: pressed ? 0.82 : 1,
          paddingHorizontal: options.compact ? 7 : 9,
          paddingVertical: options.compact ? 3 : 4,
        })}
      >
        <Text
          numberOfLines={1}
          style={{
            color: textColor,
            fontSize: options.compact ? 10 : 11,
            fontWeight: "900",
          }}
        >
          {pillText}
        </Text>
      </Pressable>
    );
  }

  function renderConfirmationChip(
    appointment: any,
    options: {
      compact?: boolean;
      onColor?: boolean;
      textColor?: string;
    } = {},
  ) {
    const confirmationStatus = getAppointmentConfirmationStatus(
      appointment,
      latestRepliesByAppointmentId[String(appointment?.id || "")],
    );

    if (!confirmationStatus) return null;

    const label = getAppointmentConfirmationLabel(confirmationStatus);
    const chipColor =
      confirmationStatus === "confirmed"
        ? "#16A34A"
        : confirmationStatus === "declined"
          ? "#DC2626"
          : infoAccent;
    const textColor = options.onColor
      ? options.textColor || "#FFFFFF"
      : chipColor;
    const borderColor = options.onColor
      ? "rgba(255,255,255,0.38)"
      : `${chipColor}66`;
    const backgroundColor = options.onColor
      ? "rgba(255,255,255,0.14)"
      : `${chipColor}12`;

    return (
      <View
        accessibilityLabel={`Client confirmation status: ${label}`}
        style={{
          alignSelf: "flex-start",
          backgroundColor,
          borderColor,
          borderWidth: 1,
          borderRadius: 999,
          paddingHorizontal: options.compact ? 7 : 9,
          paddingVertical: options.compact ? 3 : 4,
        }}
      >
        <Text
          numberOfLines={1}
          style={{
            color: textColor,
            fontSize: options.compact ? 10 : 11,
            fontWeight: "900",
          }}
        >
          {label}
        </Text>
      </View>
    );
  }

  function openAppointmentEditor(appointment: any) {
    if (!appointment?.id) return;

    router.push({
      pathname: "/book-appointment",
      params: {
        appointmentId: appointment.id,
        mode: "edit",
      },
    } as any);
  }

  function openClientDetails(appointment: any) {
    if (!appointment?.client_id) {
      openAppointmentEditor(appointment);
      return;
    }

    router.push({
      pathname: "/client-details",
      params: { clientId: String(appointment.client_id) },
    } as any);
  }

  function renderClientNameLink(
    appointment: any,
    options: {
      color: string;
      disabledColor?: string;
      fontSize: number;
      fontWeight?: "700" | "800" | "900" | "bold";
      numberOfLines?: number;
    },
  ) {
    const clientName = appointment?.client_name || "Client";
    const hasClientId = Boolean(appointment?.client_id);
    const textColor = hasClientId
      ? options.color
      : options.disabledColor || options.color;
    const textStyle = {
      color: textColor,
      fontSize: options.fontSize,
      fontWeight: options.fontWeight || "900",
      textDecorationLine: hasClientId ? "underline" : "none",
    } as const;

    if (!hasClientId) {
      return (
        <Text
          numberOfLines={options.numberOfLines || 1}
          style={textStyle}
        >
          {clientName}
        </Text>
      );
    }

    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Open client details for ${clientName}`}
        hitSlop={4}
        onPress={(event) => {
          event.stopPropagation();
          openClientDetails(appointment);
        }}
      >
        <Text
          numberOfLines={options.numberOfLines || 1}
          style={textStyle}
        >
          {clientName}
        </Text>
      </Pressable>
    );
  }

  function openNewAppointment(appointmentDate: string, appointmentTime: string) {
    router.push({
      pathname: "/book-appointment",
      params: {
        appointmentDate,
        appointmentTime,
        fromCalendarGrid: "true",
        mode: "new",
      },
    } as any);
  }

  function selectGridDate(date: string) {
    setBaseDate(date);
    setWeekOffset(0);
    setOpenDays((current) => ({
      ...current,
      [date]: true,
    }));
  }

  function renderGridAppointment(appointment: any, compact = false) {
    if (!isValidAppointmentForDisplay(appointment)) return null;

    const serviceNames = getAppointmentServiceNames(appointment, services);
    const blockColor = getAppointmentBlockColor(
      appointment,
      services,
      infoAccent,
    );
    const statusAccent = getStatusColor(appointment.status);
    const textColor = getReadableTextColor(blockColor);
    const mutedTextColor = textColor === "#FFFFFF" ? "#E5E7EB" : "#374151";
    const appointmentEndTime = getAppointmentEndTimeText(
      appointment,
      calendarIntervalMinutes,
    );
    const timeText = `${formatTime(appointment.appointment_time, timeFormat)}${
      compact ? "" : ` - ${formatTime(appointmentEndTime, timeFormat)}`
    }`;
    const statusText = formatStatusText(appointment.status);

    return (
      <Pressable
        key={appointment.id}
        accessibilityRole="button"
        accessibilityLabel={`Open appointment for ${
          appointment.client_name || "Client"
        }`}
        onPress={() => openAppointmentEditor(appointment)}
        style={({ pressed }) => ({
          backgroundColor: blockColor,
          borderRadius: 5,
          paddingHorizontal: compact ? 7 : 9,
          paddingVertical: compact ? 6 : 8,
          marginBottom: compact ? 4 : 6,
          borderWidth: 1,
          borderColor: statusAccent,
          opacity: pressed ? 0.88 : 1,
        })}
      >
        {renderClientNameLink(appointment, {
          color: textColor,
          fontSize: compact ? 12 : 14,
          fontWeight: "900",
        })}
        <Text
          numberOfLines={1}
          style={{
            color: mutedTextColor,
            fontSize: compact ? 10 : 11,
            fontWeight: "800",
            marginTop: 2,
          }}
        >
          {timeText}
        </Text>
        <Text
          numberOfLines={compact ? 1 : 2}
          style={{
            color: mutedTextColor,
            fontSize: compact ? 10 : 11,
            fontWeight: "700",
            marginTop: 2,
          }}
        >
          {serviceNames.length > 0 ? serviceNames.join(", ") : statusText}
        </Text>
        <View
          style={{
            flexDirection: "row",
            flexWrap: "wrap",
            gap: 5,
            marginTop: compact ? 5 : 6,
          }}
        >
          {renderStatusPill(appointment, {
            compact: true,
            onColor: true,
            textColor,
          })}
          {renderConfirmationChip(appointment, {
            compact: true,
            onColor: true,
            textColor,
          })}
        </View>
      </Pressable>
    );
  }

  function renderGridBlock(block: any, compact = false) {
    const blockColors = getBlockColors(block.block_type);
    const blockDisplayTitle = block.title || formatBlockLabel(block.block_type);

    return (
      <Pressable
        key={block.id}
        onPress={() => {
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
          borderColor: blockColors.border,
          borderWidth: 1,
          borderRadius: 5,
          paddingHorizontal: compact ? 7 : 9,
          paddingVertical: compact ? 6 : 8,
          marginBottom: compact ? 4 : 6,
          opacity: pressed ? 0.84 : 1,
        })}
      >
        <Text
          numberOfLines={1}
          style={{
            color: "#111827",
            fontSize: compact ? 12 : 14,
            fontWeight: "900",
          }}
        >
          {blockDisplayTitle}
        </Text>
        <Text
          numberOfLines={1}
          style={{
            color: "#334155",
            fontSize: compact ? 10 : 11,
            fontWeight: "800",
            marginTop: 2,
          }}
        >
          {formatTime(block.start_time, timeFormat)} -{" "}
          {formatTime(block.end_time, timeFormat)}
        </Text>
      </Pressable>
    );
  }

  function getHolidaysForDate(dateText: string) {
    return holidaysByDate[dateText] || [];
  }

  function renderHolidayChips(
    dateText: string,
    options: {
      compact?: boolean;
      onDark?: boolean;
      onSelected?: boolean;
    } = {},
  ) {
    const holidays = getHolidaysForDate(dateText);

    if (holidays.length === 0) return null;

    const textColor = options.onSelected
      ? "#FFFFFF"
      : options.onDark
        ? "#FEF3C7"
        : "#92400E";
    const mutedTextColor = options.onSelected
      ? "rgba(255,255,255,0.82)"
      : options.onDark
        ? "rgba(254,243,199,0.82)"
        : "#B45309";
    const backgroundColor = options.onSelected
      ? "rgba(255,255,255,0.16)"
      : options.onDark
        ? "rgba(245,158,11,0.14)"
        : "#FFFBEB";
    const borderColor = options.onSelected
      ? "rgba(255,255,255,0.28)"
      : options.onDark
        ? "rgba(245,158,11,0.30)"
        : "#FCD34D";

    return (
      <View
        style={{
          flexDirection: "row",
          flexWrap: "wrap",
          gap: options.compact ? 4 : 6,
          marginTop: options.compact ? 4 : 8,
          marginBottom: options.compact ? 0 : 8,
        }}
      >
        {holidays.map((holiday) => (
          <View
            key={holiday.id}
            accessibilityLabel={`${holiday.title} holiday`}
            style={{
              alignSelf: "flex-start",
              backgroundColor,
              borderColor,
              borderWidth: 1,
              borderRadius: 999,
              paddingHorizontal: options.compact ? 7 : 9,
              paddingVertical: options.compact ? 3 : 5,
            }}
          >
            <Text
              numberOfLines={1}
              style={{
                color: textColor,
                fontSize: options.compact ? 9 : 11,
                fontWeight: "900",
              }}
            >
              {options.compact ? "Holiday" : `Holiday: ${holiday.title}`}
            </Text>
            {!options.compact && holiday.observed ? (
              <Text
                numberOfLines={1}
                style={{
                  color: mutedTextColor,
                  fontSize: 10,
                  fontWeight: "800",
                  marginTop: 1,
                }}
              >
                Observed date
              </Text>
            ) : null}
          </View>
        ))}
      </View>
    );
  }

  function renderGridDayStrip() {
    const weekStart = weekDates[0]?.date;
    const weekEnd = weekDates[weekDates.length - 1]?.date;
    const weekLabel =
      weekStart && weekEnd
        ? `${formatAppointmentDateLabel(weekStart)} - ${formatAppointmentDateLabel(
            weekEnd,
          )}`
        : "This week";

    return (
      <View
        style={{
          backgroundColor: "#F8FAFC",
          borderColor: "#CBD5E1",
          borderWidth: 1,
          borderRadius: 8,
          padding: 8,
          marginBottom: 10,
        }}
      >
        <Text
          style={{
            color: "#0F172A",
            fontSize: 13,
            fontWeight: "900",
            marginBottom: 8,
          }}
        >
          {weekLabel}
        </Text>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ gap: 6 }}
        >
          {weekDates.map((day) => {
            const selected = day.date === selectedGridDate;
            const isToday = day.date === todayIso();

            return (
              <Pressable
                key={day.date}
                onPress={() => selectGridDate(day.date)}
                style={{
                  minWidth: 58,
                  alignItems: "center",
                  backgroundColor: selected ? infoAccent : "#FFFFFF",
                  borderColor: selected
                    ? infoAccent
                    : isToday
                      ? infoAccent
                      : "#CBD5E1",
                  borderWidth: 1,
                  borderRadius: 999,
                  paddingVertical: 7,
                  paddingHorizontal: 10,
                }}
              >
                <Text
                  style={{
                    color: selected ? "#FFFFFF" : "#475569",
                    fontSize: 10,
                    fontWeight: "900",
                  }}
                >
                  {day.day.slice(0, 3)}
                </Text>
                <Text
                  style={{
                    color: selected ? "#FFFFFF" : "#0F172A",
                    fontSize: 13,
                    fontWeight: "900",
                    marginTop: 1,
                  }}
                >
                  {day.label}
                </Text>
                {renderHolidayChips(day.date, {
                  compact: true,
                  onSelected: selected,
                })}
              </Pressable>
            );
          })}
        </ScrollView>
      </View>
    );
  }

  function renderClosedDayState(showDayStrip = true) {
    return (
      <View>
        {showDayStrip ? renderGridDayStrip() : null}
        {renderHolidayChips(selectedGridDate)}
        <View
          style={{
            backgroundColor: "#F8FAFC",
            borderColor: "#CBD5E1",
            borderWidth: 1,
            borderRadius: 8,
            padding: 18,
            marginBottom: 16,
          }}
        >
          <Text
            style={{
              color: "#0F172A",
              fontSize: 18,
              fontWeight: "900",
              textAlign: "center",
            }}
          >
            Closed this day
          </Text>
          <Text
            style={{
              color: "#475569",
              fontSize: 13,
              fontWeight: "700",
              lineHeight: 19,
              marginTop: 6,
              textAlign: "center",
            }}
          >
            No availability is set for this day.
          </Text>
          <Pressable
            onPress={() => router.push("/availability-settings")}
            style={({ pressed }) => ({
              alignSelf: "center",
              backgroundColor: colors.primary,
              borderRadius: 999,
              marginTop: 14,
              opacity: pressed ? 0.88 : 1,
              paddingHorizontal: 16,
              paddingVertical: 10,
            })}
          >
            <Text style={{ color: "#FFFFFF", fontWeight: "900" }}>
              Edit Availability
            </Text>
          </Pressable>
        </View>
      </View>
    );
  }

  function renderSelectedDayGrid() {
    const dayTitle = selectedGridDay
      ? `${selectedGridDay.day} ${selectedGridDay.label}`
      : "Selected day";
    const hasSelectedDayCalendarItems =
      selectedGridAppointments.length > 0 || selectedGridBlocks.length > 0;

    if (!selectedAvailabilityWindow.isAvailable && !hasSelectedDayCalendarItems) {
      return renderClosedDayState();
    }

    return (
      <View>
        {renderGridDayStrip()}
        {renderHolidayChips(selectedGridDate)}
        {!selectedAvailabilityWindow.isAvailable ? (
          <View
            style={{
              backgroundColor: "#FEF3C7",
              borderColor: "#F59E0B",
              borderWidth: 1,
              borderRadius: 8,
              padding: 10,
              marginBottom: 10,
            }}
          >
            <Text
              style={{
                color: "#92400E",
                fontSize: 12,
                fontWeight: "900",
              }}
            >
              Closed this day
            </Text>
            <Text
              style={{
                color: "#92400E",
                fontSize: 12,
                fontWeight: "700",
                marginTop: 2,
              }}
            >
              Existing appointments are still shown.
            </Text>
          </View>
        ) : null}
        <View
          style={{
            backgroundColor: "#F8FAFC",
            borderColor: "#CBD5E1",
            borderWidth: 1,
            borderRadius: 8,
            overflow: "hidden",
            marginBottom: 16,
          }}
        >
          <View
            style={{
              backgroundColor: "#E2E8F0",
              paddingHorizontal: 10,
              paddingVertical: 8,
              borderBottomWidth: 1,
              borderBottomColor: "#CBD5E1",
            }}
          >
            <Text
              style={{
                color: "#0F172A",
                fontSize: 15,
                fontWeight: "900",
              }}
            >
              {dayTitle}
            </Text>
          </View>

          {gridHourSlots.map((hour) => {
            const rowStart = hour * 60;
            const rowEnd = rowStart + 60;
            const hourAppointments = selectedGridAppointments.filter(
              (appointment) => {
                const start = toMinutes(
                  String(appointment.appointment_time || "").slice(0, 5),
                );

                return start >= rowStart && start < rowEnd;
              },
            );
            const hourBlocks = selectedGridBlocks.filter((block) => {
              const start = toMinutes(String(block.start_time || "").slice(0, 5));

              return start >= rowStart && start < rowEnd;
            });
            const isCurrentHour =
              selectedGridDate === todayIso() &&
              currentMinutes >= rowStart &&
              currentMinutes < rowEnd;
            const hasContent =
              hourAppointments.length > 0 || hourBlocks.length > 0;
            const slotText = hourToTimeText(hour);
            const slotStarts = getSlotStartsForHour(
              rowStart,
              calendarIntervalMinutes,
            );
            const availableSlotStarts = slotStarts.filter((slotStart) => {
              const slotEnd = Math.min(
                slotStart + calendarIntervalMinutes,
                rowEnd,
              );

              return isGridSlotAvailable({
                slotStart,
                slotEnd,
                availabilityWindow: selectedAvailabilityWindow,
                appointments: selectedGridAppointments,
                blocks: selectedGridBlocks,
                intervalMinutes: calendarIntervalMinutes,
              });
            });

            return (
              <View
                key={hour}
                style={{
                  flexDirection: "row",
                  minHeight: 58,
                  borderTopWidth: hour === gridStartHour ? 0 : 1,
                  borderTopColor: "#E2E8F0",
                  backgroundColor: isCurrentHour ? "#FFF7ED" : "#FFFFFF",
                }}
              >
                <View
                  style={{
                    width: 72,
                    paddingTop: 8,
                    paddingHorizontal: 8,
                    borderRightWidth: 1,
                    borderRightColor: "#E2E8F0",
                    backgroundColor: isCurrentHour ? "#FFEDD5" : "#F1F5F9",
                  }}
                >
                  <Text
                    style={{
                      color: isCurrentHour ? "#9A3412" : "#475569",
                      fontSize: 11,
                      fontWeight: "900",
                    }}
                  >
                    {formatTime(slotText, timeFormat)}
                  </Text>
                </View>

                <View style={{ flex: 1, padding: 6 }}>
                  {hourAppointments.map((appointment) =>
                    renderGridAppointment(appointment),
                  )}
                  {hourBlocks.map((block) => renderGridBlock(block))}
                  {availableSlotStarts.map((slotStart) => {
                    const slotTextForBooking = minutesToTimeText(slotStart);
                    const showSlotTime = calendarIntervalMinutes < 60;

                    return (
                    <Pressable
                      key={slotStart}
                      onPress={() =>
                        openNewAppointment(selectedGridDate, slotTextForBooking)
                      }
                      style={({ pressed }) => ({
                        minHeight: 36,
                        justifyContent: "center",
                        borderRadius: 4,
                        marginTop: hasContent ? 4 : 0,
                        paddingHorizontal: 6,
                        backgroundColor: pressed
                          ? "rgba(15,118,110,0.08)"
                          : "transparent",
                      })}
                    >
                      <Text
                        style={{
                          color: "#94A3B8",
                          fontSize: 11,
                          fontWeight: "800",
                        }}
                      >
                        {showSlotTime
                          ? `Open ${formatTime(slotTextForBooking, timeFormat)}`
                          : "Open"}
                      </Text>
                    </Pressable>
                    );
                  })}
                  {!hasContent && availableSlotStarts.length === 0 ? (
                    <View style={{ minHeight: 30 }} />
                  ) : null}
                </View>
              </View>
            );
          })}
        </View>
      </View>
    );
  }

  function renderWeekGrid() {
    const dayColumnWidth = Math.max(98, (width - 92) / 7);
    const hasSelectedDayCalendarItems =
      selectedGridAppointments.length > 0 || selectedGridBlocks.length > 0;

    if (!selectedAvailabilityWindow.isAvailable && !hasSelectedDayCalendarItems) {
      return renderClosedDayState();
    }

    return (
      <View>
        {!selectedAvailabilityWindow.isAvailable ? (
          <View
            style={{
              backgroundColor: "#FEF3C7",
              borderColor: "#F59E0B",
              borderWidth: 1,
              borderRadius: 8,
              padding: 10,
              marginBottom: 10,
            }}
          >
            <Text
              style={{
                color: "#92400E",
                fontSize: 12,
                fontWeight: "900",
              }}
            >
              Closed this day
            </Text>
            <Text
              style={{
                color: "#92400E",
                fontSize: 12,
                fontWeight: "700",
                marginTop: 2,
              }}
            >
              Existing appointments are still shown.
            </Text>
          </View>
        ) : null}
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          <View
          style={{
            minWidth: dayColumnWidth * 7 + 72,
            backgroundColor: "#F8FAFC",
            borderColor: "#CBD5E1",
            borderWidth: 1,
            borderRadius: 8,
            overflow: "hidden",
            marginBottom: 16,
          }}
        >
          <View style={{ flexDirection: "row", backgroundColor: "#E2E8F0" }}>
            <View
              style={{
                width: 72,
                borderRightWidth: 1,
                borderRightColor: "#CBD5E1",
                padding: 8,
              }}
            >
              <Text
                style={{
                  color: "#475569",
                  fontSize: 11,
                  fontWeight: "900",
                }}
              >
                Time
              </Text>
            </View>
            {weekDates.map((day) => {
              const selected = day.date === selectedGridDate;
              const dayHolidays = getHolidaysForDate(day.date);

              return (
                <Pressable
                  key={day.date}
                  onPress={() => selectGridDate(day.date)}
                  style={{
                    width: dayColumnWidth,
                    padding: 8,
                    borderRightWidth: 1,
                    borderRightColor: "#CBD5E1",
                    backgroundColor: selected ? infoAccent : "#E2E8F0",
                  }}
                >
                  <Text
                    numberOfLines={1}
                    style={{
                      color: selected ? "#FFFFFF" : "#475569",
                      fontSize: 10,
                      fontWeight: "900",
                    }}
                  >
                    {day.day.slice(0, 3)}
                  </Text>
                  <Text
                    numberOfLines={1}
                    style={{
                      color: selected ? "#FFFFFF" : "#0F172A",
                      fontSize: 12,
                      fontWeight: "900",
                      marginTop: 1,
                    }}
                  >
                    {day.label}
                  </Text>
                  {dayHolidays.length > 0 ? (
                    <Text
                      numberOfLines={1}
                      style={{
                        color: selected ? "#FEF3C7" : "#92400E",
                        fontSize: 9,
                        fontWeight: "900",
                        marginTop: 3,
                      }}
                    >
                      Holiday: {dayHolidays[0].title}
                    </Text>
                  ) : null}
                </Pressable>
              );
            })}
          </View>

          {gridHourSlots.map((hour) => {
            const rowStart = hour * 60;
            const rowEnd = rowStart + 60;
            const slotText = hourToTimeText(hour);

            return (
              <View key={hour} style={{ flexDirection: "row", minHeight: 76 }}>
                <View
                  style={{
                    width: 72,
                    paddingHorizontal: 8,
                    paddingTop: 8,
                    borderTopWidth: 1,
                    borderRightWidth: 1,
                    borderColor: "#E2E8F0",
                    backgroundColor: "#F1F5F9",
                  }}
                >
                  <Text
                    style={{
                      color: "#475569",
                      fontSize: 11,
                      fontWeight: "900",
                    }}
                  >
                    {formatTime(slotText, timeFormat)}
                  </Text>
                </View>
                {weekDates.map((day) => {
                  const dayAvailabilityWindow = getAvailabilityWindowForDate(
                    day.date,
                    availabilityRules,
                  );
                  const dayAppointments = appointments.filter(
                    (appointment) =>
                      isValidAppointmentForDisplay(appointment) &&
                      appointment.appointment_date === day.date,
                  );
                  const dayBlocks = blocks.filter(
                    (block) => block.block_date === day.date,
                  );
                  const hourAppointments = dayAppointments.filter(
                    (appointment) => {
                      const start = toMinutes(
                        String(appointment.appointment_time || "").slice(0, 5),
                      );

                      return start >= rowStart && start < rowEnd;
                    },
                  );
                  const hourBlocks = dayBlocks.filter((block) => {
                    const start = toMinutes(
                      String(block.start_time || "").slice(0, 5),
                    );

                    return start >= rowStart && start < rowEnd;
                  });
                  const hasContent =
                    hourAppointments.length > 0 || hourBlocks.length > 0;
                  const availableSlotStarts = getSlotStartsForHour(
                    rowStart,
                    calendarIntervalMinutes,
                  ).filter((slotStart) => {
                    const slotEnd = Math.min(
                      slotStart + calendarIntervalMinutes,
                      rowEnd,
                    );

                    return isGridSlotAvailable({
                      slotStart,
                      slotEnd,
                      availabilityWindow: dayAvailabilityWindow,
                      appointments: dayAppointments,
                      blocks: dayBlocks,
                      intervalMinutes: calendarIntervalMinutes,
                    });
                  });

                  return (
                    <View
                      key={`${day.date}-${hour}`}
                      style={{
                        width: dayColumnWidth,
                        padding: 5,
                        borderTopWidth: 1,
                        borderRightWidth: 1,
                        borderColor: "#E2E8F0",
                        backgroundColor: dayAvailabilityWindow.isAvailable
                          ? "#FFFFFF"
                          : "#F8FAFC",
                      }}
                    >
                      {hourAppointments.map((appointment) =>
                        renderGridAppointment(appointment, true),
                      )}
                      {hourBlocks.map((block) => renderGridBlock(block, true))}
                      {availableSlotStarts.map((slotStart) => {
                        const slotTextForBooking = minutesToTimeText(slotStart);

                        return (
                          <Pressable
                            key={slotStart}
                            onPress={() =>
                              openNewAppointment(day.date, slotTextForBooking)
                            }
                            style={({ pressed }) => ({
                              borderRadius: 4,
                              marginTop: hasContent ? 4 : 0,
                              paddingHorizontal: 5,
                              paddingVertical: 5,
                              backgroundColor: pressed
                                ? "rgba(15,118,110,0.08)"
                                : "transparent",
                            })}
                          >
                            <Text
                              numberOfLines={1}
                              style={{
                                color: "#64748B",
                                fontSize: 10,
                                fontWeight: "800",
                              }}
                            >
                              Open {formatTime(slotTextForBooking, timeFormat)}
                            </Text>
                          </Pressable>
                        );
                      })}
                    </View>
                  );
                })}
              </View>
            );
          })}
        </View>
        </ScrollView>
      </View>
    );
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
        keyboardDismissMode="on-drag"
        keyboardShouldPersistTaps="handled"
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

        <View
          style={{
            flexDirection: "row",
            backgroundColor: colors.card,
            borderColor: infoAccentBorder,
            borderWidth: 1,
            borderRadius: 14,
            padding: 4,
            marginBottom: 12,
          }}
        >
          {(["list", "grid"] as CalendarLayout[]).map((layout) => {
            const selected = calendarLayout === layout;

            return (
              <Pressable
                key={layout}
                onPress={() => {
                  void handleLayoutChange(layout);
                }}
                style={{
                  flex: 1,
                  backgroundColor: selected ? infoAccent : "transparent",
                  borderRadius: 10,
                  paddingVertical: 10,
                  alignItems: "center",
                }}
              >
                <Text
                  style={{
                    color: selected ? "#FFFFFF" : colors.text,
                    fontSize: 13,
                    fontWeight: "900",
                  }}
                >
                  {getLayoutLabel(layout)}
                </Text>
              </Pressable>
            );
          })}
        </View>

        <View
          style={{
            backgroundColor: colors.card,
            borderWidth: 1,
            borderColor: polishedBorder,
            borderRadius: 16,
            paddingHorizontal: 12,
            paddingVertical: 8,
            marginBottom: 8,
            flexDirection: "row",
            alignItems: "center",
            gap: 8,
          }}
        >
          <TextInput
            value={searchQuery}
            onChangeText={handleSearchChange}
            placeholder={getSearchPlaceholder(searchFilter)}
            placeholderTextColor={colors.mutedText}
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="search"
            style={{
              flex: 1,
              color: colors.text,
              fontSize: 15,
              minHeight: 40,
              paddingVertical: 6,
            }}
          />

          {searchQuery ? (
            <Pressable
              accessibilityLabel="Clear calendar search"
              onPress={() => {
                setSearchQuery("");
                handleSearchFilterChange(
                  calendarLayout === "grid" ? "selected_day" : "today",
                );
              }}
              style={{
                width: 34,
                height: 34,
                borderRadius: 17,
                alignItems: "center",
                justifyContent: "center",
                backgroundColor: infoAccentSoft,
                borderWidth: 1,
                borderColor: infoAccentBorder,
              }}
            >
              <Text style={{ color: infoAccent, fontWeight: "900" }}>X</Text>
            </Pressable>
          ) : null}

          <Pressable
            accessibilityLabel="Open calendar search filters"
            onPress={() => setFilterModalVisible(true)}
            style={{
              minWidth: 42,
              height: 34,
              borderRadius: 17,
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: infoAccentSoft,
              borderWidth: 1,
              borderColor: infoAccentBorder,
              paddingHorizontal: 10,
            }}
          >
            <Ionicons name="options-outline" size={18} color={infoAccent} />
          </Pressable>
        </View>

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{
            gap: 8,
            paddingBottom: 8,
          }}
          style={{
            marginBottom: 4,
          }}
        >
          {calendarLayout === "grid"
            ? GRID_QUICK_ACTIONS.map((action) => {
                const selected = isGridQuickActionSelected(action.value);

                return (
                  <Pressable
                    key={action.value}
                    onPress={() => handleGridQuickAction(action.value)}
                    style={{
                      backgroundColor: selected ? infoAccent : colors.card,
                      borderColor: selected ? infoAccent : polishedBorder,
                      borderWidth: selected ? 2 : 1,
                      borderRadius: 999,
                      paddingHorizontal: selected ? 11 : 12,
                      paddingVertical: 8,
                      flexDirection: "row",
                      alignItems: "center",
                      gap: 5,
                      elevation: selected ? 2 : 0,
                      shadowColor: "#000",
                      shadowOffset: { width: 0, height: 1 },
                      shadowOpacity: selected ? 0.18 : 0,
                      shadowRadius: 2,
                    }}
                  >
                    {selected ? (
                      <Ionicons
                        name="checkmark-circle"
                        size={14}
                        color="#FFFFFF"
                      />
                    ) : null}
                    <Text
                      style={{
                        color: selected ? "#FFFFFF" : colors.text,
                        fontSize: 12,
                        fontWeight: "900",
                      }}
                    >
                      {action.label}
                    </Text>
                  </Pressable>
                );
              })
            : QUICK_SEARCH_FILTERS.map((filter) => {
                const selected = searchFilter === filter.value;

                return (
                  <Pressable
                    key={filter.value}
                    onPress={() => handleSearchFilterChange(filter.value)}
                    style={{
                      backgroundColor: selected ? infoAccent : colors.card,
                      borderColor: selected ? infoAccent : polishedBorder,
                      borderWidth: selected ? 2 : 1,
                      borderRadius: 999,
                      paddingHorizontal: selected ? 11 : 12,
                      paddingVertical: 8,
                      flexDirection: "row",
                      alignItems: "center",
                      gap: 5,
                      elevation: selected ? 2 : 0,
                      shadowColor: "#000",
                      shadowOffset: { width: 0, height: 1 },
                      shadowOpacity: selected ? 0.18 : 0,
                      shadowRadius: 2,
                    }}
                  >
                    {selected ? (
                      <Ionicons
                        name="checkmark-circle"
                        size={14}
                        color="#FFFFFF"
                      />
                    ) : null}
                    <Text
                      style={{
                        color: selected ? "#FFFFFF" : colors.text,
                        fontSize: 12,
                        fontWeight: "900",
                      }}
                    >
                      {filter.label}
                    </Text>
                  </Pressable>
                );
              })}
        </ScrollView>

        {calendarLayout === "list" || finderActive ? (
          <View
            style={{
              alignSelf: "flex-start",
              backgroundColor: infoAccentSoft,
              borderColor: infoAccentBorder,
              borderWidth: 1,
              borderRadius: 999,
              paddingHorizontal: 10,
              paddingVertical: 5,
              marginBottom: 16,
            }}
          >
            <Text
              style={{
                color: infoAccent,
                fontSize: 12,
                fontWeight: "900",
              }}
            >
              Filter: {getSearchFilterLabel(searchFilter)}
            </Text>
          </View>
        ) : null}

        {finderActive ? (
          <View
            style={{
              backgroundColor: colors.card,
              borderWidth: 1,
              borderColor: infoAccentBorder,
              borderRadius: 16,
              padding: 14,
              marginBottom: 16,
            }}
          >
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 10,
                marginBottom: 10,
              }}
            >
              <Text
                style={{
                  color: colors.text,
                  fontSize: 18,
                  fontWeight: "900",
                  flex: 1,
                }}
              >
              Appointment results
            </Text>
              <View
                style={{
                  width: 42,
                  height: 4,
                  borderRadius: 999,
                  backgroundColor: infoAccent,
                  marginBottom: 6,
                }}
              />

              <View
                style={{
                  backgroundColor: infoAccentSoft,
                  borderColor: infoAccentBorder,
                  borderWidth: 1,
                  borderRadius: 999,
                  paddingHorizontal: 10,
                  paddingVertical: 5,
                }}
              >
                <Text
                  style={{
                    color:
                      searchResults.length === 0
                        ? colors.mutedText
                        : infoAccent,
                    fontSize: 12,
                    fontWeight: "900",
                  }}
                >
                  {finderResultCountText}
                </Text>
              </View>
            </View>

            {searchResults.length === 0 ? (
              <View style={{ paddingVertical: 18 }}>
                <Text
                  style={{
                    color: colors.text,
                    fontSize: 16,
                    fontWeight: "900",
                    textAlign: "center",
                  }}
                >
                  No appointments found
                </Text>
                <Text
                  style={{
                    color: colors.mutedText,
                    fontSize: 13,
                    lineHeight: 19,
                    marginTop: 6,
                    textAlign: "center",
                  }}
                >
                  Try searching by client name, date, service, or status.
                </Text>
              </View>
            ) : null}

            {searchResults.map((appt) => {
              const appointmentEndTime = getAppointmentEndTimeText(
                appt,
                calendarIntervalMinutes,
              );
              const serviceNames = getAppointmentServiceNames(appt, services);
              const price = getAppointmentDisplayPrice(appt, services);

              return (
                <Pressable
                  key={appt.id}
                  accessibilityRole="button"
                  accessibilityLabel={`Open appointment for ${
                    appt.client_name || "Client"
                  }`}
                  onPress={() => openAppointmentEditor(appt)}
                  style={({ pressed }) => ({
                    backgroundColor: colors.background,
                    paddingVertical: 12,
                    paddingHorizontal: 12,
                    borderRadius: 14,
                    marginBottom: 10,
                    borderLeftWidth: 5,
                    borderLeftColor: getStatusColor(appt.status),
                    borderWidth: 1,
                    borderColor: polishedBorder,
                    opacity: pressed ? 0.92 : 1,
                  })}
                >
                  {renderClientNameLink(appt, {
                    color: infoAccent,
                    disabledColor: colors.text,
                    fontSize: 16,
                    fontWeight: "900",
                  })}

                  <Text
                    style={{
                      color: colors.mutedText,
                      fontSize: 13,
                      fontWeight: "700",
                      marginTop: 5,
                    }}
                  >
                    {formatAppointmentDateLabel(appt.appointment_date)} -{" "}
                    {formatTime(appt.appointment_time, timeFormat)}
                    {appointmentEndTime
                      ? ` - ${formatTime(appointmentEndTime, timeFormat)}`
                      : ""}
                  </Text>

                  {serviceNames.length > 0 ? (
                    <Text
                      style={{
                        color: colors.text,
                        fontSize: 13,
                        fontWeight: "700",
                        marginTop: 6,
                      }}
                      numberOfLines={2}
                    >
                      {serviceNames.join(", ")}
                    </Text>
                  ) : null}

                  <View
                    style={{
                      flexDirection: "row",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: 10,
                      marginTop: 6,
                    }}
                  >
                    <View
                      style={{
                        flex: 1,
                        flexDirection: "row",
                        flexWrap: "wrap",
                        gap: 6,
                      }}
                    >
                      {renderStatusPill(appt)}
                      {renderConfirmationChip(appt)}
                    </View>

                    {price > 0 ? (
                      <Text
                        style={{
                          color: colors.text,
                          fontSize: 12,
                          fontWeight: "900",
                        }}
                      >
                        ${price.toFixed(2)}
                      </Text>
                    ) : null}
                  </View>
                </Pressable>
              );
            })}
          </View>
        ) : null}

        {!finderActive ? (
          <>
        {ENABLE_PRO && !customScheduleAvailable ? (
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
              {PRO_UPSELL_COPY.customBusinessHours}
            </Text>
            <Pressable
              onPress={() => {
                openSchedovaProScreen();
              }}
              style={{
                backgroundColor: colors.primary,
                borderRadius: 12,
                padding: 12,
                alignItems: "center",
                marginTop: 12,
              }}
            >
              <Text style={{ color: "#FFFFFF", fontWeight: "900" }}>
                Upgrade to Schedova Pro
              </Text>
            </Pressable>
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

        {calendarLayout === "grid" ? (
          isLandscape ? (
            renderWeekGrid()
          ) : (
            renderSelectedDayGrid()
          )
        ) : (
          <>
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
            (appt) =>
              isValidAppointmentForDisplay(appt) &&
              appt.appointment_date === item.date,
          );

          const dayBlocks = blocks.filter(
            (block) => block.block_date === item.date,
          );
          const dayHolidays = getHolidaysForDate(item.date);

          const isDayOpen =
            openDays[item.date] ?? item.date === effectiveSelectedDate;

          const dayAvailabilityWindow = getAvailabilityWindowForDate(
            item.date,
            availabilityRules,
          );

          const timeSlots = dayAvailabilityWindow.isAvailable
            ? generateTimeSlots(
                minutesToTimeText(dayAvailabilityWindow.startMinutes),
                minutesToTimeText(dayAvailabilityWindow.endMinutes),
              )
            : [];

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
                  {renderHolidayChips(item.date, { onDark: true })}

                  {dayAppointments.length === 0 &&
                  dayBlocks.length === 0 &&
                  dayHolidays.length === 0 ? (
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
                    const appointmentEndTime = getAppointmentEndTimeText(
                      appt,
                      calendarIntervalMinutes,
                    );

                    return (
                      <Pressable
                        key={appt.id}
                        accessibilityRole="button"
                        accessibilityLabel={`Open appointment for ${
                          appt.client_name || "Client"
                        }`}
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
                            ? infoAccentSoft
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
                          borderColor: selected ? infoAccent : polishedBorder,
                          opacity: pressed ? 0.92 : 1,
                          transform: [{ scale: pressed ? 0.985 : 1 }],
                        })}
                      >
                        {renderClientNameLink(appt, {
                          color: infoAccent,
                          disabledColor: colors.text,
                          fontSize: 16,
                          fontWeight: "bold",
                        })}

                        <Text
                          style={{
                            color: colors.mutedText,
                            fontSize: 12,
                            fontWeight: "600",
                            marginTop: 2,
                          }}
                        >
                          {formatTime(appt.appointment_time, timeFormat)}
                          {appointmentEndTime
                            ? ` - ${formatTime(appointmentEndTime, timeFormat)}`
                            : ""}
                        </Text>

                        <View
                          style={{
                            flexDirection: "row",
                            flexWrap: "wrap",
                            gap: 6,
                            marginTop: 6,
                          }}
                        >
                          {renderStatusPill(appt)}
                          {renderConfirmationChip(appt)}
                        </View>

                        {selectMode ? (
                          <Text
                            style={{
                              color: selected ? infoAccent : colors.mutedText,
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

                        const appointmentEnd = getAppointmentEndMinutes(
                          appt,
                          calendarIntervalMinutes,
                        );

                        return (
                          slotMinutes < appointmentEnd &&
                          nextSlotMinutes > appointmentStart
                        );
                      });

                      const isBlocked = dayBlocks.some((block) =>
                        blockOverlapsSlot(block, slotMinutes, nextSlotMinutes),
                      );

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
          </>
        )}
          </>
        ) : null}
      </AppScreen>

      <Modal
        visible={Boolean(statusMenuAppointment)}
        transparent
        animationType="fade"
        onRequestClose={() => setStatusMenuAppointment(null)}
      >
        <Pressable
          onPress={() => setStatusMenuAppointment(null)}
          style={{
            flex: 1,
            backgroundColor: "rgba(0,0,0,0.55)",
            justifyContent: "flex-end",
            padding: 16,
          }}
        >
          <Pressable
            onPress={(event) => event.stopPropagation()}
            style={{
              backgroundColor: colors.card,
              borderColor: colors.border,
              borderWidth: 1,
              borderRadius: 18,
              padding: 16,
              marginBottom: insets.bottom + 10,
            }}
          >
            <Text
              style={{
                color: colors.text,
                fontSize: 18,
                fontWeight: "900",
              }}
            >
              Update Status
            </Text>
            <Text
              style={{
                color: colors.mutedText,
                fontSize: 13,
                fontWeight: "700",
                marginTop: 4,
                marginBottom: 10,
              }}
              numberOfLines={1}
            >
              {statusMenuAppointment?.client_name || "Appointment"}
            </Text>

            {APPOINTMENT_STATUS_OPTIONS.map((statusOption) => {
              const selected =
                normalizeStatusValue(statusMenuAppointment?.status) ===
                statusOption.value;
              const statusColor = getStatusColor(statusOption.value);
              const updating =
                statusUpdatingId === statusMenuAppointment?.id;

              return (
                <Pressable
                  key={statusOption.value}
                  disabled={updating}
                  onPress={() => {
                    if (!statusMenuAppointment) return;
                    void updateAppointmentStatus(
                      statusMenuAppointment,
                      statusOption.value,
                    );
                  }}
                  style={({ pressed }) => ({
                    backgroundColor: selected
                      ? `${statusColor}20`
                      : colors.background,
                    borderColor: selected ? statusColor : colors.border,
                    borderWidth: 1,
                    borderRadius: 14,
                    marginTop: 8,
                    opacity: pressed ? 0.86 : 1,
                    padding: 14,
                  })}
                >
                  <View
                    style={{
                      flexDirection: "row",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: 12,
                    }}
                  >
                    <Text
                      style={{
                        color: selected ? statusColor : colors.text,
                        fontWeight: "900",
                      }}
                    >
                      {statusOption.label}
                    </Text>
                    {selected ? (
                      <Ionicons
                        name="checkmark-circle"
                        size={18}
                        color={statusColor}
                      />
                    ) : null}
                  </View>
                </Pressable>
              );
            })}
          </Pressable>
        </Pressable>
      </Modal>

      <Modal
        visible={filterModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setFilterModalVisible(false)}
      >
        <Pressable
          onPress={() => setFilterModalVisible(false)}
          style={{
            flex: 1,
            backgroundColor: "rgba(0,0,0,0.55)",
            justifyContent: "flex-end",
            padding: 16,
          }}
        >
          <Pressable
            onPress={(event) => event.stopPropagation()}
            style={{
              backgroundColor: colors.card,
              borderColor: colors.border,
              borderWidth: 1,
              borderRadius: 18,
              padding: 16,
              marginBottom: insets.bottom + 10,
            }}
          >
            <Text
              style={{
                color: colors.text,
                fontSize: 18,
                fontWeight: "900",
                marginBottom: 10,
              }}
            >
              Search Filter
            </Text>

            {SEARCH_FILTERS.map((filter) => {
              const selected = searchFilter === filter.value;

              return (
                <Pressable
                  key={filter.value}
                  onPress={() => {
                    handleSearchFilterChange(filter.value);
                    setFilterModalVisible(false);
                  }}
                  style={{
                    backgroundColor: selected ? infoAccent : colors.background,
                    borderColor: selected ? infoAccent : colors.border,
                    borderWidth: 1,
                    borderRadius: 14,
                    padding: 14,
                    marginTop: 8,
                  }}
                >
                  <Text
                    style={{
                      color: selected ? "#FFFFFF" : colors.text,
                      fontWeight: "900",
                    }}
                  >
                    {filter.label}
                  </Text>
                </Pressable>
              );
            })}
          </Pressable>
        </Pressable>
      </Modal>

      {!finderActive && calendarLayout === "list" ? (
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
      ) : null}
    </View>
  );
}
