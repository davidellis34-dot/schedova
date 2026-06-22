export type AppointmentConfirmationStatus =
  | "confirmed"
  | "declined"
  | "pending"
  | null;

export type AppointmentReplySummary = {
  body?: string | null;
  message_body?: string | null;
  needs_attention?: boolean | null;
};

const CONFIRMED_REPLY_PATTERN =
  /\b(confirm|confirmed|yes|yep|yeah|ok|okay|sounds good|see you)\b/i;
const DECLINED_REPLY_PATTERN =
  /\b(cancel|cancelled|canceled|no|can't make it|cant make it|cannot make it|reschedule|change|different time|move appointment)\b/i;

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
  const status = String(appointment?.status || "").toLowerCase();
  const replyText = String(
    latestReply?.message_body || latestReply?.body || "",
  ).toLowerCase();

  if (
    status === "confirmed" ||
    status === "accepted" ||
    CONFIRMED_REPLY_PATTERN.test(replyText)
  ) {
    return "confirmed";
  }

  if (
    status === "declined" ||
    status === "canceled" ||
    status === "cancelled" ||
    DECLINED_REPLY_PATTERN.test(replyText)
  ) {
    return "declined";
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
    case "declined":
      return "Declined";
    case "pending":
      return "Awaiting response";
    default:
      return "";
  }
}
