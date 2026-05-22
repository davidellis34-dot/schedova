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

export function toDisplayTime(value: unknown, fallback = "09:00") {
  const text = String(value || fallback);
  if (!text) return fallback;
  return text.slice(0, 5);
}

export function toSqlTime(value: string, fallback: string) {
  if (!value) return fallback;
  const clean = value.slice(0, 8);
  if (clean.length === 5) return `${clean}:00`;
  return clean;
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
  const [hours, minutes] = startTime.split(":").map(Number);
  const date = new Date();

  date.setHours(
    Number.isFinite(hours) ? hours : 9,
    Number.isFinite(minutes) ? minutes : 0,
    0,
    0,
  );
  date.setMinutes(date.getMinutes() + Math.max(0, durationMinutes || 0));

  return date.toTimeString().slice(0, 5);
}

export function getTotalDuration(services: Service[]) {
  return services.reduce(
    (sum, service) => sum + Number(service.duration_minutes || 0),
    0,
  );
}

export function getTotalPrice(services: Service[]) {
  return services.reduce((sum, service) => sum + Number(service.price || 0), 0);
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
