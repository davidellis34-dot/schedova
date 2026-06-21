import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  DEFAULT_COUNTRY_REGION,
  isCountryRegionCode,
  normalizePhoneForSms,
} from "../../../lib/phoneNumbers.ts";

type AppointmentSmsMessageType =
  | "confirmation"
  | "update"
  | "cancellation"
  | "reminder";

type UserSubscription = {
  status?: string | null;
  plan?: string | null;
  current_period_end?: string | null;
  entitlement?: string | null;
  entitlement_expires_at?: string | null;
};

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const SMS_SEND_FRIENDLY_ERROR =
  "SMS reminder could not be sent. Please check settings and try again.";
const MESSAGE_CREDITS_EMPTY_MESSAGE =
  "You've used your included messages. Buy a message pack to keep sending reminders and client updates.";

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

function isOpenOrFuture(value: string | null | undefined) {
  if (!value) return true;

  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) && timestamp > Date.now();
}

function hasActiveProSubscription(subscription: UserSubscription) {
  const statusActive = normalize(subscription.status) === "active";
  const entitlement = normalize(subscription.entitlement);
  const entitlementPro = statusActive &&
    ["pro", "schedova_pro", "monthly", "yearly", "lifetime"].includes(
      entitlement,
    ) &&
    isOpenOrFuture(subscription.entitlement_expires_at);

  const paidPlanActive = statusActive &&
    ["pro", "paid", "monthly", "yearly", "lifetime"].includes(
      normalize(subscription.plan),
    ) &&
    isOpenOrFuture(subscription.current_period_end);

  return entitlementPro || paidPlanActive;
}

async function getMessageCreditsRemaining(
  serviceClient: any,
  userId: string,
) {
  const { data, error } = await serviceClient
    .from("user_message_credits")
    .select("credits_remaining")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    console.error("SMS message credit lookup failed", error);
    throw error;
  }

  return Number((data as any)?.credits_remaining || 0);
}

