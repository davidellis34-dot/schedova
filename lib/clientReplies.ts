import { supabase } from "./supabase";

type ResolveClientReplyParams = {
  messageId: string;
  userId: string;
  appointmentId?: string | null;
};

export type ResolveClientReplyResult = {
  messageId: string;
  appointmentId: string | null;
  resolvedAt: string;
  readAt: string;
  clearedAppointmentAttention: boolean;
};

export async function resolveClientReply({
  messageId,
  userId,
  appointmentId,
}: ResolveClientReplyParams): Promise<ResolveClientReplyResult> {
  const resolvedAt = new Date().toISOString();

  const { data: existingMessage, error: existingMessageError } = await supabase
    .from("sms_message_logs")
    .select("id, read_at, appointment_id")
    .eq("id", messageId)
    .eq("user_id", userId)
    .maybeSingle();

  if (existingMessageError) {
    throw new Error(existingMessageError.message);
  }

  if (!existingMessage?.id) {
    throw new Error("Reply log not found.");
  }

  const readAt = existingMessage.read_at || resolvedAt;
  const linkedAppointmentId =
    appointmentId || existingMessage.appointment_id || null;

  const { error: updateError } = await supabase
    .from("sms_message_logs")
    .update({
      resolved_at: resolvedAt,
      read_at: readAt,
      needs_attention: false,
    })
    .eq("id", messageId)
    .eq("user_id", userId);

  if (updateError) {
    throw new Error(updateError.message);
  }

  let clearedAppointmentAttention = false;

  if (linkedAppointmentId) {
    const { count, error: remainingError } = await supabase
      .from("sms_message_logs")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .eq("direction", "inbound")
      .eq("appointment_id", linkedAppointmentId)
      .is("resolved_at", null)
      .neq("id", messageId);

    if (!remainingError && (count || 0) === 0) {
      const { error: appointmentError } = await supabase
        .from("appointments")
        .update({
          needs_attention: false,
          attention_reason: null,
        })
        .eq("id", linkedAppointmentId)
        .eq("user_id", userId);

      if (!appointmentError) {
        clearedAppointmentAttention = true;
      }
    }
  }

  return {
    messageId,
    appointmentId: linkedAppointmentId,
    resolvedAt,
    readAt,
    clearedAppointmentAttention,
  };
}
