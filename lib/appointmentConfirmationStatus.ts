export type AppointmentConfirmationStatus =
  | "confirmed"
  | "needs_reschedule"
  | "declined"
  | "pending"
  | null;

export type AppointmentReplySummary = {
  body?: string | null;
  message_body?: string | null;
  status?: string | null;
  needs_attention?: boolean | null;
};

function normalize(value: unknown) {
  return String(value || "")
    .trim()
    .toLowerCase();
}

function normalizeReplyText(value: unknown) {
  return normalize(value)
    .replace(/['’`]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function hasPhrase(normalizedText: string, phrase: string) {
  return ` ${normalizedText} `.includes(` ${phrase} `);
}

function getStatusFromText(value: unknown): AppointmentConfirmationStatus {
  const replyText = normalizeReplyText(value);
  if (!replyText) return null;

  const words = new Set(replyText.split(" "));

  if (
    words.has("yes") ||
    words.has("y") ||
    words.has("confirm") ||
    words.has("confirmed") ||
    words.has("ok") ||
    words.has("okay") ||
    hasPhrase(replyText, "sounds good") ||
    hasPhrase(replyText, "see you then") ||
    hasPhrase(replyText, "see you")
  ) {
    return "confirmed";
  }

  if (
    words.has("cancel") ||
    words.has("cancelled") ||
    words.has("canceled")
  ) {
    return "declined";
  }

  if (
    words.has("no") ||
    words.has("n") ||
    words.has("reschedule") ||
    hasPhrase(replyText, "need to reschedule") ||
    hasPhrase(replyText, "cant make it") ||
    hasPhrase(replyText, "can t make it") ||
    hasPhrase(replyText, "cannot make it") ||
    hasPhrase(replyText, "different time") ||
    hasPhrase(replyText, "move appointment") ||
    words.has("change")
  ) {
    return "needs_reschedule";
  }

  return null;
}

function normalizeConfirmationStatus(value: unknown): AppointmentConfirmationStatus {
  const status = normalize(value);

  switch (status) {
    case "confirmed":
    case "accepted":
      return "confirmed";
    case "needs_reschedule":
    case "reschedule":
    case "not_confirmed":
    case "no":
      return "needs_reschedule";
    case "declined":
    case "canceled":
    case "cancelled":
      return "declined";
    case "awaiting_response":
    case "waiting_for_response":
    case "pending":
      return "pending";
    default:
      return null;
  }
}

function hasSentConfirmationLikeMessage(appointment: any) {
  return Boolean(
    appointment?.sms_confirmation_sent_at ||
      appointment?.confirmation_sent_at ||
      appointment?.sms_reminder_sent_at ||
      appointment?.reminder_sent_at,
  );
}

export function getAppointmentConfirmationStatus(
  appointment: any,
  latestReply?: AppointmentReplySummary | null,
): AppointmentConfirmationStatus {
  const confirmationStatus = normalizeConfirmationStatus(
    appointment?.confirmation_status,
  );
  const replyStatus = normalizeConfirmationStatus(latestReply?.status);
  const lifecycleStatus = normalizeConfirmationStatus(appointment?.status);
  const replyText = String(
    latestReply?.message_body || latestReply?.body || "",
  );
  const textStatus = getStatusFromText(replyText);

  if (
    confirmationStatus === "confirmed" ||
    replyStatus === "confirmed" ||
    lifecycleStatus === "confirmed" ||
    textStatus === "confirmed" ||
    appointment?.confirmed_at
  ) {
    return "confirmed";
  }

  if (
    confirmationStatus === "declined" ||
    replyStatus === "declined" ||
    lifecycleStatus === "declined" ||
    textStatus === "declined"
  ) {
    return "declined";
  }

  if (
    confirmationStatus === "needs_reschedule" ||
    replyStatus === "needs_reschedule" ||
    textStatus === "needs_reschedule"
  ) {
    return "needs_reschedule";
  }

  if (confirmationStatus === "pending" || replyStatus === "pending") {
    return "pending";
  }

  if (hasSentConfirmationLikeMessage(appointment)) {
    return "pending";
  }

  return null;
}

export function getAppointmentConfirmationLabel(
  status: AppointmentConfirmationStatus,
) {
  switch (status) {
    case "confirmed":
      return "Confirmed";
    case "needs_reschedule":
      return "Needs reschedule";
    case "declined":
      return "Declined";
    case "pending":
      return "Awaiting response";
    default:
      return "";
  }
}
