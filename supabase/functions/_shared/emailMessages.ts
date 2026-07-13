export type JsonObject = Record<string, unknown>;

export type EmailMessageType =
  | "confirmation"
  | "update"
  | "cancellation"
  | "reminder"
  | "manual";

export type SupabaseServiceClient = any;

export const EMAIL_PROVIDER = "resend";
export const DEFAULT_RESEND_EMAIL_URL = "https://api.resend.com/emails";
export const SCHEDOVA_SUPPORT_EMAIL = "support@schedova.com";
export const SCHEDOVA_REPLY_DOMAIN = "reply.schedova.com";

export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-schedova-signature, svix-id, svix-timestamp, svix-signature",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

export function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
    },
  });
}

export function asTrimmedString(value: unknown) {
  return String(value || "").trim();
}

export function normalize(value: unknown) {
  return asTrimmedString(value).toLowerCase();
}

export function asNullableUuid(value: unknown) {
  const text = asTrimmedString(value);
  if (!text) return null;

  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    text,
  )
    ? text
    : null;
}

export function getErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message || error.name || "Unknown error";

  if (error && typeof error === "object" && "message" in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string" && message.trim()) return message;
  }

  return String(error || "Unknown error");
}

export function serializeDetails(details: unknown): unknown {
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

export function safeParseJson(text: string) {
  if (!text.trim()) return null;

  try {
    return JSON.parse(text) as JsonObject;
  } catch {
    return null;
  }
}

export function isOpenOrFuture(value: string | null | undefined) {
  if (!value) return true;

  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) && timestamp > Date.now();
}

type UserSubscription = {
  status?: string | null;
  plan?: string | null;
  entitlement?: string | null;
  entitlement_source?: string | null;
  entitlement_expires_at?: string | null;
};

export function hasSchedovaProAccess(
  subscription: UserSubscription | null | undefined,
) {
  if (!subscription) return false;

  const status = normalize(subscription.status);
  const plan = normalize(subscription.plan);
  const entitlement = normalize(subscription.entitlement);
  const source = normalize(subscription.entitlement_source);

  const adminLifetime =
    status === "active" &&
    plan === "lifetime" &&
    entitlement === "schedova_pro" &&
    ["admin", "manual"].includes(source) &&
    !subscription.entitlement_expires_at;

  const revenueCatStyle =
    status === "active" &&
    entitlement === "schedova_pro" &&
    isOpenOrFuture(subscription.entitlement_expires_at);

  return adminLifetime || revenueCatStyle;
}

export async function userHasSchedovaPro(
  serviceClient: SupabaseServiceClient,
  userId: string,
) {
  const { data, error } = await serviceClient
    .from("user_subscriptions")
    .select("status, plan, entitlement, entitlement_source, entitlement_expires_at")
    .eq("user_id", userId);

  if (error) throw error;

  return ((data || []) as UserSubscription[]).some(hasSchedovaProAccess);
}

export function formatAppointmentTime(value: unknown) {
  const raw = asTrimmedString(value).slice(0, 5);
  if (!raw) return "your appointment time";

  const [hourText, minuteText = "00"] = raw.split(":");
  let hour = Number(hourText);
  const minute = minuteText.padStart(2, "0");

  if (!Number.isFinite(hour)) return raw;

  const suffix = hour >= 12 ? "PM" : "AM";
  hour = hour % 12 || 12;

  return `${hour}:${minute} ${suffix}`;
}

