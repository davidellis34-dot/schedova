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
  creditsRemaining?: number | null;
};

async function readFunctionErrorBody(error: unknown) {
  const context = (error as { context?: Response }).context;

  if (!context) return null;

  try {
    return await context.clone().json();
  } catch {
    return null;
  }
}

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
    const errorBody = await readFunctionErrorBody(error);

    return {
      ok: false,
      status: context?.status,
      code:
        typeof errorBody?.code === "string"
          ? errorBody.code
          : context?.status === 402
            ? "message_credits_empty"
            : "function_error",
      message:
        typeof errorBody?.message === "string"
          ? errorBody.message
          : error.message,
      creditsRemaining:
        typeof errorBody?.creditsRemaining === "number"
          ? errorBody.creditsRemaining
          : null,
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

    if (!result.ok && result.code !== "message_credits_empty") {
      console.log("Appointment SMS was not sent", result);
    }

    return result;
  } catch (error) {
    console.log("Appointment SMS failed", error);
    return { ok: false, code: "exception" } satisfies AppointmentSmsResult;
  }
}
