import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

import {
  asNullableUuid,
  asTrimmedString,
  buildSchedovaFromHeader,
  buildEmailContent,
  corsHeaders,
  EMAIL_PROVIDER,
  getBusinessName,
  getErrorMessage,
  insertMessage,
  jsonResponse,
  sendEmail,
  serializeDetails,
  userHasSchedovaPro,
  type JsonObject,
} from "../_shared/emailMessages.ts";

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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") {
    return jsonResponse({ ok: false, error: "Method not allowed" }, 405);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

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
  let subject = asTrimmedString(body.subject);

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
        error: "Schedova Pro is required to send emails.",
      },
      402,
    );
  }

  const { data: clientData, error: clientError } = await serviceClient
    .from("clients")
    .select("id, name, email, email_opt_in")
    .eq("id", clientId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (clientError) {
    return jsonError(clientError, 500, { code: "client_lookup_failed" });
  }

  const client = (clientData || null) as JsonObject | null;
  const toEmail = asTrimmedString(client?.email).toLowerCase();

  if (!client || !toEmail) {
    return jsonResponse({ ok: false, skipped: true, code: "missing_email" }, 400);
  }

  if (!client.email_opt_in) {
    return jsonResponse(
      { ok: false, skipped: true, code: "email_not_opted_in" },
      400,
    );
  }

  const { businessName, businessContact } = await getBusinessName(
    serviceClient,
    user.id,
    user,
  );
  subject = subject || `Message from ${businessName}`;
  const emailContent = buildEmailContent({
    messageType: "manual",
    clientName: asTrimmedString(client.name) || "there",
    businessName,
    businessContact,
    customBody: messageBody,
  });

  let conversationId = asNullableUuid(requestedConversationId);

  if (!conversationId) {
    const conversationResult = await serviceClient.rpc("upsert_message_conversation", {
      p_account_id: user.id,
      p_client_id: asNullableUuid(clientId),
      p_appointment_id: asNullableUuid(appointmentId),
      p_subject: subject,
    });

    if (conversationResult.error) {
      return jsonError(conversationResult.error, 500, {
        code: "conversation_failed",
      });
    }

    conversationId = asTrimmedString(conversationResult.data);
  }
  const ownerReplyTo = asTrimmedString(user.email) || "support@schedova.com";

  const queuedMessage = await insertMessage({
    serviceClient,
    accountId: user.id,
    clientId,
    appointmentId: appointmentId || null,
    conversationId,
    channel: "email",
    direction: "outbound",
    sender: buildSchedovaFromHeader(businessName),
    recipient: toEmail,
    subject,
    body: messageBody,
    status: "queued",
    provider: EMAIL_PROVIDER,
    metadata: {
      messageType: "manual",
      replyMode: "owner_email_inbox",
      replyTo: ownerReplyTo,
    },
  });

  try {
    const providerResult = await sendEmail({
      to: toEmail,
      fromName: businessName,
      subject,
      html: emailContent.html,
      text: emailContent.plainText,
      replyTo: ownerReplyTo,
    });

    await serviceClient
      .from("messages")
      .update({
        status: "sent",
        provider_message_id: providerResult.providerMessageId,
        provider_response: providerResult.providerResponse,
        updated_at: new Date().toISOString(),
      })
      .eq("id", queuedMessage.id)
      .eq("account_id", user.id);

    return jsonResponse({
      ok: true,
      providerMessageId: providerResult.providerMessageId,
      messageId: queuedMessage.id,
      conversationId: queuedMessage.conversationId,
    });
  } catch (error) {
    await serviceClient
      .from("messages")
      .update({
        status: "failed",
        provider_response: serializeDetails(error),
        updated_at: new Date().toISOString(),
      })
      .eq("id", queuedMessage.id)
      .eq("account_id", user.id);

    return jsonError(error, 502, {
      code: "email_provider_failed",
      messageId: queuedMessage.id,
    });
  }
});
