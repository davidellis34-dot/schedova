import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

import {
  DEFAULT_COUNTRY_REGION,
  isCountryRegionCode,
  normalizePhoneForSms,
} from "../../../lib/phoneNumbers.ts";
import { getMessageSenderDisplayName } from "../../../lib/messageSender.ts";
import {
  formatAppointmentDate,
  formatAppointmentTime,
  getBusinessName,
} from "../_shared/emailMessages.ts";
import {
  confirmMessageCreditReservation,
  refundMessageCreditReservation,
  reserveMessageCredit,
} from "../_shared/messageCredits.ts";

type AppointmentSmsMessageType =
  | "confirmation"
  | "update"
  | "cancellation"
  | "reminder";

type AppointmentRecord = {
  id: string;
  user_id: string;
  client_id: string | null;
  client_name: string | null;
  appointment_date: string | null;
  appointment_time: string | null;
  sms_confirmation_sent_at?: string | null;
  sms_reminder_sent_at?: string | null;
};

type ClientRecord = {
  id: string;
  name: string | null;
  phone: string | null;
  sms_opt_in: boolean | null;
};

type SmsSettingsRecord = {
  enabled?: boolean | null;
  appointment_confirmations_enabled?: boolean | null;
  appointment_updates_enabled?: boolean | null;
  appointment_cancellations_enabled?: boolean | null;
  appointment_reminders_enabled?: boolean | null;
};

type UserSettingsRecord = {
  country_region?: string | null;
};

type JsonObject = Record<string, unknown>;

const VALID_MESSAGE_TYPES: AppointmentSmsMessageType[] = [
  "confirmation",
  "update",
  "cancellation",
  "reminder",
];

const TELNYX_MESSAGES_URL = "https://api.telnyx.com/v2/messages";
const SMS_PROVIDER = "telnyx";
const SMS_DIRECTION = "outbound";
const SMS_SEND_FRIENDLY_ERROR =
  "SMS reminder could not be sent. Please check settings and try again.";
const DUPLICATE_CONFIRMATION_SKIP_CODE = "duplicate_confirmation";
const NON_FAILED_SMS_LOG_STATUSES = new Set([
  "accepted",
  "delivered",
  "pending",
  "processing",
  "queued",
  "sending",
  "sent",
]);

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
    },
  });
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message || error.name || "Unknown error";

  if (error && typeof error === "object" && "message" in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string" && message.trim()) return message;
  }

  return String(error || "Unknown error");
}

function serializeDetails(details: unknown): unknown {
  if (details instanceof Error) {
    return {
      name: details.name,
      message: details.message,
      stack: details.stack || null,
    };
  }

  if (details === undefined) return null;

  try {
    return JSON.parse(JSON.stringify(details));
  } catch {
    return { value: String(details) };
  }
}

function jsonError(
  error: unknown,
  status: number,
  extra: Record<string, unknown> = {},
) {
  return jsonResponse(
    {
      ok: false,
      error: getErrorMessage(error),
      details: serializeDetails(error),
      ...extra,
    },
    status,
  );
}

function asTrimmedString(value: unknown) {
  return String(value || "").trim();
}

function asNullableUuid(value: unknown) {
  const text = asTrimmedString(value);
  if (!text) return null;

  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    text,
  )
    ? text
    : null;
}

function isValidMessageType(
  value: string,
): value is AppointmentSmsMessageType {
  return VALID_MESSAGE_TYPES.includes(value as AppointmentSmsMessageType);
}

function messageEnabledKey(messageType: AppointmentSmsMessageType) {
  switch (messageType) {
    case "confirmation":
      return "appointment_confirmations_enabled";
    case "update":
      return "appointment_updates_enabled";
    case "cancellation":
      return "appointment_cancellations_enabled";
    case "reminder":
      return "appointment_reminders_enabled";
  }
}

function buildSmsBody({
  clientName,
  appointmentDate,
  appointmentTime,
  messageType,
  senderName,
}: {
  clientName: string;
  appointmentDate: string;
  appointmentTime: string;
  messageType: AppointmentSmsMessageType;
  senderName: string;
}) {
  const name = clientName || "there";
  const sender = senderName || "Schedova Appointment";
  const date = formatAppointmentDate(appointmentDate);
  const time = formatAppointmentTime(appointmentTime);
  const replyInstructions =
    "Reply YES to confirm, NO if you need to reschedule, or CANCEL to cancel.";

  switch (messageType) {
    case "confirmation":
      return `Hi ${name}, this is ${sender} confirming your appointment on ${date} at ${time}.\n\n${replyInstructions}`;
    case "update":
      return `Hi ${name}, this is ${sender}. Your appointment has been updated to ${date} at ${time}. Reply here if you need help.`;
    case "cancellation":
      return `Hi ${name}, this is ${sender}. Your appointment on ${date} at ${time} has been canceled. Reply here if you need to reschedule.`;
    case "reminder":
      return `Hi ${name}, this is ${sender} reminding you about your appointment on ${date} at ${time}.\n\n${replyInstructions}`;
  }
}

