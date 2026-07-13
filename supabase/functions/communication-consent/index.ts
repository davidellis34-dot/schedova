import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

import { asTrimmedString } from "../_shared/emailMessages.ts";

function html(body: string, status = 200) {
  return new Response(body, {
    status,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

function page(message: string) {
  return `<!doctype html>
  <html>
    <head>
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <title>Schedova message consent</title>
      <style>
        body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: #f6fbfb; color: #0f172a; padding: 24px; }
        main { max-width: 520px; margin: 48px auto; background: #fff; border: 1px solid #dbe7e7; border-radius: 18px; padding: 24px; }
        h1 { margin: 0 0 12px; font-size: 28px; }
        p { line-height: 1.5; color: #475569; }
        button { width: 100%; min-height: 48px; border: 0; border-radius: 12px; background: #0f766e; color: white; font-weight: 800; font-size: 16px; }
      </style>
    </head>
    <body><main>${message}</main></body>
  </html>`;
}

Deno.serve(async (req) => {
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!supabaseUrl || !serviceRoleKey) {
    return html(page("<h1>Unable to load</h1><p>Please try again later.</p>"), 500);
  }

  const url = new URL(req.url);
  const token = asTrimmedString(url.searchParams.get("token"));
  const approve = req.method === "POST";

  if (!token) {
    return html(page("<h1>Invalid link</h1><p>This consent link is missing a token.</p>"), 400);
  }

  const serviceClient = createClient(supabaseUrl, serviceRoleKey);
  const { data: tokenRow, error } = await serviceClient
    .from("communication_consent_tokens")
    .select("id, user_id, client_id, client_contact_id, requested_sms, requested_email, expires_at, approved_sms_at, approved_email_at")
    .eq("token", token)
    .maybeSingle();

  if (error || !tokenRow) {
    return html(page("<h1>Invalid link</h1><p>This consent link could not be found.</p>"), 404);
  }

  if (new Date(tokenRow.expires_at).getTime() < Date.now()) {
    return html(page("<h1>Link expired</h1><p>Please ask the business to send a new consent request.</p>"), 410);
  }

  if (!approve) {
    return html(
      page(`<h1>Confirm appointment messages</h1>
        <p>Approve ${tokenRow.requested_sms ? "SMS" : ""}${tokenRow.requested_sms && tokenRow.requested_email ? " and " : ""}${tokenRow.requested_email ? "email" : ""} appointment messages.</p>
        <form method="post"><button type="submit">Approve messages</button></form>`),
    );
  }

  const now = new Date().toISOString();
  await serviceClient
    .from("communication_consent_tokens")
    .update({
      approved_sms_at: tokenRow.requested_sms ? now : tokenRow.approved_sms_at,
      approved_email_at: tokenRow.requested_email ? now : tokenRow.approved_email_at,
    })
    .eq("id", tokenRow.id);

  if (tokenRow.client_contact_id) {
    const contactUpdate: Record<string, unknown> = {};

    if (tokenRow.requested_sms) {
      contactUpdate.sms_enabled = true;
      contactUpdate.sms_consent_at = now;
    }

    if (tokenRow.requested_email) {
      contactUpdate.email_enabled = true;
      contactUpdate.email_consent_at = now;
    }

    await serviceClient
      .from("client_contacts")
      .update(contactUpdate)
      .eq("id", tokenRow.client_contact_id)
      .eq("user_id", tokenRow.user_id);
  } else {
    const clientUpdate: Record<string, unknown> = {};

    if (tokenRow.requested_sms) {
      clientUpdate.sms_opt_in = true;
      clientUpdate.sms_opt_in_at = now;
      clientUpdate.sms_opt_in_source = "Consent link";
    }

    if (tokenRow.requested_email) {
      clientUpdate.email_opt_in = true;
      clientUpdate.email_opt_in_at = now;
      clientUpdate.email_opt_in_source = "Consent link";
    }

    await serviceClient
      .from("clients")
      .update(clientUpdate)
      .eq("id", tokenRow.client_id)
      .eq("user_id", tokenRow.user_id);
  }

  return html(page("<h1>You are all set</h1><p>Your appointment message preferences were confirmed.</p>"));
});
