import { supabase } from "./supabase";

export type AppointmentEmailMessageType =
  | "confirmation"
  | "update"
  | "cancellation"
  | "reminder";

export type AppointmentEmailResult = {
  ok: boolean;
  skipped?: boolean;
  code?: string;
  message?: string;
  providerMessageId?: string | null;
  messageId?: string | null;
  conversationId?: string | null;
};

export type AppointmentDeliveryChoice = "text" | "email" | "both" | "none";

const EMAIL_SEND_FRIENDLY_ERROR =
  "Email could not be sent right now. Please try again.";

export function getFriendlyEmailMessage(code?: string | null) {
  switch (code) {
    case "missing_email":
      return "This client does not have an email address.";
    case "email_not_opted_in":
      return "This client has not opted into appointment emails.";
    case "not_paid":
      return "Email messaging is included with Schedova Pro.";
    case "email_provider_failed":
      return "Email could not be sent right now. Please try again.";
    default:
      return EMAIL_SEND_FRIENDLY_ERROR;
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

function extractErrorCode(errorDetails: unknown, fallback = "function_error") {
  if (
    errorDetails &&
    typeof errorDetails === "object" &&
    "code" in errorDetails &&
    typeof (errorDetails as { code?: unknown }).code === "string"
  ) {
    return (errorDetails as { code: string }).code;
  }

  return fallback;
}

export async function sendAppointmentEmail(
  appointmentId: string,
  messageType: AppointmentEmailMessageType,
  options?: {
    subject?: string | null;
    messageBody?: string | null;
  },
): Promise<AppointmentEmailResult> {
  if (!appointmentId) {
    return { ok: false, skipped: true, code: "missing_appointment" };
  }

  const { data, error } = await supabase.functions.invoke(
    "send-appointment-email",
    {
      body: {
        appointmentId,
        messageType,
        subject: options?.subject || null,
        messageBody: options?.messageBody || null,
      },
    },
  );

  if (error) {
    const context = (error as { context?: Response }).context;
    const errorDetails = await readFunctionErrorDetails(error);
    const code = extractErrorCode(
      errorDetails,
      context?.status === 402 ? "not_paid" : "function_error",
    );

    if (__DEV__) {
      console.log("Email function error", {
        status: context?.status,
        details: errorDetails,
      });
    }

    return {
      ok: false,
      code,
      message: getFriendlyEmailMessage(code),
    };
  }

  return {
    ok: true,
    ...(typeof data === "object" && data ? data : {}),
  } as AppointmentEmailResult;
}

export async function sendAppointmentEmailNonBlocking(
  appointmentId: string,
  messageType: AppointmentEmailMessageType,
  options?: {
    subject?: string | null;
    messageBody?: string | null;
  },
) {
  try {
    const result = await sendAppointmentEmail(appointmentId, messageType, options);

    if (!result.ok && !result.skipped) {
      console.log("Appointment email was not sent", result);
    } else if (result.skipped) {
      console.log("Appointment email skipped", result.code);
    }

    return result;
  } catch (error) {
    console.log("Appointment email failed", error);
    return {
      ok: false,
      code: "exception",
      message: EMAIL_SEND_FRIENDLY_ERROR,
    } satisfies AppointmentEmailResult;
  }
}

export async function sendManualClientEmail(input: {
  clientId: string;
  appointmentId?: string | null;
  conversationId?: string | null;
  subject?: string | null;
  messageBody: string;
}): Promise<AppointmentEmailResult> {
  const { data, error } = await supabase.functions.invoke(
    "send-manual-client-email",
    {
      body: input,
    },
  );

  if (error) {
    const context = (error as { context?: Response }).context;
    const errorDetails = await readFunctionErrorDetails(error);
    const code = extractErrorCode(
      errorDetails,
      context?.status === 402 ? "not_paid" : "function_error",
    );

    return {
      ok: false,
      code,
      message: getFriendlyEmailMessage(code),
    };
  }

  return {
    ok: true,
    ...(typeof data === "object" && data ? data : {}),
  } as AppointmentEmailResult;
}

export function shouldSendText(choice: AppointmentDeliveryChoice) {
  return choice === "text" || choice === "both";
}

export function shouldSendEmail(choice: AppointmentDeliveryChoice) {
  return choice === "email" || choice === "both";
}