function appointmentSentAtColumn(messageType: AppointmentSmsMessageType) {
  switch (messageType) {
    case "confirmation":
      return "sms_confirmation_sent_at";
    case "reminder":
      return "sms_reminder_sent_at";
    default:
      return null;
  }
}

function shouldSkipDuplicateAppointmentSms(
  messageType: AppointmentSmsMessageType,
) {
  return messageType === "confirmation";
}

async function hasExistingAppointmentSmsRecord(
  serviceClient: any,
  userId: string,
  appointmentId: string,
  messageType: AppointmentSmsMessageType,
) {
  const { data, error } = await serviceClient
    .from("sms_message_logs")
    .select("id, status, provider_message_id, created_at")
    .eq("user_id", userId)
    .eq("appointment_id", appointmentId)
    .eq("message_type", messageType)
    .eq("direction", SMS_DIRECTION)
    .order("created_at", { ascending: false })
    .limit(5);

  if (error) {
    console.error("existing appointment SMS lookup failed", {
      userId,
      appointmentId,
      messageType,
      error,
    });
    throw error;
  }

  return ((data || []) as JsonObject[]).some((row) => {
    const status = asTrimmedString(row.status).toLowerCase();
    const providerMessageId = asTrimmedString(row.provider_message_id);
    return providerMessageId.length > 0 || NON_FAILED_SMS_LOG_STATUSES.has(status);
  });
}

function safeParseJson(text: string) {
  if (!text.trim()) return null;

  try {
    return JSON.parse(text) as JsonObject;
  } catch {
    return null;
  }
}

function extractTelnyxProviderMessageId(telnyxBody: unknown) {
  if (!telnyxBody || typeof telnyxBody !== "object") return null;

  const data =
    "data" in telnyxBody && telnyxBody.data && typeof telnyxBody.data === "object"
      ? (telnyxBody.data as JsonObject)
      : null;

  return asTrimmedString(data?.id) || null;
}

function extractTelnyxMessageStatus(telnyxBody: unknown) {
  if (!telnyxBody || typeof telnyxBody !== "object") return "sent";

  const data =
    "data" in telnyxBody && telnyxBody.data && typeof telnyxBody.data === "object"
      ? (telnyxBody.data as JsonObject)
      : null;
  const directStatus = asTrimmedString(data?.status);
  const toList = Array.isArray(data?.to) ? data.to : [];
  const firstRecipient =
    toList[0] && typeof toList[0] === "object"
      ? (toList[0] as JsonObject)
      : null;
  const recipientStatus = asTrimmedString(firstRecipient?.status);

  return recipientStatus || directStatus || "sent";
}

function extractTelnyxErrorMessage(telnyxBody: unknown, status: number) {
  if (telnyxBody && typeof telnyxBody === "object") {
    const body = telnyxBody as JsonObject;
    const errors = Array.isArray(body.errors) ? body.errors : [];

    for (const item of errors) {
      if (!item || typeof item !== "object") continue;

      const error = item as JsonObject;
      const detail = asTrimmedString(error.detail);
      const title = asTrimmedString(error.title);
      const code = asTrimmedString(error.code);
      const message = [code, title, detail].filter(Boolean).join(": ");

      if (message) return message;
    }

    const topLevelMessage =
      asTrimmedString(body.message) || asTrimmedString(body.error);

    if (topLevelMessage) return topLevelMessage;
  }

  return `Telnyx HTTP ${status}`;
}

function buildSmsLogPayload({
  userId,
  appointmentId = null,
  clientId = null,
  messageType,
  toPhone = null,
  smsBody = null,
  status,
  fromNumber = null,
  providerMessageId = null,
  providerResponse = null,
  errorMessage = null,
}: {
  userId: string;
  appointmentId?: string | null;
  clientId?: string | null;
  messageType: string;
  toPhone?: string | null;
  smsBody?: string | null;
  status: string;
  fromNumber?: string | null;
  providerMessageId?: string | null;
  providerResponse?: unknown;
  errorMessage?: string | null;
}) {
  return {
    user_id: userId,
    appointment_id: asNullableUuid(appointmentId),
    client_id: asNullableUuid(clientId),
    message_type: asTrimmedString(messageType) || "unknown",
    to_phone: toPhone || null,
    to_number: toPhone || null,
    body: smsBody || null,
    message_body: smsBody || null,
    status,
    provider: SMS_PROVIDER,
    direction: SMS_DIRECTION,
    from_number: fromNumber || null,
    provider_message_id: providerMessageId,
    provider_response: serializeDetails(providerResponse),
    error_message: errorMessage,
  };
}

