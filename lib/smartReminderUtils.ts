export type RebookingIntervalUnit = "days" | "weeks" | "months";

function dateOnly(value: Date) {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function parseDateOnly(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  if (!year || !month || !day) return null;
  const date = new Date(year, month - 1, day, 12, 0, 0, 0);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function getRebookingDueDate(
  completedDate: string,
  intervalValue: number,
  intervalUnit: RebookingIntervalUnit,
) {
  const date = parseDateOnly(completedDate);
  if (!date || !Number.isInteger(intervalValue) || intervalValue <= 0) return null;

  if (intervalUnit === "days") date.setDate(date.getDate() + intervalValue);
  if (intervalUnit === "weeks") date.setDate(date.getDate() + intervalValue * 7);
  if (intervalUnit === "months") date.setMonth(date.getMonth() + intervalValue);

  return dateOnly(date);
}
