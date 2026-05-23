import type { EntryType, Service } from "./types";

export const TIMES = Array.from({ length: 96 }, (_, index) => {
  const totalMinutes = index * 15;
  const hours = String(Math.floor(totalMinutes / 60)).padStart(2, "0");
  const minutes = String(totalMinutes % 60).padStart(2, "0");
  return `${hours}:${minutes}`;
});

export function todayIso() {
  const now = new Date();

  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(
    2,
    "0",
  )}-${String(now.getDate()).padStart(2, "0")}`;
}

export function normalizeId(value: unknown) {
  return value == null ? "" : String(value);
}

function isValidTimeText(value: string) {
  const match = /^(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(value);

  if (!match) return false;

  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  const seconds = Number(match[3] || 0);

  return (
    Number.isFinite(hours) &&
    Number.isFinite(minutes) &&
    Number.isFinite(seconds) &&
    hours >= 0 &&
    hours <= 23 &&
    minutes >= 0 &&
    minutes <= 59 &&
    seconds >= 0 &&
    seconds <= 59
  );
}

export function toDisplayTime(value: unknown, fallback = "09:00") {
  const text = String(value || fallback);
  if (!text) return fallback;
  const clean = text.slice(0, 5);
  return isValidTimeText(clean) ? clean : fallback;
}

export function toSqlTime(value: string | undefined | null, fallback: string) {
  if (!value) return fallback;
  const clean = value.slice(0, 8);
  const withSeconds = clean.length === 5 ? `${clean}:00` : clean;
  return isValidTimeText(withSeconds) ? withSeconds : fallback;
}

export function formatTimeLabel(time: string, use24Hour: boolean) {
  if (use24Hour) return time;

  const [hourText, minute = "00"] = time.split(":");
  const hour = Number(hourText);

  if (Number.isNaN(hour)) return time;

  const suffix = hour >= 12 ? "PM" : "AM";
  const hour12 = hour % 12 || 12;

  return `${hour12}:${minute} ${suffix}`;
}

export function calculateEndTime(startTime: string, durationMinutes: number) {
  const safeStartTime = toDisplayTime(startTime, "09:00");
  const [hours, minutes] = safeStartTime.split(":").map(Number);
  const date = new Date();

  date.setHours(
    Number.isFinite(hours) ? hours : 9,
    Number.isFinite(minutes) ? minutes : 0,
    0,
    0,
  );
  date.setMinutes(
    date.getMinutes() +
      Math.max(0, Number.isFinite(durationMinutes) ? durationMinutes : 0),
  );

  return date.toTimeString().slice(0, 5);
}

export function getTotalDuration(
  services: (Partial<Service> | null | undefined)[] = [],
) {
  return services.filter(Boolean).reduce(
    (sum, service) => sum + Number(service?.duration_minutes || 0),
    0,
  );
}

export function getTotalPrice(
  services: (Partial<Service> | null | undefined)[] = [],
) {
  return services
    .filter(Boolean)
    .reduce((sum, service) => sum + Number(service?.price || 0), 0);
}

export function formatMoney(value: number) {
  return `$${Number(value || 0).toFixed(2)}`;
}

export function normalizeBlockType(value: unknown): EntryType {
  const text = String(value || "blocked_time");
  if (text === "blocked") return "blocked_time";
  if (
    text === "vacation" ||
    text === "personal" ||
    text === "appointment" ||
    text === "blocked_time"
  ) {
    return text;
  }
  return "blocked_time";
}

export function blockTitleFor(type: EntryType) {
  switch (type) {
    case "vacation":
      return "Vacation";
    case "personal":
      return "Personal Event";
    case "blocked_time":
      return "Blocked Time";
    default:
      return "Calendar Entry";
  }
}
