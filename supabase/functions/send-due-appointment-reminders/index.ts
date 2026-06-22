import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

import {
  DEFAULT_COUNTRY_REGION,
  isCountryRegionCode,
  normalizePhoneForSms,
} from "../../../lib/phoneNumbers.ts";

type JsonObject = Record<string, unknown>;

type SmsSettingsRow = {
  user_id?: string | null;
  enabled?: boolean | null;
  appointment_reminders_enabled?: boolean | null;
  reminder_hours_before?: number | null;
};

type UserSubscription = {
  status?: string | null;
  plan?: string | null;
  entitlement?: string | null;
  entitlement_source?: string | null;
  entitlement_expires_at?: string | null;
};

type UserSettingsRow = {
  country_region?: string | null;
  timezone?: string | null;
};

type AppointmentRow = {
  id?: string | null;
  user_id?: string | null;
  client_id?: string | null;
  client_name?: string | null;
  appointment_date?: string | null;
  appointment_time?: string | null;
  status?: string | null;
};

type ClientRow = {
  id?: string | null;
  name?: string | null;
  phone?: string | null;
  sms_opt_in?: boolean | null;
};

const TELNYX_MESSAGES_URL = "https://api.telnyx.com/v2/messages";
const SMS_PROVIDER = "telnyx";
const SMS_DIRECTION = "outbound";
const MESSAGE_TYPE = "reminder";
const DEFAULT_TIMEZONE = "America/New_York";
const REMINDER_DUE_WINDOW_MINUTES = 20;
const VALID_REMINDER_HOURS = new Set([24, 48, 72, 168]);
const SKIPPED_APPOINTMENT_STATUSES = new Set([
  "canceled",
  "cancelled",
  "business_canceled",
  "business_cancelled",
  "customer_canceled",
  "customer_cancelled",
  "completed",
  "no_show",
]);

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-schedova-cron-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
    },
  });
}

function normalize(value: unknown) {
  return String(value || "")
    .trim()
    .toLowerCase();
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

function isOpenOrFuture(value: string | null | undefined) {
  if (!value) return true;

  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) && timestamp > Date.now();
}

function hasAdminLifetimeSchedovaProAccess(
  subscription: UserSubscription | null | undefined,
) {
  if (!subscription) return false;

  return (
    normalize(subscription.status) === "active" &&
    normalize(subscription.plan) === "lifetime" &&
    normalize(subscription.entitlement) === "schedova_pro" &&
    ["admin", "manual"].includes(normalize(subscription.entitlement_source)) &&
    !subscription.entitlement_expires_at
  );
}

function hasRevenueCatStyleSchedovaProAccess(
  subscription: UserSubscription | null | undefined,
) {
  if (!subscription) return false;

  return (
    normalize(subscription.status) === "active" &&
    normalize(subscription.entitlement) === "schedova_pro" &&
    isOpenOrFuture(subscription.entitlement_expires_at)
  );
}

function hasSchedovaProAccess(
  subscription: UserSubscription | null | undefined,
) {
  return (
    hasAdminLifetimeSchedovaProAccess(subscription) ||
    hasRevenueCatStyleSchedovaProAccess(subscription)
  );
}

function safeParseJson(text: string) {
  if (!text.trim()) return null;

  try {
    return JSON.parse(text) as JsonObject;
  } catch {
    return null;
  }
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

function getErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message || error.name || "Unknown error";

  if (error && typeof error === "object" && "message" in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string" && message.trim()) return message;
  }

  return String(error || "Unknown error");
}

function missingKeys(entries: Array<[string, string | undefined]>) {
  return entries.filter(([, value]) => !value).map(([name]) => name);
}

function normalizeReminderHours(value: unknown) {
  const hours = Number(value);
  return VALID_REMINDER_HOURS.has(hours) ? hours : 24;
}

function toDateOnly(date: Date) {
  return date.toISOString().slice(0, 10);
}

function getSafeTimezone(value: unknown) {
  const timezone = asTrimmedString(value) || DEFAULT_TIMEZONE;

  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format(new Date());
    return timezone;
  } catch {
    return DEFAULT_TIMEZONE;
  }
}

