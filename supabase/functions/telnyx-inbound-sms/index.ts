import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  DEFAULT_COUNTRY_REGION,
  normalizePhoneForSms,
} from "../../../lib/phoneNumbers.ts";

type JsonObject = Record<string, unknown>;

type SmsConversationContext = {
  user_id?: string | null;
  client_id?: string | null;
  appointment_id?: string | null;
  message_type?: string | null;
  created_at?: string | null;
};

type ClientRow = {
  id?: string | null;
  user_id?: string | null;
  name?: string | null;
  phone?: string | null;
  updated_at?: string | null;
  created_at?: string | null;
  archived_at?: string | null;
};

type AppointmentRow = {
  id?: string | null;
  user_id?: string | null;
  client_id?: string | null;
  appointment_date?: string | null;
  appointment_time?: string | null;
  status?: string | null;
  confirmation_status?: string | null;
  confirmed_at?: string | null;
  confirmation_response_at?: string | null;
  sms_confirmation_sent_at?: string | null;
  sms_reminder_sent_at?: string | null;
};

type ParsedInboundMessage = {
  eventType: string;
  fromNumberRaw: string;
  toNumberRaw: string;
  messageBody: string;
  providerMessageId: string | null;
  receivedAt: string | null;
  payload: JsonObject;
};

type PushTokenRow = {
  id?: string | null;
  expo_push_token?: string | null;
  platform?: string | null;
};

type ClientReplyIntent = "confirmed" | "needs_reschedule" | "declined" | null;

const SMS_PROVIDER = "telnyx";
const SMS_DIRECTION = "inbound";
const SMS_MESSAGE_TYPE = "inbound";
const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";
const CLIENT_MESSAGE_NOTIFICATION_TYPE = "client_message";
const ACTIONABLE_ATTENTION_REASON = "Client reply may require follow-up";
const NO_MATCHING_CLIENT_ERROR = "No matching client found";
const ACTIONABLE_PATTERNS = [
  /\breschedule\b/i,
  /\bchange\b/i,
  /\bcancel\b/i,
  /can't make it/i,
  /can’t make it/i,
  /\brunning late\b/i,
  /\blate\b/i,
  /\bdifferent time\b/i,
  /\bmove appointment\b/i,
];
const CANCELED_APPOINTMENT_STATUSES = new Set([
  "canceled",
  "business_canceled",
  "customer_canceled",
  "no_show",
]);

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, telnyx-timestamp, telnyx-signature-ed25519",
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

function asObject(value: unknown): JsonObject {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonObject)
    : {};
}

function asTrimmedString(value: unknown) {
  return String(value || "").trim();
}

function safeParseJson(text: string) {
  if (!text.trim()) return null;

  try {
    return JSON.parse(text) as JsonObject;
  } catch {
    return null;
  }
}

function normalizePhone(value: unknown) {
  const raw = asTrimmedString(value);
  if (!raw) return "";

  return normalizePhoneForSms(raw, DEFAULT_COUNTRY_REGION) || raw;
}

function digitsOnly(value: unknown) {
  return asTrimmedString(value).replace(/\D/g, "");
}

function phoneNumbersMatch(left: unknown, right: unknown) {
  const normalizedLeft = normalizePhone(left);
  const normalizedRight = normalizePhone(right);

  if (!normalizedLeft || !normalizedRight) return false;
  if (normalizedLeft === normalizedRight) return true;

  const leftDigits = digitsOnly(normalizedLeft);
  const rightDigits = digitsOnly(normalizedRight);

  if (!leftDigits || !rightDigits) return false;
  if (leftDigits === rightDigits) return true;

  return (
    leftDigits.length >= 10 &&
    rightDigits.length >= 10 &&
    leftDigits.slice(-10) === rightDigits.slice(-10)
  );
}

function normalizeTextForMatching(value: string) {
  return value.toLowerCase().replace(/’/g, "'");
}

