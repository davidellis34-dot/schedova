export type SmartReminderAction =
  | "dismissed"
  | "remind_later"
  | "sending"
  | "sent";

export type SmartReminderRecord = {
  action: SmartReminderAction;
  remind_after: string | null;
};

export function isSmartReminderBlocked(
  record: SmartReminderRecord | null | undefined,
  now = new Date(),
) {
  if (!record) return false;
  if (
    record.action === "dismissed" ||
    record.action === "sent" ||
    record.action === "sending"
  ) {
    return true;
  }

  if (record.action !== "remind_later" || !record.remind_after) return false;

  const remindAfter = new Date(record.remind_after).getTime();
  return Number.isFinite(remindAfter) && remindAfter > now.getTime();
}

export function getSmartReminderSnoozeDate(
  now = new Date(),
  days = 7,
) {
  const next = new Date(now);
  next.setDate(next.getDate() + days);
  return next.toISOString();
}