function getZonedDateTimeAsUtcMs(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(date);
  const values: Record<string, string> = {};

  for (const part of parts) {
    if (part.type !== "literal") values[part.type] = part.value;
  }

  const hour = values.hour === "24" ? 0 : Number(values.hour || 0);

  return Date.UTC(
    Number(values.year),
    Number(values.month) - 1,
    Number(values.day),
    hour,
    Number(values.minute || 0),
    Number(values.second || 0),
  );
}

function zonedTimeToUtc(dateText: string, timeText: string, timeZone: string) {
  const [year, month, day] = dateText.split("-").map(Number);
  const [hourText = "9", minuteText = "0"] = timeText.slice(0, 5).split(":");
  const hour = Number(hourText);
  const minute = Number(minuteText);

  if (
    !Number.isFinite(year) ||
    !Number.isFinite(month) ||
    !Number.isFinite(day) ||
    !Number.isFinite(hour) ||
    !Number.isFinite(minute)
  ) {
    return null;
  }

  const targetLocalAsUtc = Date.UTC(year, month - 1, day, hour, minute, 0);
  let utcMs = targetLocalAsUtc;

  for (let index = 0; index < 3; index += 1) {
    const zonedAsUtc = getZonedDateTimeAsUtcMs(new Date(utcMs), timeZone);
    const offset = zonedAsUtc - utcMs;
    utcMs = targetLocalAsUtc - offset;
  }

  return new Date(utcMs);
}

function formatAppointmentTime(value: string | null | undefined) {
  const time = asTrimmedString(value).slice(0, 5);
  return time || "your appointment time";
}

