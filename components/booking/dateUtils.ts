import { todayIso } from "./bookingUtils";

export function cleanDateOnly(value?: string) {
  if (!value) return todayIso();
  return String(value).split("T")[0];
}

export function dateStringToLocalDate(dateString?: string) {
  const clean = cleanDateOnly(dateString);
  const [year, month, day] = clean.split("-").map(Number);
  return new Date(year, month - 1, day, 12, 0, 0);
}

export function dateObjectToDateString(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
