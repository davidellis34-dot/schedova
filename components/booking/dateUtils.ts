import { todayIso } from "./bookingUtils";

export function isValidDateOnly(value?: unknown) {
  if (typeof value !== "string") return false;
  const clean = value.split("T")[0];

  if (!/^\d{4}-\d{2}-\d{2}$/.test(clean)) return false;

  const [year, month, day] = clean.split("-").map(Number);
  const date = new Date(year, month - 1, day, 12, 0, 0, 0);

  return (
    date.getFullYear() === year &&
    date.getMonth() === month - 1 &&
    date.getDate() === day
  );
}

export function cleanDateOnly(value?: unknown) {
  if (!isValidDateOnly(value)) return todayIso();
  const clean = String(value).split("T")[0];
  return clean;
}

export function dateStringToLocalDate(dateString?: string | null) {
  const clean = cleanDateOnly(dateString);
  const [year, month, day] = clean.split("-").map(Number);
  const date = new Date(year, month - 1, day, 12, 0, 0);

  return Number.isNaN(date.getTime()) ? new Date() : date;
}

export function dateObjectToDateString(date?: Date | null) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return todayIso();

  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
