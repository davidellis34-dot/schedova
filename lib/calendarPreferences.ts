import AsyncStorage from "@react-native-async-storage/async-storage";

export type CalendarIntervalMinutes = 15 | 30 | 60;
export type CalendarTimeFormat = "12h" | "24h";

export type CalendarPreferences = {
  intervalMinutes: CalendarIntervalMinutes;
  timeFormat: CalendarTimeFormat;
  startHour: number;
  endHour: number;
};

export const DEFAULT_CALENDAR_PREFERENCES: CalendarPreferences = {
  intervalMinutes: 30,
  timeFormat: "12h",
  startHour: 7,
  endHour: 19,
};

export function isValidCalendarInterval(
  value: number,
): value is CalendarIntervalMinutes {
  return value === 15 || value === 30 || value === 60;
}

export function normalizeTimeFormat(value: unknown): CalendarTimeFormat {
  if (value === "24" || value === "24h") return "24h";
  return "12h";
}

function normalizeHour(value: unknown, fallback: number) {
  const parsed = Number(value);

  if (!Number.isFinite(parsed)) return fallback;

  return Math.max(0, Math.min(30, parsed));
}

export async function getCalendarPreferences(): Promise<CalendarPreferences> {
  try {
    const [savedInterval, savedTimeFormat, savedStartHour, savedEndHour] =
      await Promise.all([
        AsyncStorage.getItem("calendar_interval"),
        AsyncStorage.getItem("time_format"),
        AsyncStorage.getItem("calendar_start_hour"),
        AsyncStorage.getItem("calendar_end_hour"),
      ]);

    const parsedInterval = Number(savedInterval);

    return {
      intervalMinutes: isValidCalendarInterval(parsedInterval)
        ? parsedInterval
        : DEFAULT_CALENDAR_PREFERENCES.intervalMinutes,
      timeFormat: normalizeTimeFormat(savedTimeFormat),
      startHour: normalizeHour(
        savedStartHour,
        DEFAULT_CALENDAR_PREFERENCES.startHour,
      ),
      endHour: normalizeHour(savedEndHour, DEFAULT_CALENDAR_PREFERENCES.endHour),
    };
  } catch {
    return DEFAULT_CALENDAR_PREFERENCES;
  }
}

export async function getCalendarIntervalMinutes() {
  const preferences = await getCalendarPreferences();
  return preferences.intervalMinutes;
}

export async function getUse24HourTime() {
  const preferences = await getCalendarPreferences();
  return preferences.timeFormat === "24h";
}

export function formatClockTime(value: unknown, use24Hour: boolean) {
  const text = String(value || "").trim();

  if (!text) return "";

  const [hourText, minuteText = "00"] = text.slice(0, 5).split(":");
  let hour = Number(hourText);
  const minute = Number(minuteText);

  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return text;

  if (use24Hour) {
    return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
  }

  const suffix = hour >= 12 ? "PM" : "AM";
  hour = hour % 12 || 12;

  return `${hour}:${String(minute).padStart(2, "0")} ${suffix}`;
}