export function formatAppointmentDate(value: unknown) {
  const raw = asTrimmedString(value);
  if (!raw) return "your appointment date";

  const date = new Date(`${raw}T12:00:00`);
  if (Number.isNaN(date.getTime())) return raw;

  return date.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function escapeHtml(value: unknown) {
  return asTrimmedString(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function textToSafeHtml(value: string) {
  return escapeHtml(value).replace(/\n/g, "<br />");
}

export function stripUnsafeHtml(value: unknown) {
  return asTrimmedString(value)
    .replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?>[\s\S]*?<\/style>/gi, "")
    .replace(/on\w+="[^"]*"/gi, "")
    .replace(/on\w+='[^']*'/gi, "")
    .replace(/javascript:/gi, "");
}

export function sanitizeEmailDisplayName(value: unknown) {
  return asTrimmedString(value)
    .replace(/[\r\n]/g, " ")
    .replace(/[<>]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function buildSchedovaFromHeader(businessName: unknown) {
  const cleanBusinessName = sanitizeEmailDisplayName(businessName) || "Schedova";
  const displayName = `${cleanBusinessName} via Schedova`;
  const escapedDisplayName = displayName.replace(/\\/g, "\\\\").replace(/"/g, '\\"');

  return `"${escapedDisplayName}" <${SCHEDOVA_SUPPORT_EMAIL}>`;
}

export function htmlToPlainText(value: unknown) {
  return stripUnsafeHtml(value)
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function stripQuotedReply(value: string) {
  const lines = value.replace(/\r\n/g, "\n").split("\n");
  const cutIndex = lines.findIndex((line) => {
    const clean = line.trim();
    return (
      /^On .+ wrote:$/i.test(clean) ||
      /^From:/i.test(clean) ||
      /^-{2,}\s*Original Message\s*-{2,}$/i.test(clean) ||
      /^>/.test(clean)
    );
  });
  const trimmed = (cutIndex >= 0 ? lines.slice(0, cutIndex) : lines).join("\n");

  return trimmed
    .replace(/\n--\s*\n[\s\S]*$/m, "")
    .replace(/\nSent from my .+$/im, "")
    .trim();
}

export function buildEmailContent(input: {
  messageType: EmailMessageType;
  clientName: string;
  businessName: string;
  serviceName?: string | null;
  appointmentDate?: string | null;
  appointmentTime?: string | null;
  businessContact?: string | null;
  customBody?: string | null;
}) {
  const clientName = input.clientName || "there";
  const businessName = input.businessName || "Schedova";
  const date = formatAppointmentDate(input.appointmentDate);
  const time = formatAppointmentTime(input.appointmentTime);
  const serviceText = input.serviceName ? ` for ${input.serviceName}` : "";
  const customBody = asTrimmedString(input.customBody);

  let subject = `${businessName} appointment`;
  let intro = `Hi ${clientName},`;
  let body = customBody;

  if (!body) {
    switch (input.messageType) {
      case "confirmation":
        subject = `Appointment confirmation from ${businessName}`;
        body = `Confirming your appointment${serviceText} on ${date} at ${time}. Reply to this email if you need to make a change.`;
        break;
      case "update":
        subject = `Appointment update from ${businessName}`;
        body = `Your appointment${serviceText} has been updated to ${date} at ${time}. Reply to this email if you have any questions.`;
        break;
      case "cancellation":
        subject = `Appointment cancellation from ${businessName}`;
        body = `Your appointment${serviceText} on ${date} at ${time} has been canceled. Reply to this email if you need help rescheduling.`;
        break;
      case "reminder":
        subject = `Appointment reminder from ${businessName}`;
        body = `This is a reminder for your appointment${serviceText} on ${date} at ${time}. Reply to this email if you need to make a change.`;
        break;
      case "manual":
        subject = `Message from ${businessName}`;
        body = "Reply to this email if you need anything.";
        break;
    }
  }

  const contact = asTrimmedString(input.businessContact);
  const plainText = [intro, "", body, "", contact ? `Contact: ${contact}` : ""]
    .filter((part) => part !== "")
    .join("\n");

  const html = `
    <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f6fbfb;padding:24px;color:#0f172a;">
      <div style="max-width:560px;margin:0 auto;background:#ffffff;border:1px solid #dbe7e7;border-radius:16px;overflow:hidden;">
        <div style="background:#0f2f3a;color:#ffffff;padding:20px 24px;">
          <div style="font-size:20px;font-weight:800;">${escapeHtml(businessName)}</div>
          <div style="font-size:13px;color:#9ee7df;margin-top:4px;">Appointment message</div>
        </div>
        <div style="padding:24px;">
          <p style="font-size:16px;line-height:24px;margin:0 0 16px;">${escapeHtml(intro)}</p>
          <p style="font-size:16px;line-height:24px;margin:0 0 20px;">${textToSafeHtml(body)}</p>
          <div style="border:1px solid #dbe7e7;border-radius:12px;padding:14px;margin:20px 0;background:#f8fbfb;">
            <div style="font-size:13px;color:#475569;margin-bottom:6px;">Appointment</div>
            <div style="font-size:16px;font-weight:700;color:#0f172a;">${escapeHtml(date)} at ${escapeHtml(time)}</div>
            ${input.serviceName ? `<div style="font-size:14px;color:#475569;margin-top:6px;">${escapeHtml(input.serviceName)}</div>` : ""}
          </div>
          ${contact ? `<p style="font-size:14px;line-height:22px;color:#475569;margin:0;">Contact: ${escapeHtml(contact)}</p>` : ""}
        </div>
      </div>
    </div>
  `;

  return { subject, html, plainText };
}

export async function getBusinessName(
  serviceClient: SupabaseServiceClient,
  userId: string,
) {
  const { data } = await serviceClient
    .from("business_profiles")
    .select("business_name, phone, email")
    .eq("user_id", userId)
    .maybeSingle();

  const row = (data || {}) as JsonObject;

  return {
    businessName:
      asTrimmedString(row.business_name) || "your business",
    businessContact:
      [asTrimmedString(row.phone), asTrimmedString(row.email)]
        .filter(Boolean)
        .join(" / ") || null,
  };
}

export async function getServiceNames(
  serviceClient: SupabaseServiceClient,
  userId: string,
  serviceIds: unknown,
) {
  const ids = Array.isArray(serviceIds)
    ? serviceIds.map(asTrimmedString).filter(Boolean)
    : [];

  if (ids.length === 0) return null;

  const { data, error } = await serviceClient
    .from("services")
    .select("id, name")
    .eq("user_id", userId)
    .in("id", ids);

  if (error) {
    console.error("service lookup for email failed", { userId, error });
    return null;
  }

  const names = ((data || []) as JsonObject[])
    .map((row) => asTrimmedString(row.name))
    .filter(Boolean);

  return names.join(", ") || null;
}

export function generateReplyToken() {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export async function createReplyToken(input: {
  serviceClient: SupabaseServiceClient;
  accountId: string;
  clientId: string | null;
  appointmentId: string | null;
  conversationId: string | null;
  messageType: string;
}) {
  const token = generateReplyToken();

  const { error } = await input.serviceClient.from("email_reply_tokens").insert({
    token,
    account_id: input.accountId,
    client_id: asNullableUuid(input.clientId),
    appointment_id: asNullableUuid(input.appointmentId),
    conversation_id: asNullableUuid(input.conversationId),
    message_type: input.messageType,
    expires_at: new Date(Date.now() + 180 * 24 * 60 * 60 * 1000).toISOString(),
  });

  if (error) throw error;

  return token;
}

export async function sendEmail(input: {
  to: string;
  fromName: string;
  subject: string;
  html: string;
  text: string;
  replyTo: string;
}) {
  const apiKey = Deno.env.get("RESEND_API_KEY") || Deno.env.get("EMAIL_PROVIDER_API_KEY");
  const apiUrl = Deno.env.get("EMAIL_PROVIDER_API_URL") || DEFAULT_RESEND_EMAIL_URL;
  const fromEmail = buildSchedovaFromHeader(input.fromName);

  if (!apiKey) {
    throw new Error("Email provider API key is not configured.");
  }

  const response = await fetch(apiUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: fromEmail,
      to: [input.to],
      subject: input.subject,
      html: input.html,
      text: input.text,
      reply_to: input.replyTo,
    }),
  });
  const responseText = await response.text();
  const responseBody = safeParseJson(responseText) || { raw: responseText };

  if (!response.ok) {
    console.error("email provider send failed", {
      status: response.status,
      body: responseBody,
    });
    throw new Error(`Email provider failed with HTTP ${response.status}`);
  }

  const providerMessageId =
    asTrimmedString((responseBody as JsonObject).id) ||
    asTrimmedString(((responseBody as JsonObject).data as JsonObject | undefined)?.id) ||
    null;

  return {
    providerMessageId,
    providerResponse: responseBody,
  };
}

export async function insertMessage(input: {
  serviceClient: SupabaseServiceClient;
  accountId: string;
  clientId: string | null;
  appointmentId: string | null;
  conversationId?: string | null;
  channel: "sms" | "email";
  direction: "inbound" | "outbound";
  sender: string | null;
  recipient: string | null;
  subject: string | null;
  body: string | null;
  status: string;
  provider: string;
  providerMessageId?: string | null;
  providerResponse?: unknown;
  readAt?: string | null;
  needsAttention?: boolean;
  attentionReason?: string | null;
  metadata?: JsonObject;
  createdAt?: string | null;
}) {
  const conversationId =
    input.conversationId ||
    (await input.serviceClient.rpc("upsert_message_conversation", {
      p_account_id: input.accountId,
      p_client_id: asNullableUuid(input.clientId),
      p_appointment_id: asNullableUuid(input.appointmentId),
      p_subject: input.subject,
    })).data ||
    null;

  const { data, error } = await input.serviceClient
    .from("messages")
    .insert({
      account_id: input.accountId,
      client_id: asNullableUuid(input.clientId),
      appointment_id: asNullableUuid(input.appointmentId),
      conversation_id: asNullableUuid(conversationId),
      channel: input.channel,
      direction: input.direction,
      sender: input.sender,
      recipient: input.recipient,
      subject: input.subject,
      body: input.body,
      status: input.status,
      provider: input.provider,
      provider_message_id: input.providerMessageId || null,
      provider_response: serializeDetails(input.providerResponse),
      read_at: input.readAt || null,
      needs_attention: Boolean(input.needsAttention),
      attention_reason: input.attentionReason || null,
      metadata: input.metadata || {},
      created_at: input.createdAt || new Date().toISOString(),
    })
    .select("id, conversation_id")
    .maybeSingle();

  if (error) throw error;

  return {
    id: asTrimmedString((data as JsonObject | null)?.id) || null,
    conversationId:
      asTrimmedString((data as JsonObject | null)?.conversation_id) ||
      asTrimmedString(conversationId) ||
      null,
  };
}

export async function sendClientReplyPushNotifications(
  serviceClient: SupabaseServiceClient,
  input: {
    userId: string;
    clientId: string | null;
    appointmentId: string | null;
    messageId: string | null;
    clientName: string | null;
    messageBody: string;
  },
) {
  const { data: tokenRows, error } = await serviceClient
    .from("user_push_tokens")
    .select("expo_push_token")
    .eq("user_id", input.userId)
    .order("last_seen_at", { ascending: false });

  if (error) {
    console.error("email reply push token lookup failed", {
      userId: input.userId,
      error,
    });
    return;
  }

  const tokens = ((tokenRows || []) as JsonObject[])
    .map((row) => asTrimmedString(row.expo_push_token))
    .filter(Boolean);

  if (tokens.length === 0) return;

  const preview = input.messageBody.replace(/\s+/g, " ").trim().slice(0, 110);
  const body = input.clientName ? `${input.clientName}: ${preview}` : preview;

  await fetch("https://exp.host/--/api/v2/push/send", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(
      tokens.map((token) => ({
        to: token,
        title: "New client email",
        body,
        sound: "default",
        channelId: "client-messages",
        data: {
          type: "client_message",
          messageId: input.messageId,
          replyId: input.messageId,
          clientId: input.clientId,
          appointmentId: input.appointmentId,
        },
      })),
    ),
  }).catch((pushError) => {
    console.error("email reply push failed", {
      userId: input.userId,
      error: pushError,
    });
  });
}
