import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

import {
  asTrimmedString,
  corsHeaders,
  getBusinessName,
  getErrorMessage,
  jsonResponse,
  safeParseJson,
  sendEmail,
  serializeDetails,
  userHasSchedovaPro,
  type JsonObject,
} from "../_shared/emailMessages.ts";

function generateToken() {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

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

function getConsentUrl(token: string) {
  const baseUrl =
    Deno.env.get("COMMUNICATION_CONSENT_URL") ||
    `${Deno.env.get("SUPABASE_URL")}/functions/v1/communication-consent`;

  return `${baseUrl}${baseUrl.includes("?") ? "&" : "?"}token=${encodeURIComponent(token)}`;
}

async function sendSmsConsent(input: {
  toPhone: string;
  businessName: string;
  consentUrl: string;
}) {
  const telnyxApiKey = Deno.env.get("TELNYX_API_KEY");
  const telnyxFromNumber = Deno.env.get("TELNYX_FROM_NUMBER");
  const telnyxMessagingProfileId = Deno.env.get("TELNYX_MESSAGING_PROFILE_ID");

  if (!telnyxApiKey || !telnyxFromNumber || !telnyxMessagingProfileId) {
    throw new Error("SMS provider is not configured.");
  }

  const response = await fetch("https://api.telnyx.com/v2/messages", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${telnyxApiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: telnyxFromNumber,
      to: input.toPhone,
      text: `${input.businessName} would like to send appointment messages. Confirm your preferences: ${input.consentUrl}`,
      messaging_profile_id: telnyxMessagingProfileId,
    }),
  });
  const text = await response.text();

  if (!response.ok) {
    throw new Error(`Telnyx consent SMS failed with HTTP ${response.status}: ${text.slice(0, 160)}`);
  }

  return safeParseJson(text) || { raw: text };
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
    return jsonError("Supabase environment is not configured.", 500);
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
  const recipients = Array.isArray(body.recipients)
    ? (body.recipients as JsonObject[])
    : [];

  if (!clientId || recipients.length === 0) {
    return jsonError("Client and recipients are required.", 400, {
      code: "invalid_request",
    });
  }

  const requestsEmail = recipients.some(
    (recipient) =>
      Boolean(recipient.emailOptIn) && Boolean(asTrimmedString(recipient.email)),
  );

  if (requestsEmail) {
    const isPro = await userHasSchedovaPro(serviceClient, user.id);
    if (!isPro) {
      return jsonResponse({ ok: false, code: "not_paid" }, 402);
    }
  }

  const { businessName } = await getBusinessName(serviceClient, user.id);
  const ownerReplyTo = asTrimmedString(user.email) || "support@schedova.com";
  let sent = 0;
  const failures: JsonObject[] = [];

  for (const recipient of recipients) {
    const contactId = asTrimmedString(recipient.contactId);
    const phone = asTrimmedString(recipient.phone);
    const email = asTrimmedString(recipient.email).toLowerCase();
    const requestSms = Boolean(recipient.sms && phone);
    const requestEmail = Boolean(recipient.emailOptIn && email);

    if (!requestSms && !requestEmail) continue;

    const token = generateToken();
    const { error: tokenError } = await serviceClient
      .from("communication_consent_tokens")
      .insert({
        token,
        user_id: user.id,
        client_id: clientId,
        client_contact_id: contactId || null,
        requested_sms: requestSms,
        requested_email: requestEmail,
        sent_to_phone: requestSms ? phone : null,
        sent_to_email: requestEmail ? email : null,
      });

    if (tokenError) {
      failures.push({ contactId, error: tokenError.message });
      continue;
    }

    const consentUrl = getConsentUrl(token);

    if (requestEmail) {
      try {
        await sendEmail({
          to: email,
          fromName: businessName,
          subject: `${businessName} appointment message consent`,
          html: `<p>${businessName} would like to send appointment messages.</p><p><a href="${consentUrl}">Confirm your preferences</a></p>`,
          text: `${businessName} would like to send appointment messages. Confirm your preferences: ${consentUrl}`,
          replyTo: ownerReplyTo,
        });
        sent += 1;
      } catch (error) {
        failures.push({ contactId, channel: "email", error: getErrorMessage(error) });
      }
    }

    if (requestSms) {
      try {
        await sendSmsConsent({ toPhone: phone, businessName, consentUrl });
        sent += 1;
      } catch (error) {
        failures.push({ contactId, channel: "sms", error: getErrorMessage(error) });
      }
    }
  }

  return jsonResponse({ ok: true, sent, failures });
});
