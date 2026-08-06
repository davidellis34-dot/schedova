import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

import {
  asNullableUuid,
  asTrimmedString,
  buildReplyAddress,
  buildSchedovaFromHeader,
  buildEmailContent,
  corsHeaders,
  createReplyToken,
  EMAIL_PROVIDER,
  getBusinessName,
  getErrorMessage,
  getServiceNames,
  insertMessage,
  jsonResponse,
  sendEmail,
  serializeDetails,
  userHasSchedovaPro,
  type EmailMessageType,
  type JsonObject,
} from "../_shared/emailMessages.ts";

const VALID_MESSAGE_TYPES = new Set([
  "confirmation",
  "update",
  "cancellation",
  "reminder",
]);

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

  const appointmentId = asTrimmedString(body.appointmentId || body.appointment_id);
  const messageType = asTrimmedString(body.messageType || body.message_type) as EmailMessageType;
  const customBody = asTrimmedString(body.messageBody || body.body);
  const customSubject = asTrimmedString(body.subject);

  if (!appointmentId || !VALID_MESSAGE_TYPES.has(messageType)) {
    return jsonError("Invalid appointment email request.", 400, {
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

  const { data: appointmentData, error: appointmentError } = await serviceClient
    .from("appointments")
    .select(
      "id, user_id, client_id, client_name, appointment_date, appointment_time, service_ids, email_notifications_enabled",
    )
    .eq("id", appointmentId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (appointmentError) {
    return jsonError(appointmentError, 500, { code: "appointment_lookup_failed" });
  }

  const appointment = (appointmentData || null) as JsonObject | null;
  if (!appointment) {
    return jsonError("Appointment not found.", 404, { code: "missing_appointment" });
  }

  if (appointment.email_notifications_enabled === false) {
    return jsonResponse({ ok: true, skipped: true, code: "email_disabled" });
  }

  const clientId = asTrimmedString(appointment.client_id);
  if (!clientId) {
    return jsonResponse({ ok: true, skipped: true, code: "missing_client" });
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
  const clientEmailOptedIn = Boolean(client?.email_opt_in);

  if (!client) {
    return jsonResponse({ ok: true, skipped: true, code: "missing_client" }, 400);
  }

  const { data: recipientRows, error: recipientError } = await serviceClient
    .from("appointment_message_recipients")
    .select("client_contact_id, contact_name, relationship, email, send_email")
    .eq("appointment_id", appointmentId)
    .eq("user_id", user.id)
    .eq("send_email", true);

  if (recipientError) {
    return jsonError(recipientError, 500, { code: "recipient_lookup_failed" });
  }

  const emailRecipients = ((recipientRows || []) as JsonObject[])
    .map((recipient) => ({
      contactId: asTrimmedString(recipient.client_contact_id) || null,
      name: asTrimmedString(recipient.contact_name) || asTrimmedString(client.name),
      email: asTrimmedString(recipient.email).toLowerCase(),
    }))
    .filter((recipient) => recipient.email);

  if (emailRecipients.length === 0 && toEmail && clientEmailOptedIn) {
    emailRecipients.push({
      contactId: null,
      name:
        asTrimmedString(client.name) ||
        asTrimmedString(appointment.client_name) ||
        "there",
      email: toEmail,
    });
  }

  if (emailRecipients.length === 0) {
    return jsonResponse(
      {
        ok: false,
        skipped: true,
        code: toEmail ? "email_not_opted_in" : "missing_email",
      },
      400,
    );
  }

  const { businessName, businessContact } = await getBusinessName(
    serviceClient,
    user.id,
    user,
  );
  const serviceName = await getServiceNames(
    serviceClient,
    user.id,
    appointment.service_ids,
  );
  const firstEmailContent = buildEmailContent({
    messageType,
    clientName: emailRecipients[0]?.name || "there",
    businessName,
    serviceName,
    appointmentDate: asTrimmedString(appointment.appointment_date),
    appointmentTime: asTrimmedString(appointment.appointment_time),
    businessContact,
    customBody,
  });
  const subject = customSubject || firstEmailContent.subject;

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

  const conversationId = asTrimmedString(conversationResult.data);
  const sentResults: JsonObject[] = [];
  const failedResults: JsonObject[] = [];

  for (const recipient of emailRecipients) {
    const replyToken = await createReplyToken({
      serviceClient,
      accountId: user.id,
      clientId,
      appointmentId,
      conversationId,
      messageType,
    });
    const replyTo = buildReplyAddress(replyToken);
    const emailContent = buildEmailContent({
      messageType,
      clientName: recipient.name || "there",
      businessName,
      serviceName,
      appointmentDate: asTrimmedString(appointment.appointment_date),
      appointmentTime: asTrimmedString(appointment.appointment_time),
      businessContact,
      customBody,
    });
    const queuedMessage = await insertMessage({
      serviceClient,
      accountId: user.id,
      clientId,
      appointmentId,
      conversationId,
      channel: "email",
      direction: "outbound",
      sender: buildSchedovaFromHeader(businessName),
      recipient: recipient.email,
      subject,
      body: emailContent.plainText,
      status: "queued",
      provider: EMAIL_PROVIDER,
      metadata: {
        messageType,
        contactId: recipient.contactId,
        replyMode: "schedova_messages_inbox",
        replyTo,
      },
    });

    try {
    const providerResult = await sendEmail({
      to: recipient.email,
      fromName: businessName,
      subject,
      html: emailContent.html,
      text: emailContent.plainText,
      replyTo,
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

      sentResults.push({
        email: recipient.email,
        providerMessageId: providerResult.providerMessageId,
        messageId: queuedMessage.id,
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
      failedResults.push({
        email: recipient.email,
        error: getErrorMessage(error),
        messageId: queuedMessage.id,
      });
    }
  }

  if (sentResults.length > 0) {
    const sentAtColumn =
      messageType === "confirmation"
        ? "email_confirmation_sent_at"
        : messageType === "reminder"
          ? "email_reminder_sent_at"
          : null;

    if (sentAtColumn) {
      await serviceClient
        .from("appointments")
        .update({ [sentAtColumn]: new Date().toISOString() })
        .eq("id", appointmentId)
        .eq("user_id", user.id);
    }

    return jsonResponse({
      ok: true,
      sent: sentResults.length,
      failed: failedResults,
      results: sentResults,
      conversationId,
    });
  }

  return jsonError("Email provider failed for every recipient.", 502, {
    code: "email_provider_failed",
    failed: failedResults,
  });
});
