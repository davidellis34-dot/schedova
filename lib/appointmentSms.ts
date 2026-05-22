import { supabase } from "./supabase";

export type AppointmentSmsMessageType =
  | "confirmation"
  | "update"
  | "cancellation"
  | "reminder";

export type AppointmentSmsResult = {
  ok: boolean;
  skipped?: boolean;
  status?: number;
  code?: string;
  message?: string;
};

export async function sendAppointmentSms(
  appointmentId: string,
  messageType: AppointmentSmsMessageType,
): Promise<AppointmentSmsResult> {
  if (!appointmentId) {
    return { ok: false, skipped: true, code: "missing_appointment" };
  }

  const { data, error } = await supabase.functions.invoke(
    "send-appointment-sms",
    {
      body: {
        appointmentId,
        messageType,
      },
    },
  );

  if (error) {
    const context = (error as { context?: Response }).context;
    return {
      ok: false,
      status: context?.status,
      code: context?.status === 402 ? "not_paid" : "function_error",
      message: error.message,
    };
  }

  return {
    ok: true,
    ...(typeof data === "object" && data ? data : {}),
  } as AppointmentSmsResult;
}

export async function sendAppointmentSmsNonBlocking(
  appointmentId: string,
  messageType: AppointmentSmsMessageType,
) {
  try {
    const result = await sendAppointmentSms(appointmentId, messageType);

    if (!result.ok && result.code !== "not_paid") {
      console.log("Appointment SMS was not sent", result);
    }

    return result;
  } catch (error) {
    console.log("Appointment SMS failed", error);
    return { ok: false, code: "exception" } satisfies AppointmentSmsResult;
  }
}