function normalizeInboundReplyText(value: string) {
  return normalizeTextForMatching(value)
    .replace(/['`]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function looksActionable(body: string) {
  const normalized = normalizeTextForMatching(body);
  return ACTIONABLE_PATTERNS.some((pattern) => pattern.test(normalized));
}

function getClientReplyIntent(body: string): ClientReplyIntent {
  const normalized = normalizeInboundReplyText(body);

  if (!normalized) return null;

  const words = new Set(normalized.split(" "));
  const padded = ` ${normalized} `;
  const hasPhrase = (phrase: string) => padded.includes(` ${phrase} `);

  if (
    words.has("yes") ||
    words.has("y") ||
    words.has("confirm") ||
    words.has("confirmed") ||
    words.has("ok") ||
    words.has("okay") ||
    hasPhrase("sounds good") ||
    hasPhrase("see you then") ||
    hasPhrase("see you")
  ) {
    return "confirmed";
  }

  if (words.has("cancel") || words.has("canceled") || words.has("cancelled")) {
    return "declined";
  }

  if (
    words.has("no") ||
    words.has("n") ||
    words.has("reschedule") ||
    hasPhrase("need to reschedule") ||
    hasPhrase("cant make it") ||
    hasPhrase("can t make it")
  ) {
    return "needs_reschedule";
  }

  return null;
}

function getAppointmentConfirmationStatus(row: AppointmentRow | null) {
  const confirmationStatus = asTrimmedString(row?.confirmation_status);
  if (confirmationStatus) return confirmationStatus;

  const lifecycleStatus = asTrimmedString(row?.status);
  if (
    ["confirmed", "accepted", "declined", "canceled", "cancelled"].includes(
      lifecycleStatus.toLowerCase(),
    )
  ) {
    return lifecycleStatus;
  }

  if (row?.sms_confirmation_sent_at || row?.sms_reminder_sent_at) {
    return "waiting_for_response";
  }

  return lifecycleStatus || null;
}

function getConfirmationStatusForReplyIntent(replyIntent: ClientReplyIntent) {
  switch (replyIntent) {
    case "confirmed":
      return "confirmed";
    case "needs_reschedule":
      return "needs_reschedule";
    case "declined":
      return "declined";
    default:
      return null;
  }
}

function sortByMostRecentlyUpdated(left: ClientRow, right: ClientRow) {
  const leftTimestamp = Date.parse(
    asTrimmedString(left.updated_at || left.created_at) || "1970-01-01T00:00:00.000Z",
  );
  const rightTimestamp = Date.parse(
    asTrimmedString(right.updated_at || right.created_at) || "1970-01-01T00:00:00.000Z",
  );

  return rightTimestamp - leftTimestamp;
}

function toIsoTimestamp(value: unknown) {
  const raw = asTrimmedString(value);
  if (!raw) return null;

  const timestamp = Date.parse(raw);
  if (!Number.isFinite(timestamp)) return null;

  return new Date(timestamp).toISOString();
}

function buildAppointmentDateTime(appointment: AppointmentRow) {
  const date = asTrimmedString(appointment.appointment_date);
  if (!date) return null;

  const time = asTrimmedString(appointment.appointment_time).slice(0, 5) || "12:00";
  const timestamp = Date.parse(`${date}T${time}:00`);

  return Number.isFinite(timestamp) ? new Date(timestamp) : null;
}

function findNearestUpcomingAppointment(rows: AppointmentRow[]) {
  const now = Date.now();

  return rows
    .filter((row) => {
      const status = asTrimmedString(row.status).toLowerCase();
      if (CANCELED_APPOINTMENT_STATUSES.has(status)) return false;

      const appointmentDateTime = buildAppointmentDateTime(row);
      return Boolean(appointmentDateTime && appointmentDateTime.getTime() >= now);
    })
    .sort((left, right) => {
      const leftTime = buildAppointmentDateTime(left)?.getTime() || Number.MAX_SAFE_INTEGER;
      const rightTime = buildAppointmentDateTime(right)?.getTime() || Number.MAX_SAFE_INTEGER;
      return leftTime - rightTime;
    })[0] || null;
}

function buildAttentionPreview(messageBody: string) {
  const preview = asTrimmedString(messageBody).replace(/\s+/g, " ");
  if (preview.length <= 90) return preview;
  return `${preview.slice(0, 87)}...`;
}

function buildPushPreview(messageBody: string) {
  const preview = asTrimmedString(messageBody).replace(/\s+/g, " ");
  if (preview.length <= 110) return preview;
  return `${preview.slice(0, 107)}...`;
}

function buildPushBody(clientName: string | null | undefined, messageBody: string) {
  const preview = buildPushPreview(messageBody);
  const name = asTrimmedString(clientName);

  if (name && preview) return `${name}: ${preview}`;
  if (preview) return preview;

  return "A client replied to an appointment text.";
}

function chunkArray<T>(items: T[], size: number) {
  const chunks: T[][] = [];

  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }

  return chunks;
}

function getExpoPushResultItems(value: unknown) {
  if (!value || typeof value !== "object") return [];

  const body = value as JsonObject;
  return Array.isArray(body.data) ? body.data : [];
}

async function removeInvalidPushTokens(
  serviceClient: any,
  userId: string,
  tokens: string[],
) {
  const uniqueTokens = Array.from(new Set(tokens.filter(Boolean)));

  if (uniqueTokens.length === 0) return;

  const { error } = await serviceClient
    .from("user_push_tokens")
    .delete()
    .eq("user_id", userId)
    .in("expo_push_token", uniqueTokens);

  if (error) {
    console.error("invalid push token cleanup failed", {
      userId,
      error,
      count: uniqueTokens.length,
    });
  } else {
    console.log("invalid push tokens removed", {
      userId,
      count: uniqueTokens.length,
    });
  }
}

async function sendClientReplyPushNotifications(
  serviceClient: any,
  {
    userId,
    clientId,
    appointmentId,
    messageId,
    clientName,
    messageBody,
  }: {
    userId: string;
    clientId: string | null;
    appointmentId: string | null;
    messageId: string | null;
    clientName: string | null;
    messageBody: string;
  },
) {
  const { data: tokenRows, error: tokenError } = await serviceClient
    .from("user_push_tokens")
    .select("id, expo_push_token, platform")
    .eq("user_id", userId)
    .order("last_seen_at", { ascending: false });

  if (tokenError) {
    console.error("push token lookup failed", {
      userId,
      error: tokenError,
    });
    return;
  }

  const rows = ((tokenRows || []) as PushTokenRow[]).filter((row) =>
    Boolean(asTrimmedString(row.expo_push_token)),
  );

  if (rows.length === 0) {
    console.log("no push tokens for inbound client reply", { userId });
    return;
  }

  const invalidTokens: string[] = [];
  const title = "New client message";
  const body = buildPushBody(clientName, messageBody);

  for (const chunk of chunkArray(rows, 100)) {
    const messages = chunk.map((row) => ({
      to: asTrimmedString(row.expo_push_token),
      title,
      body,
      sound: "default",
      channelId: "client-messages",
      data: {
        type: CLIENT_MESSAGE_NOTIFICATION_TYPE,
        messageId,
        replyId: messageId,
        clientId,
        appointmentId,
      },
    }));

    try {
      const response = await fetch(EXPO_PUSH_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify(messages),
      });
      const responseText = await response.text();
      const responseBody = safeParseJson(responseText) || {
        raw: responseText,
      };

      console.log("Expo push response for inbound reply", {
        userId,
        status: response.status,
        ok: response.ok,
        tokenCount: chunk.length,
        responseBody,
      });

      const results = getExpoPushResultItems(responseBody);

      results.forEach((result, index) => {
        if (!result || typeof result !== "object") return;

        const item = result as JsonObject;
        const details = asObject(item.details);
        const errorCode = asTrimmedString(details.error);

        if (
          asTrimmedString(item.status).toLowerCase() === "error" &&
          errorCode === "DeviceNotRegistered"
        ) {
          const token = asTrimmedString(chunk[index]?.expo_push_token);
          if (token) invalidTokens.push(token);
        }
      });
    } catch (error) {
      console.error("Expo push send failed for inbound reply", {
        userId,
        error,
      });
    }
  }

  await removeInvalidPushTokens(serviceClient, userId, invalidTokens);
}

