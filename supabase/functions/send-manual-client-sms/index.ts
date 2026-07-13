import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

import {
  DEFAULT_COUNTRY_REGION,
  isCountryRegionCode,
  normalizePhoneForSms,
} from "../../../lib/phoneNumbers.ts";
import {
  confirmMessageCreditReservation,
  refundMessageCreditReservation,
  reserveMessageCredit,
} from "../_shared/messageCredits.ts";
import {
  corsHeaders,
  getErrorMessage,
  jsonResponse,
  serializeDetails,
  userHasSchedovaPro,
  type JsonObject,
} from "../_shared/emailMessages.ts";

const TELNYX_MESSAGES_URL = "https://api.telnyx.com/v2/messages";
const SMS_PROVIDER = "telnyx";
const SMS_DIRECTION = "outbound";

type ClientRecord = {
  id: string;
  name: string | null;
  phone: string | null;
  sms_opt_in: boolean | null;
};

function jsonError(error: unknown, status: number, extra: JsonObject = {}) {
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
    message_type: asTrimmedString(messageType) || "manual",
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
    console.error("sms_message_logs insert error", { step, error });
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
    console.error("sms_message_logs update error", { step, logId, error });
  }
}

async function syncUnifiedMessageConversation(
  serviceClient: any,
  payload: {
    messageId: string;
    accountId: string;
    conversationId?: string | null;
    subject?: string | null;
  },
) {
  if (!payload.conversationId) return;

  const { error } = await serviceClient
    .from("messages")
    .update({
      conversation_id: asNullableUuid(payload.conversationId),
      subject: payload.subject || null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", payload.messageId)
    .eq("account_id", payload.accountId);

  if (error) {
    console.error("messages conversation sync failed", {
      messageId: payload.messageId,
      conversationId: payload.conversationId,
      error,
    });
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") {
    return jsonResponse({ ok: false, error: "Method not allowed" }, 405);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const telnyxApiKey = Deno.env.get("TELNYX_API_KEY");
  const telnyxFromNumber = Deno.env.get("TELNYX_FROM_NUMBER");
  const telnyxMessagingProfileId = Deno.env.get("TELNYX_MESSAGING_PROFILE_ID");

  if (!supabaseUrl || !supabaseAnonKey || !serviceRoleKey) {
    return jsonError("Supabase environment is not configured.", 500, {
      code: "supabase_env_missing",
    });
  }

  const authHeader = req.headers.get("Authorization") || "";
  const userClient = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const serviceClient = createClient(supabaseUrl, serviceRoleKey);

  const {
    data: { user },
    error: authError,
  } = await userClient.auth.getUser();

  if (authError || !user) {
    return jsonError(authError || "Unauthorized", 401, { code: "unauthorized" });
  }

  let body: JsonObject = {};
  try {
    const parsed = await req.json();
    body = parsed && typeof parsed === "object" ? (parsed as JsonObject) : {};
  } catch (error) {
    return jsonError(error, 400, { code: "invalid_json" });
  }

  const clientId = asTrimmedString(body.clientId || body.client_id);
  const appointmentId = asTrimmedString(body.appointmentId || body.appointment_id);
  const requestedConversationId = asTrimmedString(
    body.conversationId || body.conversation_id,
  );
  const messageBody = asTrimmedString(body.messageBody || body.body);

  if (!clientId || !messageBody) {
    return jsonError("Client and message are required.", 400, {
      code: "invalid_request",
    });
  }

  const isPro = await userHasSchedovaPro(serviceClient, user.id);
  if (!isPro) {
    return jsonResponse(
      {
        ok: false,
        code: "not_paid",
        error: "Schedova Pro is required to send texts from Messages.",
      },
      402,
    );
  }

  const { data: clientData, error: clientError } = await serviceClient
    .from("clients")
    .select("id, name, phone, sms_opt_in")
    .eq("id", clientId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (clientError) {
    return jsonError(clientError, 500, { code: "client_lookup_failed" });
  }

  const client = (clientData || null) as ClientRecord | null;
  if (!client) {
    return jsonResponse({ ok: false, skipped: true, code: "missing_client" }, 404);
  }

  const { data: userSettingsData } = await serviceClient
    .from("user_settings")
    .select("country_region")
    .eq("user_id", user.id)
    .maybeSingle();
  const countryRegion = isCountryRegionCode(userSettingsData?.country_region)
    ? userSettingsData.country_region
    : DEFAULT_COUNTRY_REGION;
  const toPhone = normalizePhoneForSms(client.phone, countryRegion);

  if (!toPhone) {
    return jsonResponse({ ok: false, skipped: true, code: "missing_phone" }, 400);
  }

  if (!client.sms_opt_in) {
    return jsonResponse(
      { ok: false, skipped: true, code: "client_not_opted_in" },
      400,
    );
  }

  if (!telnyxApiKey || !telnyxFromNumber || !telnyxMessagingProfileId) {
    return jsonError("Telnyx is not configured.", 500, {
      code: "sms_provider_not_configured",
    });
  }

  let conversationId = asNullableUuid(requestedConversationId);

  if (!conversationId) {
    const conversationResult = await serviceClient.rpc("upsert_message_conversation", {
      p_account_id: user.id,
      p_client_id: asNullableUuid(client.id),
      p_appointment_id: asNullableUuid(appointmentId),
      p_subject: "Text message",
    });

    if (conversationResult.error) {
      return jsonError(conversationResult.error, 500, {
        code: "conversation_failed",
      });
    }

    conversationId = asTrimmedString(conversationResult.data);
  }

  const reservationResult = await reserveMessageCredit(serviceClient, {
    userId: user.id,
    appointmentId: asNullableUuid(appointmentId),
    clientId: client.id,
    messageType: "manual",
    reason: "manual_sms_send",
    metadata: {
      function: "send-manual-client-sms",
      clientId: client.id,
      appointmentId: appointmentId || null,
      conversationId,
    },
  });

  if (reservationResult.error) {
    return jsonError(reservationResult.error, 500, {
      code: "message_credit_reservation_failed",
    });
  }

  if (!reservationResult.data.ok || !reservationResult.data.reserved) {
    return jsonResponse(
      {
        ok: false,
        code: "insufficient_credits",
        error: "Insufficient message credits",
        balance: Number(reservationResult.data.balance) || 0,
      },
      402,
    );
  }

  const reservationId = asTrimmedString(reservationResult.data.eventId);
  const queuedLogId = await tryInsertSmsLog(
    serviceClient,
    buildSmsLogPayload({
      userId: user.id,
      appointmentId,
      clientId: client.id,
      messageType: "manual",
      toPhone,
      smsBody: messageBody,
      status: "queued",
      fromNumber: telnyxFromNumber,
    }),
    "sms_message_logs_insert",
  );

  if (!queuedLogId) {
    if (reservationId) {
      await refundMessageCreditReservation(serviceClient, {
        eventId: reservationId,
        refundReason: "sms_log_insert_failed",
      });
    }

    return jsonError("SMS log insert failed", 500, {
      code: "sms_log_insert_failed",
    });
  }

  await syncUnifiedMessageConversation(serviceClient, {
    messageId: queuedLogId,
    accountId: user.id,
    conversationId,
    subject: "Text message",
  });

  const telnyxRequestBody = {
    from: telnyxFromNumber,
    to: toPhone,
    text: messageBody,
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
    const providerMessageId = extractTelnyxProviderMessageId(telnyxResponseBody);

    if (!telnyxResponse.ok) {
      const telnyxErrorMessage = extractTelnyxErrorMessage(
        telnyxResponseBody,
        telnyxResponse.status,
      );

      await tryUpdateSmsLog(
        serviceClient,
        queuedLogId,
        buildSmsLogPayload({
          userId: user.id,
          appointmentId,
          clientId: client.id,
          messageType: "manual",
          toPhone,
          smsBody: messageBody,
          status: "failed",
          fromNumber: telnyxFromNumber,
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

      return jsonError(telnyxErrorMessage, 502, {
        code: "sms_provider_failed",
      });
    }

    const providerStatus = extractTelnyxMessageStatus(telnyxResponseBody);
    let creditWarning: string | null = null;

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
        creditWarning = "SMS sent, but message credit confirmation needs review.";
      }
    }

    await tryUpdateSmsLog(
      serviceClient,
      queuedLogId,
      buildSmsLogPayload({
        userId: user.id,
        appointmentId,
        clientId: client.id,
        messageType: "manual",
        toPhone,
        smsBody: messageBody,
        status: providerStatus,
        fromNumber: telnyxFromNumber,
        providerMessageId,
        providerResponse: telnyxResponseBody,
        errorMessage: creditWarning,
      }),
      "telnyx_send_success",
    );

    return jsonResponse({
      ok: true,
      messageId: queuedLogId,
      conversationId,
      providerMessageId,
      providerStatus,
      balance: Number(reservationResult.data.balance) || null,
      warning: creditWarning,
    });
  } catch (error) {
    await tryUpdateSmsLog(
      serviceClient,
      queuedLogId,
      buildSmsLogPayload({
        userId: user.id,
        appointmentId,
        clientId: client.id,
        messageType: "manual",
        toPhone,
        smsBody: messageBody,
        status: "failed",
        fromNumber: telnyxFromNumber,
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

    return jsonError(error, 502, {
      code: "sms_provider_failed",
    });
  }
});