function buildSmsBody({
  clientName,
  appointmentDate,
  appointmentTime,
}: {
  clientName: string;
  appointmentDate: string;
  appointmentTime: string;
}) {
  const name = clientName || "there";
  const time = formatAppointmentTime(appointmentTime);

  return `Hi ${name}, this is a reminder for your appointment on ${appointmentDate} at ${time}. Reply here if you need to make a change.`;
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
    message_type: MESSAGE_TYPE,
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

async function insertSmsLog(
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

async function updateSmsLog(
  serviceClient: any,
  logId: string | null,
  payload: Record<string, unknown>,
  step: string,
) {
  if (!logId) return;

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

async function markDelivery(
  serviceClient: any,
  deliveryId: string,
  payload: Record<string, unknown>,
) {
  const { error } = await serviceClient
    .from("appointment_message_deliveries")
    .update({
      ...payload,
      updated_at: new Date().toISOString(),
    })
    .eq("id", deliveryId);

  if (error) {
    console.error("appointment delivery update failed", {
      deliveryId,
      error,
    });
  }
}

async function markAppointmentReminderAttempt(
  serviceClient: any,
  appointmentId: string,
  userId: string,
  errorMessage: string | null,
) {
  const { error } = await serviceClient
    .from("appointments")
    .update({
      reminder_last_attempt_at: new Date().toISOString(),
      reminder_last_error: errorMessage,
    })
    .eq("id", appointmentId)
    .eq("user_id", userId);

  if (error) {
    console.error("appointment reminder attempt update failed", {
      appointmentId,
      userId,
      error,
    });
  }
}

async function markAppointmentReminderSent(
  serviceClient: any,
  appointmentId: string,
  userId: string,
) {
  const now = new Date().toISOString();
  const { error } = await serviceClient
    .from("appointments")
    .update({
      sms_reminder_sent_at: now,
      reminder_sent_at: now,
      reminder_last_attempt_at: now,
      reminder_last_error: null,
    })
    .eq("id", appointmentId)
    .eq("user_id", userId);

  if (error) {
    console.error("appointment reminder sent update failed", {
      appointmentId,
      userId,
      error,
    });
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return jsonResponse({ ok: false, error: "Method not allowed" }, 405);
  }

  console.log("send-due-appointment-reminders invoked");

  const cronSecret = Deno.env.get("REMINDER_CRON_SECRET");
  const cronSecretHeader = req.headers.get("x-schedova-cron-secret") || "";

  if (!cronSecret || cronSecretHeader !== cronSecret) {
    console.error("reminder cron auth failure", {
      hasSecret: Boolean(cronSecret),
      hasHeader: Boolean(cronSecretHeader),
    });
    return jsonResponse({ ok: false, error: "Unauthorized" }, 401);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const telnyxApiKey = Deno.env.get("TELNYX_API_KEY");
  const telnyxFromNumber = Deno.env.get("TELNYX_FROM_NUMBER");
  const telnyxMessagingProfileId = Deno.env.get("TELNYX_MESSAGING_PROFILE_ID");

  const missingEnv = missingKeys([
    ["SUPABASE_URL", supabaseUrl],
    ["SUPABASE_SERVICE_ROLE_KEY", serviceRoleKey],
    ["TELNYX_API_KEY", telnyxApiKey],
    ["TELNYX_FROM_NUMBER", telnyxFromNumber],
    ["TELNYX_MESSAGING_PROFILE_ID", telnyxMessagingProfileId],
  ]);

  if (missingEnv.length > 0) {
    console.error("missing env vars", {
      step: "worker_env",
      missing: missingEnv,
    });
    return jsonResponse(
      { ok: false, step: "worker_env", error: "Missing env vars", missing: missingEnv },
      500,
    );
  }

  const serviceClient = createClient(supabaseUrl!, serviceRoleKey!);
  const now = new Date();
  const dueWindowStart = new Date(
    now.getTime() - REMINDER_DUE_WINDOW_MINUTES * 60 * 1000,
  );

  const { data: smsSettingsRows, error: smsSettingsError } = await serviceClient
    .from("sms_settings")
    .select("user_id, enabled, appointment_reminders_enabled, reminder_hours_before")
    .eq("enabled", true)
    .eq("appointment_reminders_enabled", true);

  if (smsSettingsError) {
    console.error("sms settings lookup failed", smsSettingsError);
    return jsonResponse(
      { ok: false, step: "sms_settings", error: getErrorMessage(smsSettingsError) },
      500,
    );
  }

  let checked = 0;
  let sent = 0;
  let skipped = 0;
  let failed = 0;

  for (const smsSettings of (smsSettingsRows || []) as SmsSettingsRow[]) {
    const userId = asTrimmedString(smsSettings.user_id);
    if (!userId) continue;

    const reminderHours = normalizeReminderHours(
      smsSettings.reminder_hours_before,
    );

    const { data: subscriptionRows, error: subscriptionError } =
      await serviceClient
        .from("user_subscriptions")
        .select(
          "status, plan, entitlement, entitlement_source, entitlement_expires_at",
        )
        .eq("user_id", userId);

    if (subscriptionError) {
      console.error("subscription lookup failed for reminder worker", {
        userId,
        error: subscriptionError,
      });
      failed += 1;
      continue;
    }

    const isPaid = ((subscriptionRows || []) as UserSubscription[]).some(
      hasSchedovaProAccess,
    );

    if (!isPaid) {
      console.log("reminder worker skipped non-Pro user", { userId });
      skipped += 1;
      continue;
    }

    const { data: userSettingsData, error: userSettingsError } =
      await serviceClient
        .from("user_settings")
        .select("country_region, timezone")
        .eq("user_id", userId)
        .maybeSingle();

    if (userSettingsError) {
      console.error("user settings lookup failed for reminder worker", {
        userId,
        error: userSettingsError,
      });
    }

    const userSettings = (userSettingsData || null) as UserSettingsRow | null;
    const timezone = getSafeTimezone(userSettings?.timezone);
    const countryRegion = isCountryRegionCode(userSettings?.country_region)
      ? userSettings.country_region
      : DEFAULT_COUNTRY_REGION;
    const queryStartDate = toDateOnly(
      new Date(now.getTime() - 48 * 60 * 60 * 1000),
    );
    const queryEndDate = toDateOnly(
      new Date(now.getTime() + (reminderHours + 48) * 60 * 60 * 1000),
    );

    const { data: appointmentRows, error: appointmentError } =
      await serviceClient
        .from("appointments")
        .select(
          "id, user_id, client_id, client_name, appointment_date, appointment_time, status",
        )
        .eq("user_id", userId)
        .is("sms_reminder_sent_at", null)
        .is("reminder_sent_at", null)
        .gte("appointment_date", queryStartDate)
        .lte("appointment_date", queryEndDate)
        .order("appointment_date", { ascending: true })
        .order("appointment_time", { ascending: true });

    if (appointmentError) {
      console.error("appointment lookup failed for reminder worker", {
        userId,
        error: appointmentError,
      });
      failed += 1;
      continue;
    }

    for (const appointment of (appointmentRows || []) as AppointmentRow[]) {
      const appointmentId = asTrimmedString(appointment.id);
      const appointmentUserId = asTrimmedString(appointment.user_id);
      const clientId = asTrimmedString(appointment.client_id);
      const appointmentDate = asTrimmedString(appointment.appointment_date);
      const appointmentTime =
        asTrimmedString(appointment.appointment_time).slice(0, 5) || "09:00";
      const status = normalize(appointment.status || "scheduled");

      if (
        !appointmentId ||
        appointmentUserId !== userId ||
        !clientId ||
        !appointmentDate ||
        SKIPPED_APPOINTMENT_STATUSES.has(status)
      ) {
        skipped += 1;
        continue;
      }

      const appointmentStart = zonedTimeToUtc(
        appointmentDate,
        appointmentTime,
        timezone,
      );

      if (!appointmentStart || appointmentStart.getTime() <= now.getTime()) {
        skipped += 1;
        continue;
      }

      const scheduledFor = new Date(
        appointmentStart.getTime() - reminderHours * 60 * 60 * 1000,
      );

      if (
        scheduledFor.getTime() > now.getTime() ||
        scheduledFor.getTime() < dueWindowStart.getTime()
      ) {
        continue;
      }

      checked += 1;

      const { data: deliveryRow, error: deliveryError } = await serviceClient
        .from("appointment_message_deliveries")
        .insert({
          appointment_id: appointmentId,
          user_id: userId,
          client_id: clientId,
          message_type: MESSAGE_TYPE,
          scheduled_for: scheduledFor.toISOString(),
          status: "processing",
          updated_at: new Date().toISOString(),
        })
        .select("id")
        .maybeSingle();

      if (deliveryError) {
        if (deliveryError.code === "23505") {
          console.log("reminder delivery already claimed", {
            appointmentId,
            userId,
            scheduledFor: scheduledFor.toISOString(),
          });
          skipped += 1;
          continue;
        }

        console.error("reminder delivery insert failed", {
          appointmentId,
          userId,
          error: deliveryError,
        });
        failed += 1;
        continue;
      }

      const deliveryId = String(deliveryRow?.id || "");
      await markAppointmentReminderAttempt(
        serviceClient,
        appointmentId,
        userId,
        null,
      );

      const { data: clientData, error: clientError } = await serviceClient
        .from("clients")
        .select("id, name, phone, sms_opt_in")
        .eq("id", clientId)
        .eq("user_id", userId)
        .maybeSingle();

      if (clientError || !clientData) {
        const errorMessage = clientError
          ? getErrorMessage(clientError)
          : "Client not found";
        await insertSmsLog(
          serviceClient,
          buildSmsLogPayload({
            userId,
            appointmentId,
            clientId,
            status: "skipped",
            fromNumber: telnyxFromNumber || null,
            errorMessage,
          }),
          "client_lookup",
        );
        await markDelivery(serviceClient, deliveryId, {
          status: "failed",
          error: errorMessage,
        });
        await markAppointmentReminderAttempt(
          serviceClient,
          appointmentId,
          userId,
          errorMessage,
        );
        failed += 1;
        continue;
      }

      const client = clientData as ClientRow;
      const toPhone = normalizePhoneForSms(client.phone, countryRegion);

      if (!toPhone) {
        const errorMessage = "Client phone missing or invalid";
        await insertSmsLog(
          serviceClient,
          buildSmsLogPayload({
            userId,
            appointmentId,
            clientId,
            status: "skipped",
            fromNumber: telnyxFromNumber || null,
            errorMessage,
          }),
          "phone_normalization",
        );
        await markDelivery(serviceClient, deliveryId, {
          status: "failed",
          error: errorMessage,
        });
        await markAppointmentReminderAttempt(
          serviceClient,
          appointmentId,
          userId,
          errorMessage,
        );
        failed += 1;
        continue;
      }

      if (!client.sms_opt_in) {
        const errorMessage = "Client has not opted in to SMS";
        await insertSmsLog(
          serviceClient,
          buildSmsLogPayload({
            userId,
            appointmentId,
            clientId,
            toPhone,
            status: "skipped",
            fromNumber: telnyxFromNumber || null,
            errorMessage,
          }),
          "sms_opt_in",
        );
        await markDelivery(serviceClient, deliveryId, {
          status: "failed",
          error: errorMessage,
        });
        await markAppointmentReminderAttempt(
          serviceClient,
          appointmentId,
          userId,
          errorMessage,
        );
        skipped += 1;
        continue;
      }

      const smsBody = buildSmsBody({
        clientName:
          asTrimmedString(client.name) ||
          asTrimmedString(appointment.client_name) ||
          "there",
        appointmentDate,
        appointmentTime,
      });
      const queuedLogId = await insertSmsLog(
        serviceClient,
        buildSmsLogPayload({
          userId,
          appointmentId,
          clientId,
          toPhone,
          smsBody,
          status: "queued",
          fromNumber: telnyxFromNumber || null,
        }),
        "sms_message_logs_insert",
      );

      try {
        const telnyxRequestBody = {
          from: telnyxFromNumber,
          to: toPhone,
          text: smsBody,
          messaging_profile_id: telnyxMessagingProfileId,
        };
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

        console.error("Telnyx reminder response status/body", {
          status: telnyxResponse.status,
          body: telnyxResponseBody,
          appointmentId,
          clientId,
          userId,
        });

        if (!telnyxResponse.ok) {
          const errorMessage = extractTelnyxErrorMessage(
            telnyxResponseBody,
            telnyxResponse.status,
          );
          const providerMessageId =
            extractTelnyxProviderMessageId(telnyxResponseBody);

          await updateSmsLog(
            serviceClient,
            queuedLogId,
            buildSmsLogPayload({
              userId,
              appointmentId,
              clientId,
              toPhone,
              smsBody,
              status: "failed",
              fromNumber: telnyxFromNumber || null,
              providerMessageId,
              providerResponse: telnyxResponseBody,
              errorMessage,
            }),
            "telnyx_send_failed",
          );
          await markDelivery(serviceClient, deliveryId, {
            status: "failed",
            provider_message_id: providerMessageId,
            error: errorMessage,
          });
          await markAppointmentReminderAttempt(
            serviceClient,
            appointmentId,
            userId,
            errorMessage,
          );
          failed += 1;
          continue;
        }

        const providerMessageId =
          extractTelnyxProviderMessageId(telnyxResponseBody);
        const providerStatus = extractTelnyxMessageStatus(telnyxResponseBody);

        await updateSmsLog(
          serviceClient,
          queuedLogId,
          buildSmsLogPayload({
            userId,
            appointmentId,
            clientId,
            toPhone,
            smsBody,
            status: providerStatus,
            fromNumber: telnyxFromNumber || null,
            providerMessageId,
            providerResponse: telnyxResponseBody,
          }),
          "telnyx_send_success",
        );
        await markAppointmentReminderSent(serviceClient, appointmentId, userId);
        await markDelivery(serviceClient, deliveryId, {
          status: "sent",
          sent_at: new Date().toISOString(),
          provider_message_id: providerMessageId,
          error: null,
        });
        sent += 1;
      } catch (error) {
        const errorMessage = getErrorMessage(error);
        console.error("Telnyx reminder request exception", {
          appointmentId,
          clientId,
          userId,
          error: serializeDetails(error),
        });
        await updateSmsLog(
          serviceClient,
          queuedLogId,
          buildSmsLogPayload({
            userId,
            appointmentId,
            clientId,
            toPhone,
            smsBody,
            status: "failed",
            fromNumber: telnyxFromNumber || null,
            providerResponse: serializeDetails(error),
            errorMessage,
          }),
          "telnyx_send_exception",
        );
        await markDelivery(serviceClient, deliveryId, {
          status: "failed",
          error: errorMessage,
        });
        await markAppointmentReminderAttempt(
          serviceClient,
          appointmentId,
          userId,
          errorMessage,
        );
        failed += 1;
      }
    }
  }

  return jsonResponse({
    ok: true,
    checked,
    sent,
    skipped,
    failed,
  });
});