function parseInboundMessage(body: JsonObject): ParsedInboundMessage {
  const data = asObject(body.data);
  const payload = asObject(data.payload);
  const from = asObject(payload.from);
  const toList = Array.isArray(payload.to) ? payload.to : [];
  const firstTo = asObject(toList[0]);
  const nestedBody = asObject(payload.body);

  return {
    eventType: asTrimmedString(data.event_type || body.event_type),
    fromNumberRaw: asTrimmedString(from.phone_number || payload.from || body.from),
    toNumberRaw: asTrimmedString(firstTo.phone_number || payload.to || body.to),
    messageBody: asTrimmedString(
      payload.text || nestedBody.text || body.text || body.body,
    ),
    providerMessageId:
      asTrimmedString(payload.id || data.id || body.id) || null,
    receivedAt:
      toIsoTimestamp(payload.received_at) ||
      toIsoTimestamp(data.occurred_at) ||
      toIsoTimestamp(body.occurred_at),
    payload: body,
  };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return jsonResponse({ ok: true }, 405);
  }

  console.log("telnyx-inbound-sms invoked");
  console.log("telnyx-inbound-sms method", req.method);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!supabaseUrl || !serviceRoleKey) {
    console.error("missing env vars", {
      missing: [
        !supabaseUrl ? "SUPABASE_URL" : null,
        !serviceRoleKey ? "SUPABASE_SERVICE_ROLE_KEY" : null,
      ].filter(Boolean),
    });
    return jsonResponse({ ok: true });
  }

  const rawBodyText = await req.text();
  console.log("telnyx-inbound-sms raw body", rawBodyText);
  const parsedBody = safeParseJson(rawBodyText);

  if (!parsedBody) {
    console.error("invalid inbound webhook payload", {
      bodyPreview: rawBodyText.slice(0, 300),
    });
    return jsonResponse({ ok: true });
  }

  const inbound = parseInboundMessage(parsedBody);
  const normalizedFromNumber = normalizePhone(inbound.fromNumberRaw);
  const normalizedToNumber = normalizePhone(inbound.toNumberRaw);
  const normalizedReplyText = normalizeInboundReplyText(inbound.messageBody);
  const replyIntent = getClientReplyIntent(inbound.messageBody);
  const needsAttention =
    replyIntent === "confirmed"
      ? false
      : replyIntent === "needs_reschedule" ||
        replyIntent === "declined" ||
        looksActionable(inbound.messageBody);
  const attentionReason =
    replyIntent === "needs_reschedule"
      ? "Client needs to reschedule"
      : replyIntent === "declined"
        ? "Client declined or canceled"
        : needsAttention
          ? ACTIONABLE_ATTENTION_REASON
          : null;

  console.log("parsed inbound message", {
    eventType: inbound.eventType,
    fromNumber: normalizedFromNumber || inbound.fromNumberRaw,
    toNumber: normalizedToNumber || inbound.toNumberRaw,
    providerMessageId: inbound.providerMessageId,
    receivedAt: inbound.receivedAt,
    inboundPhoneNumber: normalizedFromNumber || inbound.fromNumberRaw,
    normalizedReplyText,
    needsAttention,
    replyIntent,
  });

  if (inbound.eventType && inbound.eventType !== "message.received") {
    console.log("ignoring non-inbound Telnyx event", {
      eventType: inbound.eventType,
    });
    return jsonResponse({ ok: true });
  }

  const serviceClient = createClient(supabaseUrl, serviceRoleKey);

  // TODO: Verify Telnyx webhook signatures before public launch.
  let conversationContext: SmsConversationContext | null = null;

  if (normalizedFromNumber && normalizedToNumber) {
    const { data: contextData, error: contextError } = await serviceClient
      .from("sms_message_logs")
      .select("user_id, client_id, appointment_id, message_type, created_at")
      .eq("provider", SMS_PROVIDER)
      .eq("direction", "outbound")
      .eq("from_number", normalizedToNumber)
      .eq("to_number", normalizedFromNumber)
      .in("message_type", ["confirmation", "reminder", "update"])
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (contextError) {
      console.error("conversation context lookup failed", {
        error: contextError,
        fromNumber: normalizedFromNumber,
        toNumber: normalizedToNumber,
      });
    } else {
      conversationContext = (contextData || null) as SmsConversationContext | null;
    }
  }

  let matchedClient: ClientRow | null = null;
  let matchedAppointment: AppointmentRow | null = null;
  let appointmentMatchReason: string | null = null;
  let clientLookupUserId = asTrimmedString(conversationContext?.user_id) || null;

  {
    let clientQuery = serviceClient
      .from("clients")
      .select("*")
      .is("archived_at", null)
      .not("phone", "is", null);

    if (clientLookupUserId) {
      clientQuery = clientQuery.eq("user_id", clientLookupUserId);
    }

    const { data: clientRows, error: clientError } = await clientQuery;

    if (clientError) {
      console.error("client lookup failed", {
        error: clientError,
        fromNumber: normalizedFromNumber || inbound.fromNumberRaw,
        scopedUserId: clientLookupUserId,
      });
    } else {
      const matchingClients = ((clientRows || []) as ClientRow[])
        .filter((row) => phoneNumbersMatch(row.phone, normalizedFromNumber))
        .sort(sortByMostRecentlyUpdated);

      matchedClient = matchingClients[0] || null;
      clientLookupUserId =
        asTrimmedString(matchedClient?.user_id) || clientLookupUserId;
    }
  }

  console.log("matched client", {
    matched: Boolean(matchedClient?.id),
    clientId: matchedClient?.id || null,
    userId: matchedClient?.user_id || clientLookupUserId,
    phone: matchedClient?.phone || null,
  });

  const conversationAppointmentId =
    asTrimmedString(conversationContext?.appointment_id) || null;

  if (conversationAppointmentId && clientLookupUserId) {
    const { data: contextAppointment, error: contextAppointmentError } =
      await serviceClient
        .from("appointments")
        .select(
          "id, user_id, client_id, appointment_date, appointment_time, status, confirmation_status, confirmed_at, confirmation_response_at, sms_confirmation_sent_at, sms_reminder_sent_at",
        )
        .eq("id", conversationAppointmentId)
        .eq("user_id", clientLookupUserId)
        .maybeSingle();

    if (contextAppointmentError) {
      console.error("conversation appointment lookup failed", {
        error: contextAppointmentError,
        appointmentId: conversationAppointmentId,
        userId: clientLookupUserId,
      });
    } else if (contextAppointment) {
      matchedAppointment = contextAppointment as AppointmentRow;
      appointmentMatchReason = "matched_recent_outbound_sms_thread";
    }
  }

  if (matchedClient?.id && clientLookupUserId) {
    if (!matchedAppointment) {
      const { data: appointmentRows, error: appointmentError } = await serviceClient
        .from("appointments")
        .select(
          "id, user_id, client_id, appointment_date, appointment_time, status, confirmation_status, confirmed_at, confirmation_response_at, sms_confirmation_sent_at, sms_reminder_sent_at",
        )
        .eq("user_id", clientLookupUserId)
        .eq("client_id", matchedClient.id)
        .order("appointment_date", { ascending: true })
        .order("appointment_time", { ascending: true });

      if (appointmentError) {
        console.error("appointment lookup failed", {
          error: appointmentError,
          userId: clientLookupUserId,
          clientId: matchedClient.id,
        });
      } else {
        matchedAppointment = findNearestUpcomingAppointment(
          ((appointmentRows || []) as AppointmentRow[]).filter(Boolean),
        );
        appointmentMatchReason = matchedAppointment
          ? "matched_nearest_upcoming_client_appointment"
          : "no_upcoming_appointment_for_client";
      }
    }
  } else if (!matchedAppointment) {
    appointmentMatchReason = matchedClient?.id
      ? "missing_user_for_client"
      : "no_matching_client";
  }

  console.log("matched appointment", {
    matched: Boolean(matchedAppointment?.id),
    appointmentId: matchedAppointment?.id || null,
    clientId: matchedClient?.id || null,
    matchReason: appointmentMatchReason,
    oldStatus: getAppointmentConfirmationStatus(matchedAppointment),
  });

  const userId = clientLookupUserId;
  const clientId = asTrimmedString(matchedClient?.id) || null;
  const appointmentId = asTrimmedString(matchedAppointment?.id) || null;

  if (!userId) {
    console.error("unable to determine user for inbound sms", {
      fromNumber: normalizedFromNumber || inbound.fromNumberRaw,
      toNumber: normalizedToNumber || inbound.toNumberRaw,
      providerMessageId: inbound.providerMessageId,
    });
    return jsonResponse({ ok: true });
  }

  const logPayload: Record<string, unknown> = {
    user_id: userId,
    client_id: clientId,
    appointment_id: appointmentId,
    provider: SMS_PROVIDER,
    direction: SMS_DIRECTION,
    message_type: SMS_MESSAGE_TYPE,
    from_number: normalizedFromNumber || inbound.fromNumberRaw || null,
    to_number: normalizedToNumber || inbound.toNumberRaw || null,
    to_phone: normalizedToNumber || inbound.toNumberRaw || null,
    body: inbound.messageBody || null,
    message_body: inbound.messageBody || null,
    status: replyIntent || "received",
    provider_message_id: inbound.providerMessageId,
    provider_response: {
      ...inbound.payload,
      normalized_reply_text: normalizedReplyText,
      schedova_reply_intent: replyIntent,
      schedova_needs_attention: needsAttention,
    },
    error_message: clientId ? null : NO_MATCHING_CLIENT_ERROR,
    needs_attention: needsAttention,
    attention_reason: attentionReason,
  };

  if (inbound.receivedAt) {
    logPayload.created_at = inbound.receivedAt;
  }

  const { data: insertedLog, error: logInsertError } = await serviceClient
    .from("sms_message_logs")
    .insert(logPayload)
    .select("id")
    .maybeSingle();

  if (logInsertError) {
    console.error("inserted message log failed", {
      error: logInsertError,
      userId,
      clientId,
      appointmentId,
      providerMessageId: inbound.providerMessageId,
    });
    return jsonResponse({ ok: true });
  }

  console.log("inserted message log", {
    logId: insertedLog?.id || null,
    userId,
    clientId,
    appointmentId,
    needsAttention,
    replyIntent,
    normalizedReplyText,
  });

  if (appointmentId && (needsAttention || replyIntent === "confirmed")) {
    const oldStatus = getAppointmentConfirmationStatus(matchedAppointment);
    const newStatus = getConfirmationStatusForReplyIntent(replyIntent);
    const responseAt = new Date().toISOString();
    const appointmentAttentionReason =
      replyIntent === "confirmed"
        ? null
        : `Client replied: ${buildAttentionPreview(inbound.messageBody)}`;
    const appointmentUpdatePayload: Record<string, unknown> = {
      needs_attention: replyIntent === "confirmed" ? false : true,
      attention_reason: appointmentAttentionReason,
    };

    if (newStatus) {
      appointmentUpdatePayload.confirmation_status = newStatus;
      appointmentUpdatePayload.confirmation_response_at = responseAt;
    }

    if (replyIntent === "confirmed") {
      appointmentUpdatePayload.confirmed_at = responseAt;
    }

    const { error: appointmentUpdateError } = await serviceClient
      .from("appointments")
      .update(appointmentUpdatePayload)
      .eq("id", appointmentId)
      .eq("user_id", userId);

    if (appointmentUpdateError) {
      console.error("appointment confirmation status update failed", {
        error: appointmentUpdateError,
        appointmentId,
        userId,
        oldStatus,
        newStatus,
      });
    } else {
      console.log("appointment confirmation status update", {
        appointmentId,
        userId,
        attentionReason: appointmentAttentionReason,
        replyIntent,
        oldStatus,
        newStatus,
      });
    }
  } else if (replyIntent) {
    console.log("recognized reply did not update appointment", {
      inboundPhoneNumber: normalizedFromNumber || inbound.fromNumberRaw,
      normalizedReplyText,
      replyIntent,
      reason: appointmentMatchReason || "no_appointment_matched",
    });
  }

  await sendClientReplyPushNotifications(serviceClient, {
    userId,
    clientId,
    appointmentId,
    messageId: insertedLog?.id ? String(insertedLog.id) : null,
    clientName: matchedClient?.name || null,
    messageBody: inbound.messageBody,
  });

  return jsonResponse({ ok: true });
});
