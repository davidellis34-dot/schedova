import { todayIso } from "./bookingUtils";

export function cleanDateOnly(value?: string) {
  if (!value) return todayIso();
  const clean = String(value).split("T")[0];
  return /^\d{4}-\d{2}-\d{2}$/.test(clean) ? clean : todayIso();
}

export function dateStringToLocalDate(dateString?: string) {
  const clean = cleanDateOnly(dateString);
  const [year, month, day] = clean.split("-").map(Number);
  const date = new Date(year, month - 1, day, 12, 0, 0);

  return Number.isNaN(date.getTime()) ? new Date() : date;
}

export function dateObjectToDateString(date: Date) {
  if (Number.isNaN(date.getTime())) return todayIso();

  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
