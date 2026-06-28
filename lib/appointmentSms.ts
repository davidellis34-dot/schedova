import { supabase } from "./supabase";
import { normalizePhoneForSmsWithUserDefault } from "./countrySettings";
import { emitSmsBalanceUpdated } from "./smsBalanceEvents";

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

const SMS_SEND_FRIENDLY_ERROR =
  "Something went wrong sending the message. Please try again.";

export function getFriendlySmsMessage(code?: string | null) {
  switch (code) {
    case "missing_phone":
      return "This client does not have a phone number.";
    case "invalid_phone":
      return "Please check the client's phone number.";
    case "insufficient_credits":
      return "You are out of SMS credits. Buy a message pack to keep sending texts.";
    case "sms_provider_failed":
    case "provider_error":
    case "send_failed":
    case "function_error":
      return "Unable to send message right now. Please try again.";
    default:
      return SMS_SEND_FRIENDLY_ERROR;
  }
}

async function readFunctionErrorDetails(error: unknown) {
  const context =
    error && typeof error === "object" && "context" in error
      ? ((error as { context?: Response }).context ?? null)
      : null;

  if (!context) return null;

  try {
    return await context.clone().json();
  } catch {
    try {
      return await context.clone().text();
    } catch {
      return null;
    }
  }
}

async function getSmsPreflightSkip(
  appointmentId: string,
): Promise<AppointmentSmsResult | null> {
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return {
      ok: false,
      skipped: true,
      code: "missing_user",
      message: SMS_SEND_FRIENDLY_ERROR,
    };
  }

  const { data: appointment, error: appointmentError } = await supabase
    .from("appointments")
    .select("id, client_id")
    .eq("id", appointmentId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (appointmentError) {
    console.log("Appointment SMS preflight failed", appointmentError.message);
    return {
      ok: false,
      skipped: true,
      code: "appointment_lookup_failed",
      message: SMS_SEND_FRIENDLY_ERROR,
    };
  }

  if (!appointment?.client_id) {
    return { ok: true, skipped: true, code: "missing_client" };
  }

  const { data: client, error: clientError } = await supabase
    .from("clients")
    .select("id, phone, sms_opt_in")
    .eq("id", appointment.client_id)
    .eq("user_id", user.id)
    .maybeSingle();

  if (clientError) {
    console.log("Appointment SMS client preflight failed", clientError.message);
    return {
      ok: false,
      skipped: true,
      code: "client_lookup_failed",
      message: SMS_SEND_FRIENDLY_ERROR,
    };
  }

  if (!client) {
    return { ok: true, skipped: true, code: "missing_client" };
  }

  const normalizedPhone = await normalizePhoneForSmsWithUserDefault(
    client.phone,
  );

  if (!normalizedPhone) {
    const hasPhoneValue = String(client.phone || "").trim().length > 0;
    const code = hasPhoneValue ? "invalid_phone" : "missing_phone";

    return {
      ok: false,
      skipped: true,
      code,
      message: getFriendlySmsMessage(code),
    };
  }

  if (!client.sms_opt_in) {
    return { ok: true, skipped: true, code: "client_not_opted_in" };
  }

  return null;
}

export async function sendAppointmentSms(
  appointmentId: string,
  messageType: AppointmentSmsMessageType,
): Promise<AppointmentSmsResult> {
  if (!appointmentId) {
    return { ok: false, skipped: true, code: "missing_appointment" };
  }

  const preflightSkip = await getSmsPreflightSkip(appointmentId);

  if (preflightSkip) {
    return preflightSkip;
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
    const errorDetails = await readFunctionErrorDetails(error);
    if (__DEV__) {
      console.log("SMS function error", error);
    }
    if (__DEV__ && errorDetails !== null) {
      console.log("SMS function error details", errorDetails);
    }
    return {
      ok: false,
      status: context?.status,
      code:
        typeof errorDetails === "object" &&
        errorDetails &&
        "code" in errorDetails &&
        typeof (errorDetails as { code?: unknown }).code === "string"
          ? (errorDetails as { code: string }).code
          : context?.status === 402
            ? "not_paid"
            : "function_error",
      message: getFriendlySmsMessage(
        typeof errorDetails === "object" &&
          errorDetails &&
          "code" in errorDetails &&
          typeof (errorDetails as { code?: unknown }).code === "string"
          ? (errorDetails as { code: string }).code
          : "function_error",
      ),
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

    if (result.ok && !result.skipped) {
      emitSmsBalanceUpdated();
    }

    if (!result.ok && result.code !== "not_paid") {
      console.log("Appointment SMS was not sent", result);
    } else if (result.skipped) {
      console.log("Appointment SMS skipped", result.code);
    }

    return result;
  } catch (error) {
    console.log("Appointment SMS failed", error);
    return {
      ok: false,
      code: "exception",
      message: SMS_SEND_FRIENDLY_ERROR,
    } satisfies AppointmentSmsResult;
  }
}
