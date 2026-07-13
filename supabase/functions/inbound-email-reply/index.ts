import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

import {
  asTrimmedString,
  corsHeaders,
  getErrorMessage,
  htmlToPlainText,
  insertMessage,
  jsonResponse,
  safeParseJson,
  sendClientReplyPushNotifications,
  serializeDetails,
  stripQuotedReply,
  stripUnsafeHtml,
  type JsonObject,
} from "../_shared/emailMessages.ts";

const EMAIL_PROVIDER = "resend";

function toHex(buffer: ArrayBuffer) {
  return Array.from(new Uint8Array(buffer))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function timingSafeEqual(left: string, right: string) {
  if (left.length !== right.length) return false;

  let result = 0;
  for (let index = 0; index < left.length; index += 1) {
    result |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }

  return result === 0;
}

async function verifyWebhookSignature(req: Request, rawBody: string) {
  const secret = Deno.env.get("EMAIL_WEBHOOK_SECRET");
  if (!secret) {
    console.error("EMAIL_WEBHOOK_SECRET is missing");
    return false;
  }

  const signatureHeader =
    req.headers.get("x-schedova-signature") ||
    req.headers.get("x-email-signature") ||
    "";
  const signature = signatureHeader.replace(/^sha256=/i, "").trim();

  if (!signature) {
    console.error("email webhook signature missing");
    return false;
  }

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const expected = toHex(
    await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(rawBody)),
  );

  return timingSafeEqual(expected, signature);
}

function asObject(value: unknown): JsonObject {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonObject)
    : {};
}

function firstString(...values: unknown[]): string {
  for (const value of values) {
    if (Array.isArray(value)) {
      const nested: string = firstString(...value);
      if (nested) return nested;
      continue;
    }

    const text = asTrimmedString(value);
    if (text) return text;
  }

  return "";
}

function extractEmailAddress(value: unknown) {
  const text = firstString(value);
  const match = /<([^>]+)>/.exec(text);
  return (match?.[1] || text).trim().toLowerCase();
}

function extractTokenFromAddress(value: unknown) {
  const all = Array.isArray(value) ? value : [value];

  for (const item of all) {
    const address = extractEmailAddress(item);
    const match = /(?:^|[<,\s])reply\+([a-z0-9]+)@/i.exec(address);
    if (match?.[1]) return match[1];
  }

  return "";
}

