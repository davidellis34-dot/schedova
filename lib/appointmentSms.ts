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

export type AppointmentSmsDebugContext = {
  sendPathName?: string;
  userId?: string | null;
  appointmentIdFromMutation?: string | null;
};

const SMS_SEND_FRIENDLY_ERROR =
  "Something went wrong sending the message. Please try again.";

export function getFriendlySmsMessage(code?: string | null) {
  switch (code) {
    case "sms_provider_not_configured":
      return "SMS messaging is not enabled yet.";
    case "missing_phone":
      return "This client does not have a phone number.";
    case "invalid_phone":
      return "Please check the client's phone number.";
    case "client_not_opted_in":
      return "This client has not opted into appointment texts.";
    case "insufficient_credits":
    case "message_credits_empty":
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

function logAppointmentSmsDebug(
  label: string,
  appointmentId: string,
  messageType: AppointmentSmsMessageType,
  debugContext?: AppointmentSmsDebugContext,
  extra: Record<string, unknown> = {},
) {
  if (!__DEV__) return;

  console.log(`[AppointmentSMS] ${label}`, {
    appointmentId,
    messageType,
    sendPathName: debugContext?.sendPathName || "unknown",
    userId: debugContext?.userId || null,
    appointmentIdFromMutation: debugContext?.appointmentIdFromMutation || null,
    appointmentIdMatchesMutation: debugContext?.appointmentIdFromMutation
      ? appointmentId === debugContext.appointmentIdFromMutation
      : null,
    ...extra,
  });
}

async function getSmsPreflightSkip(
  appointmentId: string,
  messageType: AppointmentSmsMessageType,
  debugContext?: AppointmentSmsDebugContext,
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
    .select("id, client_id, sms_notifications_enabled")
    .eq("id", appointmentId)
    .eq("user_id", user.id)
    .maybeSingle();

  logAppointmentSmsDebug(
    "preflight appointment lookup",
    appointmentId,
    messageType,
    debugContext,
    {
      authUserId: user.id,
      appointmentFound: Boolean(appointment),
      appointmentClientId: appointment?.client_id || null,
      appointmentLookupError: appointmentError?.message || null,
    },
  );

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

  if (appointment.sms_notifications_enabled === false) {
    return { ok: true, skipped: true, code: "sms_disabled" };
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
  debugContext?: AppointmentSmsDebugContext,
): Promise<AppointmentSmsResult> {
  if (!appointmentId) {
    return { ok: false, skipped: true, code: "missing_appointment" };
  }

  logAppointmentSmsDebug("invoke start", appointmentId, messageType, debugContext);

  const preflightSkip = await getSmsPreflightSkip(
    appointmentId,
    messageType,
    debugContext,
  );

  if (preflightSkip) {
    logAppointmentSmsDebug(
      "preflight skipped",
      appointmentId,
      messageType,
      debugContext,
      {
        code: preflightSkip.code || null,
      },
    );
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
            ? "insufficient_credits"
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

  const result = {
    ok: true,
    ...(typeof data === "object" && data ? data : {}),
  } as AppointmentSmsResult;

  logAppointmentSmsDebug("invoke result", appointmentId, messageType, debugContext, {
    ok: result.ok,
    skipped: result.skipped || false,
    code: result.code || null,
  });

  return result;
}

export async function sendAppointmentSmsNonBlocking(
  appointmentId: string,
  messageType: AppointmentSmsMessageType,
  debugContext?: AppointmentSmsDebugContext,
) {
  try {
    const result = await sendAppointmentSms(
      appointmentId,
      messageType,
      debugContext,
    );

    if (result.ok && !result.skipped) {
      emitSmsBalanceUpdated();
    }

    if (
      !result.ok &&
      !["insufficient_credits", "message_credits_empty"].includes(
        String(result.code || ""),
      )
    ) {
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

export async function sendManualClientSms(input: {
  clientId: string;
  appointmentId?: string | null;
  conversationId?: string | null;
  messageBody: string;
}): Promise<
  AppointmentSmsResult & {
    messageId?: string | null;
    providerMessageId?: string | null;
    conversationId?: string | null;
    balance?: number | null;
  }
> {
  const { data, error } = await supabase.functions.invoke(
    "send-manual-client-sms",
    {
      body: input,
    },
  );

  if (error) {
    const context = (error as { context?: Response }).context;
    const errorDetails = await readFunctionErrorDetails(error);
    const code =
      typeof errorDetails === "object" &&
      errorDetails &&
      "code" in errorDetails &&
      typeof (errorDetails as { code?: unknown }).code === "string"
        ? (errorDetails as { code: string }).code
        : context?.status === 402
          ? "insufficient_credits"
          : "function_error";

    if (__DEV__) {
      console.log("Manual SMS function error", {
        status: context?.status,
        details: errorDetails,
      });
    }

    return {
      ok: false,
      status: context?.status,
      code,
      message: getFriendlySmsMessage(code),
    };
  }

  const result = {
    ok: true,
    ...(typeof data === "object" && data ? data : {}),
  } as AppointmentSmsResult & {
    messageId?: string | null;
    providerMessageId?: string | null;
    conversationId?: string | null;
    balance?: number | null;
  };

  if (result.ok && !result.skipped) {
    emitSmsBalanceUpdated();
  }

  return result;
}