async function tryInsertSmsLog(
  serviceClient: any,
  payload: Record<string, unknown>,
  step: string,
) {
  const { data, error } = await serviceClient
    .from("sms_message_logs")
    .insert(payload)
    .select("id")
    .maybeSingle();

  if (error) {
    console.error("sms_message_logs insert error", {
      step,
      error,
      payload,
    });
    return null;
  }

  return data?.id ? String(data.id) : null;
}

async function tryUpdateSmsLog(
  serviceClient: any,
  logId: string,
  payload: Record<string, unknown>,
  step: string,
) {
  const { error } = await serviceClient
    .from("sms_message_logs")
    .update(payload)
    .eq("id", logId);

  if (error) {
    console.error("sms_message_logs update error", {
      step,
      logId,
      error,
      payload,
    });
  }
}

function missingKeys(
  entries: Array<[string, string | undefined]>,
) {
  return entries.filter(([, value]) => !value).map(([name]) => name);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return jsonResponse({ ok: false, error: "Method not allowed" }, 405);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const telnyxApiKey = Deno.env.get("TELNYX_API_KEY");
  const telnyxFromNumber = Deno.env.get("TELNYX_FROM_NUMBER");
  const telnyxMessagingProfileId = Deno.env.get(
    "TELNYX_MESSAGING_PROFILE_ID",
  );

  const missingSupabaseEnv = missingKeys([
    ["SUPABASE_URL", supabaseUrl],
    ["SUPABASE_ANON_KEY", supabaseAnonKey],
    ["SUPABASE_SERVICE_ROLE_KEY", serviceRoleKey],
  ]);

  if (missingSupabaseEnv.length > 0) {
    console.error("missing env vars", {
      step: "supabase_env",
      missing: missingSupabaseEnv,
    });
    return jsonError(
      { message: "Supabase env missing", missing: missingSupabaseEnv },
      500,
      { step: "supabase_env" },
    );
  }

  const authHeader = req.headers.get("Authorization") || "";
  const userClient = createClient(supabaseUrl!, supabaseAnonKey!, {
    global: { headers: { Authorization: authHeader } },
  });
  const serviceClient = createClient(supabaseUrl!, serviceRoleKey!);

  const {
    data: { user },
    error: authError,
  } = await userClient.auth.getUser();

  if (authError || !user) {
    console.error("auth failure", {
      error: authError,
      hasUser: Boolean(user),
    });
    return jsonError(authError || { message: "Unauthorized" }, 401, {
      step: "auth",
    });
  }

  let requestBody: JsonObject = {};

  try {
    const parsed = await req.json();
    requestBody =
      parsed && typeof parsed === "object" ? (parsed as JsonObject) : {};
  } catch (error) {
    await tryInsertSmsLog(
      serviceClient,
      buildSmsLogPayload({
        userId: user.id,
        messageType: "unknown",
        status: "failed",
        fromNumber: telnyxFromNumber || null,
        errorMessage: "Invalid JSON request body",
      }),
      "request_json",
    );
    return jsonError(error, 400, {
      step: "request_json",
      message: "Invalid JSON request body",
    });
  }

  const appointmentId = asTrimmedString(
    requestBody.appointment_id || requestBody.appointmentId,
  );
  const requestedClientId = asTrimmedString(
    requestBody.client_id || requestBody.clientId,
  );
  const rawMessageType = asTrimmedString(
    requestBody.message_type || requestBody.messageType,
  );

  if (!appointmentId || !isValidMessageType(rawMessageType)) {
    await tryInsertSmsLog(
      serviceClient,
      buildSmsLogPayload({
        userId: user.id,
        appointmentId,
        clientId: requestedClientId,
        messageType: rawMessageType || "unknown",
        status: "failed",
        fromNumber: telnyxFromNumber || null,
        providerResponse: requestBody,
        errorMessage: "Invalid SMS request",
      }),
      "request_validation",
    );
    return jsonError(
      {
        message: "Invalid SMS request",
        appointment_id: appointmentId,
        client_id: requestedClientId,
        message_type: rawMessageType,
      },
      400,
      { step: "request_validation" },
    );
  }

  const messageType = rawMessageType as AppointmentSmsMessageType;

  const {
    data: appointmentData,
    error: appointmentError,
  } = await serviceClient
    .from("appointments")
    .select(
      "id, user_id, client_id, client_name, appointment_date, appointment_time, sms_confirmation_sent_at, sms_reminder_sent_at",
    )
    .eq("id", appointmentId)
    .eq("user_id", user.id)
    .maybeSingle();
  const appointment = (appointmentData || null) as AppointmentRecord | null;

  if (appointmentError) {
    console.error("appointment lookup failure", {
      error: appointmentError,
      userId: user.id,
      appointmentId,
    });
    await tryInsertSmsLog(
      serviceClient,
      buildSmsLogPayload({
        userId: user.id,
        appointmentId,
        clientId: requestedClientId,
        messageType,
        status: "failed",
        fromNumber: telnyxFromNumber || null,
        providerResponse: appointmentError,
        errorMessage: getErrorMessage(appointmentError),
      }),
      "appointment_lookup",
    );
    return jsonError(appointmentError, 500, {
      step: "appointment_lookup",
      code: "appointment_lookup_failed",
      message: SMS_SEND_FRIENDLY_ERROR,
    });
  }

  if (!appointment) {
    console.error("appointment lookup failure", {
      reason: "not_found",
      userId: user.id,
      appointmentId,
    });
    await tryInsertSmsLog(
      serviceClient,
      buildSmsLogPayload({
        userId: user.id,
        appointmentId,
        clientId: requestedClientId,
        messageType,
        status: "failed",
        fromNumber: telnyxFromNumber || null,
        errorMessage: "Appointment not found",
      }),
      "appointment_lookup",
    );
    return jsonError(
      { message: "Appointment not found", appointment_id: appointmentId },
      404,
      {
        step: "appointment_lookup",
        code: "missing_appointment",
      },
    );
  }

  const { data: smsSettingsData, error: smsSettingsError } = await serviceClient
    .from("sms_settings")
    .select(
      "enabled, appointment_confirmations_enabled, appointment_updates_enabled, appointment_cancellations_enabled, appointment_reminders_enabled",
    )
    .eq("user_id", user.id)
    .maybeSingle();
  const smsSettings = (smsSettingsData || null) as SmsSettingsRecord | null;

  if (smsSettingsError) {
    await tryInsertSmsLog(
      serviceClient,
      buildSmsLogPayload({
        userId: user.id,
        appointmentId: appointment.id,
        clientId: appointment.client_id,
        messageType,
        status: "failed",
        fromNumber: telnyxFromNumber || null,
        providerResponse: smsSettingsError,
        errorMessage: getErrorMessage(smsSettingsError),
      }),
      "sms_settings",
    );
    return jsonError(smsSettingsError, 500, {
      step: "sms_settings",
      code: "sms_settings_lookup_failed",
      message: SMS_SEND_FRIENDLY_ERROR,
    });
  }

  if (
    !smsSettings?.enabled ||
    !smsSettings?.[messageEnabledKey(messageType)]
  ) {
    await tryInsertSmsLog(
      serviceClient,
      buildSmsLogPayload({
        userId: user.id,
        appointmentId: appointment.id,
        clientId: appointment.client_id,
        messageType,
        status: "skipped",
        fromNumber: telnyxFromNumber || null,
        errorMessage: "SMS settings disabled for this message type",
      }),
      "sms_settings",
    );
    return jsonResponse({
      ok: true,
      skipped: true,
      step: "sms_settings",
      code: "sms_disabled",
    });
  }

  if (shouldSkipDuplicateAppointmentSms(messageType)) {
    const sentAtColumn = appointmentSentAtColumn(messageType);
    const alreadyStamped = sentAtColumn
      ? asTrimmedString(
          appointment[sentAtColumn as keyof AppointmentRecord],
        ).length > 0
      : false;

    if (alreadyStamped) {
      return jsonResponse({
        ok: true,
        skipped: true,
        step: "idempotency",
        code: DUPLICATE_CONFIRMATION_SKIP_CODE,
      });
    }

    const alreadyRecorded = await hasExistingAppointmentSmsRecord(
      serviceClient,
      user.id,
      appointment.id,
      messageType,
    );

    if (alreadyRecorded) {
      return jsonResponse({
        ok: true,
        skipped: true,
        step: "idempotency",
        code: DUPLICATE_CONFIRMATION_SKIP_CODE,
      });
    }
  }

  const { data: userSettingsData, error: userSettingsError } = await serviceClient
    .from("user_settings")
    .select("country_region")
    .eq("user_id", user.id)
    .maybeSingle();
  const userSettings = (userSettingsData || null) as UserSettingsRecord | null;

  if (userSettingsError) {
    console.error("user settings lookup failure", {
      error: userSettingsError,
      userId: user.id,
    });
  }

  const countryRegion = isCountryRegionCode(userSettings?.country_region)
    ? userSettings.country_region
    : DEFAULT_COUNTRY_REGION;

  if (!appointment.client_id) {
    await tryInsertSmsLog(
      serviceClient,
      buildSmsLogPayload({
        userId: user.id,
        appointmentId: appointment.id,
        messageType,
        status: "skipped",
        fromNumber: telnyxFromNumber || null,
        errorMessage: "Appointment missing client_id",
      }),
      "appointment_client",
    );
    return jsonResponse({
      ok: true,
      skipped: true,
      step: "appointment_client",
      code: "missing_client",
    });
  }

  const { data: clientData, error: clientError } = await serviceClient
    .from("clients")
    .select("id, name, phone, sms_opt_in")
    .eq("id", appointment.client_id)
    .eq("user_id", user.id)
    .maybeSingle();
  const client = (clientData || null) as ClientRecord | null;

  if (clientError) {
    console.error("client lookup failure", {
      error: clientError,
      userId: user.id,
      appointmentId: appointment.id,
      clientId: appointment.client_id,
    });
    await tryInsertSmsLog(
      serviceClient,
      buildSmsLogPayload({
        userId: user.id,
        appointmentId: appointment.id,
        clientId: appointment.client_id,
        messageType,
        status: "failed",
        fromNumber: telnyxFromNumber || null,
        providerResponse: clientError,
        errorMessage: getErrorMessage(clientError),
      }),
      "client_lookup",
    );
    return jsonError(clientError, 500, {
      step: "client_lookup",
      code: "client_lookup_failed",
      message: SMS_SEND_FRIENDLY_ERROR,
    });
  }

  if (!client) {
    console.error("client lookup failure", {
      reason: "not_found",
      userId: user.id,
      appointmentId: appointment.id,
      clientId: appointment.client_id,
    });
    await tryInsertSmsLog(
      serviceClient,
      buildSmsLogPayload({
        userId: user.id,
        appointmentId: appointment.id,
        clientId: appointment.client_id,
        messageType,
        status: "skipped",
        fromNumber: telnyxFromNumber || null,
        errorMessage: "Client not found",
      }),
      "client_lookup",
    );
    return jsonResponse({
      ok: true,
      skipped: true,
      step: "client_lookup",
      code: "missing_client",
    });
  }

  const { data: smsRecipientRows, error: smsRecipientError } = await serviceClient
    .from("appointment_message_recipients")
    .select("contact_name, phone, send_sms")
    .eq("appointment_id", appointment.id)
    .eq("user_id", user.id)
    .eq("send_sms", true);

  if (smsRecipientError) {
    console.error("sms recipient lookup failure", {
      error: smsRecipientError,
      userId: user.id,
      appointmentId: appointment.id,
    });
  }

  const smsRecipients = ((smsRecipientRows || []) as JsonObject[])
    .map((recipient) => ({
      name: asTrimmedString(recipient.contact_name),
      toPhone: normalizePhoneForSms(asTrimmedString(recipient.phone), countryRegion),
    }))
    .filter((recipient) => recipient.toPhone);
  const hasSavedSmsRecipients = smsRecipients.length > 0;
  const fallbackPhone = normalizePhoneForSms(client.phone, countryRegion);

  if (smsRecipients.length === 0) {
    if (fallbackPhone && client.sms_opt_in) {
      smsRecipients.push({
        name: asTrimmedString(client.name || appointment.client_name),
        toPhone: fallbackPhone,
      });
    }
  }

  const toPhone = smsRecipients[0]?.toPhone || "";

  if (!hasSavedSmsRecipients && fallbackPhone && !client.sms_opt_in) {
    console.error("sms_opt_in skipped", {
      userId: user.id,
      appointmentId: appointment.id,
      clientId: client.id,
      toPhone: fallbackPhone,
    });
    await tryInsertSmsLog(
      serviceClient,
      buildSmsLogPayload({
        userId: user.id,
        appointmentId: appointment.id,
        clientId: client.id,
        messageType,
        toPhone: fallbackPhone,
        status: "skipped",
        fromNumber: telnyxFromNumber || null,
        errorMessage: "Client has not opted in to SMS",
      }),
      "sms_opt_in",
    );
    return jsonResponse({
      ok: true,
      skipped: true,
      step: "sms_opt_in",
      code: "client_not_opted_in",
    });
  }

  if (!toPhone) {
    await tryInsertSmsLog(
      serviceClient,
      buildSmsLogPayload({
        userId: user.id,
        appointmentId: appointment.id,
        clientId: client.id,
        messageType,
        status: "skipped",
        fromNumber: telnyxFromNumber || null,
        errorMessage: "Client phone missing or invalid",
      }),
      "phone_normalization",
    );
    return jsonResponse({
      ok: true,
      skipped: true,
      step: "phone_normalization",
      code: "missing_phone",
    });
  }

  const { businessName } = await getBusinessName(serviceClient, user.id);
  const senderName = getMessageSenderDisplayName({
    businessName,
    user,
  });

  const smsBody = buildSmsBody({
    clientName: asTrimmedString(client.name || appointment.client_name) || "there",
    appointmentDate: asTrimmedString(appointment.appointment_date),
    appointmentTime: asTrimmedString(appointment.appointment_time),
    messageType,
    senderName,
  });

  const logPayloadFor = ({
    status,
    providerMessageId = null,
    providerResponse = null,
    errorMessage = null,
  }: {
    status: string;
    providerMessageId?: string | null;
    providerResponse?: unknown;
    errorMessage?: string | null;
  }) =>
    buildSmsLogPayload({
      userId: user.id,
      appointmentId: appointment.id,
      clientId: client.id,
      messageType,
      toPhone,
      smsBody,
      status,
      fromNumber: telnyxFromNumber || null,
      providerMessageId,
      providerResponse,
      errorMessage,
    });

  const missingProviderEnv = missingKeys([
    ["TELNYX_API_KEY", telnyxApiKey],
    ["TELNYX_FROM_NUMBER", telnyxFromNumber],
    ["TELNYX_MESSAGING_PROFILE_ID", telnyxMessagingProfileId],
  ]);

  if (missingProviderEnv.length > 0) {
    console.error("missing env vars", {
      step: "provider_env",
      missing: missingProviderEnv,
      userId: user.id,
      appointmentId: appointment.id,
      clientId: client.id,
    });
    await tryInsertSmsLog(
      serviceClient,
      logPayloadFor({
        status: "failed",
        errorMessage: "Telnyx env missing",
      }),
      "provider_env",
    );
    return jsonError(
      { message: "Telnyx env missing", missing: missingProviderEnv },
      500,
      {
        step: "provider_env",
        code: "sms_provider_not_configured",
        message: SMS_SEND_FRIENDLY_ERROR,
      },
    );
  }

  if (smsRecipients.length > 1) {
    const sentResults: JsonObject[] = [];
    const failedResults: JsonObject[] = [];

    for (const recipient of smsRecipients) {
      const recipientPhone = recipient.toPhone;
      const payloadForRecipient = (input: {
        status: string;
        providerMessageId?: string | null;
        providerResponse?: unknown;
        errorMessage?: string | null;
      }) =>
        buildSmsLogPayload({
          userId: user.id,
          appointmentId: appointment.id,
          clientId: client.id,
          messageType,
          toPhone: recipientPhone,
          smsBody,
          status: input.status,
          fromNumber: telnyxFromNumber || null,
          providerMessageId: input.providerMessageId || null,
          providerResponse: input.providerResponse || null,
          errorMessage: input.errorMessage || null,
        });

      const reservation = await reserveMessageCredit(serviceClient, {
        userId: user.id,
        appointmentId: appointment.id,
        clientId: client.id,
        messageType,
        reason: "sms_send",
        metadata: {
          function: "send-appointment-sms",
          appointmentId: appointment.id,
          clientId: client.id,
          messageType,
          recipientPhone,
        },
      });

      if (reservation.error || !reservation.data.ok || !reservation.data.reserved) {
        failedResults.push({
          toPhone: recipientPhone,
          code: reservation.error ? "reservation_error" : "insufficient_credits",
        });
        await tryInsertSmsLog(
          serviceClient,
          payloadForRecipient({
            status: "failed",
            errorMessage: reservation.error
              ? "Message credit reservation failed"
              : "Insufficient message credits",
          }),
          "message_credit_reservation",
        );
        continue;
      }

      const reservationId = asTrimmedString(reservation.data.eventId);
      const queuedLogId = await tryInsertSmsLog(
        serviceClient,
        payloadForRecipient({ status: "queued" }),
        "sms_message_logs_insert",
      );

      if (!queuedLogId) {
        if (reservationId) {
          await refundMessageCreditReservation(serviceClient, {
            eventId: reservationId,
            refundReason: "sms_log_insert_failed",
          });
        }
        failedResults.push({ toPhone: recipientPhone, code: "sms_log_insert_failed" });
        continue;
      }

      const telnyxRequestBody = {
        from: telnyxFromNumber,
        to: recipientPhone,
        text: smsBody,
        messaging_profile_id: telnyxMessagingProfileId,
      };

      try {
        const telnyxResponse = await fetch(TELNYX_MESSAGES_URL, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${telnyxApiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(telnyxRequestBody),
        });
        const telnyxResponseText = await telnyxResponse.text();
        const telnyxResponseBody =
          safeParseJson(telnyxResponseText) || { raw: telnyxResponseText };
        const providerMessageId =
          extractTelnyxProviderMessageId(telnyxResponseBody);

        if (!telnyxResponse.ok) {
          const telnyxErrorMessage = extractTelnyxErrorMessage(
            telnyxResponseBody,
            telnyxResponse.status,
          );
          await tryUpdateSmsLog(
            serviceClient,
            queuedLogId,
            payloadForRecipient({
              status: "failed",
              providerMessageId,
              providerResponse: telnyxResponseBody,
              errorMessage: telnyxErrorMessage,
            }),
            "telnyx_send_failed",
          );
          if (reservationId) {
            await refundMessageCreditReservation(serviceClient, {
              eventId: reservationId,
              refundReason: "telnyx_send_failed",
              smsMessageLogId: queuedLogId,
            });
          }
          failedResults.push({ toPhone: recipientPhone, code: "sms_provider_failed" });
          continue;
        }

        const providerStatus = extractTelnyxMessageStatus(telnyxResponseBody);
        let messageCreditWarning: string | null = null;

        if (reservationId) {
          const confirmationResult = await confirmMessageCreditReservation(
            serviceClient,
            {
              eventId: reservationId,
              smsMessageLogId: queuedLogId,
            },
          );

          if (
            confirmationResult.error ||
            (!confirmationResult.data.ok &&
              confirmationResult.data.reason !== "already_confirmed")
          ) {
            messageCreditWarning =
              "SMS sent, but message credit confirmation needs review.";
          }
        }

        await tryUpdateSmsLog(
          serviceClient,
          queuedLogId,
          payloadForRecipient({
            status: providerStatus,
            providerMessageId,
            providerResponse: telnyxResponseBody,
            errorMessage: messageCreditWarning,
          }),
          "telnyx_send_success",
        );
        sentResults.push({
          toPhone: recipientPhone,
          providerMessageId,
          providerStatus,
        });
      } catch (error) {
        await tryUpdateSmsLog(
          serviceClient,
          queuedLogId,
          payloadForRecipient({
            status: "failed",
            providerResponse: serializeDetails(error),
            errorMessage: getErrorMessage(error),
          }),
          "telnyx_send_exception",
        );
        if (reservationId) {
          await refundMessageCreditReservation(serviceClient, {
            eventId: reservationId,
            refundReason: "telnyx_send_exception",
            smsMessageLogId: queuedLogId,
          });
        }
        failedResults.push({ toPhone: recipientPhone, code: "sms_provider_failed" });
      }
    }

    const sentAtColumn = appointmentSentAtColumn(messageType);
    if (sentResults.length > 0 && sentAtColumn) {
      await serviceClient
        .from("appointments")
        .update({ [sentAtColumn]: new Date().toISOString() })
        .eq("id", appointment.id)
        .eq("user_id", user.id);
    }

    return jsonResponse({
      ok: sentResults.length > 0,
      step: "telnyx_send",
      sent: sentResults.length,
      failed: failedResults,
      results: sentResults,
    }, sentResults.length > 0 ? 200 : 402);
  }

  const queuedLogPayload = logPayloadFor({ status: "queued" });
  const reservationResult = await reserveMessageCredit(serviceClient, {
    userId: user.id,
    appointmentId: appointment.id,
    clientId: client.id,
    messageType,
    reason: "sms_send",
    metadata: {
      function: "send-appointment-sms",
      appointmentId: appointment.id,
      clientId: client.id,
      messageType,
    },
  });

  if (reservationResult.error) {
    console.error("message credit reservation failed", {
      userId: user.id,
      appointmentId: appointment.id,
      clientId: client.id,
      messageType,
      error: reservationResult.error,
    });
    await tryInsertSmsLog(
      serviceClient,
      logPayloadFor({
        status: "failed",
        errorMessage: "Message credit reservation failed",
      }),
      "message_credit_reservation",
    );
    return jsonError(
      {
        message: "Message credit reservation failed",
        details: reservationResult.error,
      },
      500,
      {
        step: "message_credit_reservation",
        code: "message_credit_reservation_failed",
        message: SMS_SEND_FRIENDLY_ERROR,
      },
    );
  }

  if (!reservationResult.data.ok || !reservationResult.data.reserved) {
    const noCreditsMessage = "Insufficient message credits";
    await tryInsertSmsLog(
      serviceClient,
      logPayloadFor({
        status: "failed",
        errorMessage: noCreditsMessage,
      }),
      "message_credit_reservation",
    );
    return jsonResponse(
      {
        ok: false,
        step: "message_credit_reservation",
        code: "insufficient_credits",
        error: noCreditsMessage,
        balance: Number(reservationResult.data.balance) || 0,
      },
      402,
    );
  }

  const messageCreditReservationId = asTrimmedString(
    reservationResult.data.eventId,
  );
  const queuedLogId = await tryInsertSmsLog(
    serviceClient,
    queuedLogPayload,
    "sms_message_logs_insert",
  );

  if (!queuedLogId) {
    if (messageCreditReservationId) {
      await refundMessageCreditReservation(serviceClient, {
        eventId: messageCreditReservationId,
        refundReason: "sms_log_insert_failed",
      });
    }
    return jsonError(
      {
        message: "SMS log insert failed",
        payload: queuedLogPayload,
      },
      500,
      {
        step: "sms_message_logs_insert",
        code: "sms_log_insert_failed",
        message: SMS_SEND_FRIENDLY_ERROR,
      },
    );
  }

  const telnyxRequestBody = {
    from: telnyxFromNumber,
    to: toPhone,
    text: smsBody,
    messaging_profile_id: telnyxMessagingProfileId,
  };

  try {
    const telnyxResponse = await fetch(TELNYX_MESSAGES_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${telnyxApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(telnyxRequestBody),
    });

    const telnyxResponseText = await telnyxResponse.text();
    const telnyxResponseBody =
      safeParseJson(telnyxResponseText) || { raw: telnyxResponseText };

    console.error("Telnyx response status/body", {
      status: telnyxResponse.status,
      body: telnyxResponseBody,
      appointmentId: appointment.id,
      clientId: client.id,
      userId: user.id,
    });

    if (!telnyxResponse.ok) {
      const telnyxErrorMessage = extractTelnyxErrorMessage(
        telnyxResponseBody,
        telnyxResponse.status,
      );
      const providerMessageId = extractTelnyxProviderMessageId(telnyxResponseBody);

      await tryUpdateSmsLog(
        serviceClient,
        queuedLogId,
        logPayloadFor({
          status: "failed",
          providerMessageId,
          providerResponse: telnyxResponseBody,
          errorMessage: telnyxErrorMessage,
        }),
        "telnyx_send_failed",
      );

      if (messageCreditReservationId) {
        await refundMessageCreditReservation(serviceClient, {
          eventId: messageCreditReservationId,
          refundReason: "telnyx_send_failed",
          smsMessageLogId: queuedLogId,
        });
      }

      return jsonError(
        {
          message: telnyxErrorMessage,
          status: telnyxResponse.status,
          provider_message_id: providerMessageId,
          provider_response: telnyxResponseBody,
          request_body: telnyxRequestBody,
        },
        502,
        {
          step: "telnyx_send",
          code: "sms_provider_failed",
          message: SMS_SEND_FRIENDLY_ERROR,
        },
      );
    }

    const providerMessageId = extractTelnyxProviderMessageId(telnyxResponseBody);
    const providerStatus = extractTelnyxMessageStatus(telnyxResponseBody);
    const sentAtColumn = appointmentSentAtColumn(messageType);
    let appointmentUpdateWarning: string | null = null;
    let messageCreditWarning: string | null = null;

    if (sentAtColumn) {
      const { error: appointmentUpdateError } = await serviceClient
        .from("appointments")
        .update({
          [sentAtColumn]: new Date().toISOString(),
        })
        .eq("id", appointment.id)
        .eq("user_id", user.id);

      if (appointmentUpdateError) {
        appointmentUpdateWarning =
          `SMS sent but ${sentAtColumn} could not be updated.`;
        console.error("appointment update error", {
          error: appointmentUpdateError,
          sentAtColumn,
          appointmentId: appointment.id,
          clientId: client.id,
          userId: user.id,
        });
      }
    }

    if (messageCreditReservationId) {
      const confirmationResult = await confirmMessageCreditReservation(
        serviceClient,
        {
          eventId: messageCreditReservationId,
          smsMessageLogId: queuedLogId,
        },
      );

      if (
        confirmationResult.error ||
        (!confirmationResult.data.ok &&
          confirmationResult.data.reason !== "already_confirmed")
      ) {
        messageCreditWarning =
          "SMS sent, but message credit confirmation needs review.";
        console.error("message credit confirmation failed", {
          userId: user.id,
          appointmentId: appointment.id,
          clientId: client.id,
          messageType,
          reservationId: messageCreditReservationId,
          error: confirmationResult.error,
          result: confirmationResult.data,
        });
      }
    }

    const combinedWarning = [appointmentUpdateWarning, messageCreditWarning]
      .filter(Boolean)
      .join(" ")
      .trim() || null;

    await tryUpdateSmsLog(
      serviceClient,
      queuedLogId,
      logPayloadFor({
        status: providerStatus,
        providerMessageId,
        providerResponse: telnyxResponseBody,
        errorMessage: combinedWarning,
      }),
      "telnyx_send_success",
    );

    return jsonResponse({
      ok: true,
      step: "telnyx_send",
      providerMessageId,
      providerStatus,
      warning: combinedWarning,
    });
  } catch (error) {
    const errorMessage = getErrorMessage(error);
    console.error("Telnyx request exception", {
      error: serializeDetails(error),
      appointmentId: appointment.id,
      clientId: client.id,
      userId: user.id,
    });

    await tryUpdateSmsLog(
      serviceClient,
      queuedLogId,
      logPayloadFor({
        status: "failed",
        providerResponse: serializeDetails(error),
        errorMessage,
      }),
      "telnyx_send_exception",
    );

    if (messageCreditReservationId) {
      await refundMessageCreditReservation(serviceClient, {
        eventId: messageCreditReservationId,
        refundReason: "telnyx_send_exception",
        smsMessageLogId: queuedLogId,
      });
    }

    return jsonError(
      { message: errorMessage, request_body: telnyxRequestBody, error },
      502,
      {
        step: "telnyx_send",
        code: "sms_provider_failed",
        message: SMS_SEND_FRIENDLY_ERROR,
      },
    );
  }
});
