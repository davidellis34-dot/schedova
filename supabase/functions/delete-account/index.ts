import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
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

function isMissingTableError(error: { code?: string; message?: string }) {
  const message = String(error.message || "").toLowerCase();
  return (
    error.code === "42P01" ||
    error.code === "PGRST205" ||
    message.includes("could not find the table") ||
    message.includes("does not exist")
  );
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

  const { data: requestRecord } = await serviceClient
    .from("account_deletion_requests")
    .insert({
      user_id: user.id,
      email: user.email || null,
      requested_from: "app",
      status: "processing",
    })
    .select("id")
    .maybeSingle();

  const userScopedTables = [
    "sms_message_logs",
    "message_templates",
    "sms_settings",
    "availability_rules",
    "blocked_times",
    "appointments",
    "services",
    "clients",
    "businesses",
    "user_subscriptions",
    "user_settings",
  ];

  for (const table of userScopedTables) {
    const { error } = await serviceClient
      .from(table)
      .delete()
      .eq("user_id", user.id);

    if (error && !isMissingTableError(error)) {
      if (requestRecord?.id) {
        await serviceClient
          .from("account_deletion_requests")
          .update({ status: "failed" })
          .eq("id", requestRecord.id);
      }

      return jsonResponse(
        { ok: false, message: `Could not delete ${table}: ${error.message}` },
        500,
      );
    }
  }

  if (requestRecord?.id) {
    await serviceClient
      .from("account_deletion_requests")
      .update({
        status: "completed",
        completed_at: new Date().toISOString(),
      })
      .eq("id", requestRecord.id);
  }

  const { error: deleteUserError } = await serviceClient.auth.admin.deleteUser(
    user.id,
  );

  if (deleteUserError) {
    if (requestRecord?.id) {
      await serviceClient
        .from("account_deletion_requests")
        .update({ status: "failed" })
        .eq("id", requestRecord.id);
    }

    return jsonResponse(
      { ok: false, message: deleteUserError.message, requestId: requestRecord?.id },
      500,
    );
  }

  if (requestRecord?.id) {
    await serviceClient
      .from("account_deletion_requests")
      .update({
        email: null,
        user_id: null,
        status: "completed",
        completed_at: new Date().toISOString(),
      })
      .eq("id", requestRecord.id);
  }

  return jsonResponse({
    ok: true,
    deleted: true,
    requestId: requestRecord?.id || null,
  });
});