function extractInboundEmail(payload: JsonObject) {
  const data = asObject(payload.data);
  const email = asObject(data.email || payload.email);
  const message = asObject(data.message || payload.message);
  const inbound = Object.keys(email).length ? email : Object.keys(message).length ? message : payload;
  const from = extractEmailAddress(
    inbound.from || inbound.from_email || payload.from || payload.sender,
  );
  const to =
    inbound.to ||
    inbound.recipients ||
    payload.to ||
    payload.recipients ||
    asObject(inbound.headers).to;
  const subject = firstString(inbound.subject, payload.subject);
  const textBody = firstString(
    inbound.text,
    inbound.text_body,
    inbound.body_text,
    payload.text,
    payload.text_body,
  );
  const htmlBody = firstString(
    inbound.html,
    inbound.html_body,
    inbound.body_html,
    payload.html,
    payload.html_body,
  );
  const rawBody = textBody || htmlToPlainText(htmlBody);
  const cleanBody = stripQuotedReply(rawBody);
  const token =
    extractTokenFromAddress(to) ||
    extractTokenFromAddress(inbound.reply_to) ||
    extractTokenFromAddress(payload.recipient);
  const providerMessageId = firstString(
    inbound.message_id,
    inbound.id,
    data.id,
    payload.message_id,
    payload.id,
  );

  return {
    token,
    from,
    to: extractEmailAddress(to),
    subject,
    body: cleanBody,
    html: stripUnsafeHtml(htmlBody),
    providerMessageId,
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") {
    return jsonResponse({ ok: false, error: "Method not allowed" }, 405);
  }

  const rawBody = await req.text();

  if (!(await verifyWebhookSignature(req, rawBody))) {
    return jsonResponse({ ok: false, error: "Unauthorized" }, 401);
  }

  const parsed = safeParseJson(rawBody);
  if (!parsed) {
    return jsonResponse({ ok: false, error: "Invalid JSON" }, 400);
  }

  const inbound = extractInboundEmail(parsed);
  if (!inbound.token) {
    console.error("email reply token missing", {
      providerMessageId: inbound.providerMessageId,
      from: inbound.from,
    });
    return jsonResponse({ ok: true, skipped: true, code: "missing_token" });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!supabaseUrl || !serviceRoleKey) {
    return jsonResponse({ ok: false, error: "Supabase environment missing" }, 500);
  }

  const serviceClient = createClient(supabaseUrl, serviceRoleKey);

  if (inbound.providerMessageId) {
    const { data: existingMessage } = await serviceClient
      .from("messages")
      .select("id")
      .eq("provider", EMAIL_PROVIDER)
      .eq("provider_message_id", inbound.providerMessageId)
      .maybeSingle();

    if (existingMessage?.id) {
      return jsonResponse({
        ok: true,
        skipped: true,
        code: "duplicate_provider_message",
      });
    }
  }

  const { data: tokenRow, error: tokenError } = await serviceClient
    .from("email_reply_tokens")
    .select("account_id, client_id, appointment_id, conversation_id, expires_at")
    .eq("token", inbound.token)
    .maybeSingle();

  if (tokenError) {
    console.error("email reply token lookup failed", {
      error: tokenError,
      token: inbound.token,
    });
    return jsonResponse({ ok: true });
  }

  const tokenContext = (tokenRow || null) as JsonObject | null;
  if (!tokenContext?.account_id) {
    return jsonResponse({ ok: true, skipped: true, code: "unknown_token" });
  }

  if (
    tokenContext.expires_at &&
    new Date(asTrimmedString(tokenContext.expires_at)).getTime() < Date.now()
  ) {
    return jsonResponse({ ok: true, skipped: true, code: "expired_token" });
  }

  let clientName: string | null = null;
  if (tokenContext.client_id) {
    const { data: clientData } = await serviceClient
      .from("clients")
      .select("name")
      .eq("id", tokenContext.client_id)
      .eq("user_id", tokenContext.account_id)
      .maybeSingle();
    clientName = asTrimmedString((clientData as JsonObject | null)?.name) || null;
  }

  try {
    const inserted = await insertMessage({
      serviceClient,
      accountId: asTrimmedString(tokenContext.account_id),
      clientId: asTrimmedString(tokenContext.client_id) || null,
      appointmentId: asTrimmedString(tokenContext.appointment_id) || null,
      conversationId: asTrimmedString(tokenContext.conversation_id) || null,
      channel: "email",
      direction: "inbound",
      sender: inbound.from || null,
      recipient: inbound.to || null,
      subject: inbound.subject || null,
      body: inbound.body || htmlToPlainText(inbound.html) || "No email body",
      status: "received",
      provider: EMAIL_PROVIDER,
      providerMessageId: inbound.providerMessageId || null,
      providerResponse: parsed,
      readAt: null,
      needsAttention: true,
      attentionReason: "Client replied by email",
      metadata: {
        replyToken: inbound.token,
        sanitizedHtmlAvailable: Boolean(inbound.html),
      },
    });

    await serviceClient
      .from("appointments")
      .update({
        needs_attention: true,
        attention_reason: `Client replied by email: ${(inbound.body || "").slice(0, 120)}`,
      })
      .eq("id", tokenContext.appointment_id)
      .eq("user_id", tokenContext.account_id);

    await sendClientReplyPushNotifications(serviceClient, {
      userId: asTrimmedString(tokenContext.account_id),
      clientId: asTrimmedString(tokenContext.client_id) || null,
      appointmentId: asTrimmedString(tokenContext.appointment_id) || null,
      messageId: inserted.id,
      clientName,
      messageBody: inbound.body || "A client replied by email.",
    });

    return jsonResponse({
      ok: true,
      messageId: inserted.id,
      conversationId: inserted.conversationId,
    });
  } catch (error) {
    console.error("inbound email processing failed", {
      error: serializeDetails(error),
      message: getErrorMessage(error),
      providerMessageId: inbound.providerMessageId,
    });
    return jsonResponse({ ok: true });
  }
});