async function consumeMessageCredit({
  serviceClient,
  userId,
  appointmentId,
  smsMessageLogId,
  providerMessageId,
  messageType,
}: {
  serviceClient: any;
  userId: string;
  appointmentId: string;
  smsMessageLogId: string | null;
  providerMessageId: string;
  messageType: AppointmentSmsMessageType;
}) {
  const { data, error } = await serviceClient.rpc(
    "consume_message_credit_for_sms",
    {
      p_user_id: userId,
      p_appointment_id: appointmentId,
      p_sms_message_log_id: smsMessageLogId,
      p_provider_message_id: providerMessageId,
      p_metadata: { message_type: messageType },
    },
  );

  if (error) {
    console.error("SMS message credit deduction failed", {
      userId,
      appointmentId,
      providerMessageId,
      error,
    });
    throw error;
  }

  const result = Array.isArray(data) ? data[0] : data;

  return Number((result as any)?.credits_remaining || 0);
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

function formatAppointmentTime(value: string | null | undefined) {
  const time = String(value || "").slice(0, 5);
  return time || "your appointment time";
}

function buildMessage({
  clientName,
  appointmentDate,
  appointmentTime,
  messageType,
}: {
  clientName: string;
  appointmentDate: string;
  appointmentTime: string;
  messageType: AppointmentSmsMessageType;
}) {
  const name = clientName || "there";
  const time = formatAppointmentTime(appointmentTime);

  switch (messageType) {
    case "confirmation":
      return `Hi ${name}, confirming your appointment on ${appointmentDate} at ${time}. Reply here if you need to make a change.`;
    case "update":
      return `Hi ${name}, your appointment has been updated to ${appointmentDate} at ${time}. Reply here if you need help.`;
    case "cancellation":
      return `Hi ${name}, your appointment on ${appointmentDate} at ${time} has been canceled. Reply here if you need to reschedule.`;
    case "reminder":
      return `Hi ${name}, this is a reminder for your appointment on ${appointmentDate} at ${time}. Reply here if you need to make a change.`;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return jsonResponse({ ok: false, message: "Method not allowed" }, 405);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const twilioAccountSid = Deno.env.get("TWILIO_ACCOUNT_SID");
  const twilioAuthToken = Deno.env.get("TWILIO_AUTH_TOKEN");
  const twilioMessagingServiceSid = Deno.env.get(
    "TWILIO_MESSAGING_SERVICE_SID",
  );
  const twilioFromPhone = Deno.env.get("TWILIO_FROM_PHONE");

  if (!supabaseUrl || !supabaseAnonKey || !serviceRoleKey) {
    return jsonResponse({ ok: false, message: "Supabase env missing" }, 500);
  }

  const authHeader = req.headers.get("Authorization") || "";
  const userClient = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const serviceClient = createClient(supabaseUrl, serviceRoleKey);

  const {
    data: { user },
    error: userError,
  } = await userClient.auth.getUser();

  if (userError || !user) {
    return jsonResponse({ ok: false, message: "Unauthorized" }, 401);
  }

  const body = await req.json().catch(() => ({}));
  const appointmentId = String(body.appointmentId || "").trim();
  const messageType = String(
    body.messageType || "",
  ) as AppointmentSmsMessageType;
  const validMessageTypes = [
    "confirmation",
    "update",
    "cancellation",
    "reminder",
  ];

  if (!appointmentId || !validMessageTypes.includes(messageType)) {
    return jsonResponse({ ok: false, message: "Invalid SMS request" }, 400);
  }

  const { data: subscriptions, error: subscriptionError } = await serviceClient
    .from("user_subscriptions")
    .select(
      "status, plan, current_period_end, entitlement, entitlement_expires_at",
    )
    .eq("user_id", user.id);

  if (subscriptionError) {
    console.error("SMS subscription lookup failed", subscriptionError);
    return jsonResponse({ ok: false, message: SMS_SEND_FRIENDLY_ERROR }, 500);
  }

  if (
    !((subscriptions || []) as UserSubscription[]).some(
      hasActiveProSubscription,
    )
  ) {
    return jsonResponse({ ok: false, code: "not_paid" }, 402);
  }

  const { data: appointment, error: appointmentError } = await serviceClient
    .from("appointments")
    .select(
      "id, user_id, client_id, client_name, appointment_date, appointment_time",
    )
    .eq("id", appointmentId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (appointmentError) {
    console.error("SMS appointment lookup failed", appointmentError);
    return jsonResponse({ ok: false, message: SMS_SEND_FRIENDLY_ERROR }, 500);
  }

  if (!appointment) {
    return jsonResponse({
      ok: false,
      skipped: true,
      code: "missing_appointment",
    });
  }

  const { data: settings } = await serviceClient
    .from("sms_settings")
    .select("*")
    .eq("user_id", user.id)
    .maybeSingle();

  if (!settings?.enabled || !settings?.[messageEnabledKey(messageType)]) {
    return jsonResponse({ ok: true, skipped: true, code: "sms_disabled" });
  }

  const { data: userSettings } = await serviceClient
    .from("user_settings")
    .select("country_region")
    .eq("user_id", user.id)
    .maybeSingle();
  const countryRegion = isCountryRegionCode(userSettings?.country_region)
    ? userSettings.country_region
    : DEFAULT_COUNTRY_REGION;

  if (!appointment.client_id) {
    return jsonResponse({ ok: true, skipped: true, code: "missing_client" });
  }

  const { data: client, error: clientError } = await serviceClient
    .from("clients")
    .select("id, name, phone, sms_opt_in")
    .eq("id", appointment.client_id)
    .eq("user_id", user.id)
    .maybeSingle();

  if (clientError) {
    console.error("SMS client lookup failed", clientError);
    return jsonResponse({ ok: false, message: SMS_SEND_FRIENDLY_ERROR }, 500);
  }

  if (!client) {
    return jsonResponse({ ok: true, skipped: true, code: "missing_client" });
  }

  const toPhone = normalizePhoneForSms(
    String(client?.phone || ""),
    countryRegion,
  );

  if (!toPhone) {
    return jsonResponse({ ok: true, skipped: true, code: "missing_phone" });
  }

  if (!client.sms_opt_in) {
    return jsonResponse({
      ok: true,
      skipped: true,
      code: "client_not_opted_in",
    });
  }

  const smsBody = buildMessage({
    clientName: String(client.name || appointment.client_name || "there"),
    appointmentDate: String(appointment.appointment_date || ""),
    appointmentTime: String(appointment.appointment_time || ""),
    messageType,
  });

  const logPayload = {
    user_id: user.id,
    appointment_id: appointment.id,
    client_id: client.id,
    message_type: messageType,
    to_phone: toPhone,
    body: smsBody,
  };

  let creditsRemaining = 0;

  try {
    creditsRemaining = await getMessageCreditsRemaining(serviceClient, user.id);
  } catch {
    return jsonResponse(
      {
        ok: false,
        code: "message_credits_lookup_failed",
        message: SMS_SEND_FRIENDLY_ERROR,
      },
      500,
    );
  }

  if (creditsRemaining <= 0) {
    await serviceClient.from("sms_message_logs").insert({
      ...logPayload,
      status: "failed",
      error_message: "message_credits_empty",
    });

    return jsonResponse(
      {
        ok: false,
        code: "message_credits_empty",
        message: MESSAGE_CREDITS_EMPTY_MESSAGE,
        creditsRemaining: 0,
      },
      402,
    );
  }

  if (
    !twilioAccountSid ||
    !twilioAuthToken ||
    (!twilioMessagingServiceSid && !twilioFromPhone)
  ) {
    await serviceClient.from("sms_message_logs").insert({
      ...logPayload,
      status: "failed",
      error_message: "Twilio env missing",
    });

    console.error("SMS provider env missing");
    return jsonResponse(
      {
        ok: false,
        code: "sms_provider_not_configured",
        message: SMS_SEND_FRIENDLY_ERROR,
      },
      500,
    );
  }

  const form = new URLSearchParams();
  form.set("To", toPhone);
  form.set("Body", smsBody);

  if (twilioMessagingServiceSid) {
    form.set("MessagingServiceSid", twilioMessagingServiceSid);
  } else if (twilioFromPhone) {
    form.set("From", twilioFromPhone);
  }

  const twilioResponse = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${twilioAccountSid}/Messages.json`,
    {
      method: "POST",
      headers: {
        Authorization: `Basic ${
          btoa(`${twilioAccountSid}:${twilioAuthToken}`)
        }`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: form,
    },
  );
  const twilioResult = await twilioResponse.json().catch(() => ({}));

  if (!twilioResponse.ok) {
    await serviceClient.from("sms_message_logs").insert({
      ...logPayload,
      status: "failed",
      error_message:
        String(twilioResult.message || twilioResult.error_message || "") ||
        `Twilio HTTP ${twilioResponse.status}`,
    });

    return jsonResponse(
      {
        ok: false,
        code: "sms_provider_failed",
        message: SMS_SEND_FRIENDLY_ERROR,
      },
      502,
    );
  }

  const providerMessageId = String(twilioResult.sid || "");
  const { data: sentLog, error: sentLogError } = await serviceClient
    .from("sms_message_logs")
    .insert({
      ...logPayload,
      status: "sent",
      provider_message_id: providerMessageId,
    })
    .select("id")
    .maybeSingle();

  if (sentLogError) {
    console.error("SMS sent log insert failed", sentLogError);
  }

  let nextCreditsRemaining: number | null = null;

  try {
    nextCreditsRemaining = await consumeMessageCredit({
      serviceClient,
      userId: user.id,
      appointmentId: appointment.id,
      smsMessageLogId: sentLog?.id || null,
      providerMessageId,
      messageType,
    });
  } catch {
    // The provider already accepted the send, so do not report the SMS itself as failed.
    nextCreditsRemaining = null;
  }

  return jsonResponse({
    ok: true,
    providerMessageId: providerMessageId || null,
    creditsRemaining: nextCreditsRemaining,
  });
});
