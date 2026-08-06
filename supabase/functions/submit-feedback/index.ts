import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

import {
  SCHEDOVA_SUPPORT_EMAIL,
  corsHeaders,
  escapeHtml,
  getErrorMessage,
  jsonResponse,
  sendEmail,
  type JsonObject,
} from "../_shared/emailMessages.ts";

const FEEDBACK_TYPES = new Set([
  "Feature request",
  "Something is confusing",
  "Report a problem",
  "Something I like",
  "Other",
]);

function readText(value: unknown, limit: number) {
  return typeof value === "string" ? value.trim().slice(0, limit) : "";
}

function readMetadata(value: unknown) {
  if (!value || typeof value !== "object") return null;
  const source = value as Record<string, unknown>;

  return {
    appVersion: readText(source.appVersion, 80) || null,
    buildNumber: readText(source.buildNumber, 80) || null,
    platform: readText(source.platform, 40) || null,
    osVersion: readText(String(source.osVersion || ""), 80) || null,
    deviceModel: readText(source.deviceModel, 120) || null,
    sourceScreen: readText(source.sourceScreen, 160) || null,
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ ok: false, error: "Method not allowed" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !supabaseAnonKey || !serviceRoleKey) {
    return jsonResponse({ ok: false, error: "Feedback service is unavailable." }, 500);
  }

  const authHeader = req.headers.get("Authorization") || "";
  const userClient = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const serviceClient = createClient(supabaseUrl, serviceRoleKey);
  const { data: { user }, error: authError } = await userClient.auth.getUser();
  if (authError || !user) return jsonResponse({ ok: false, error: "Unauthorized" }, 401);

  try {
    const body = (await req.json()) as JsonObject;
    const feedbackType = readText(body.feedbackType, 80);
    const title = readText(body.title, 160);
    const description = readText(body.description, 5000);
    const submissionKey = readText(body.submissionKey, 120);
    const metadata = readMetadata(body.metadata);

    if (
      !FEEDBACK_TYPES.has(feedbackType) ||
      !title ||
      !description ||
      !/^feedback-[a-z0-9-]{12,120}$/i.test(submissionKey)
    ) {
      return jsonResponse({ ok: false, error: "Feedback type, title, and description are required." }, 400);
    }

    const { error: insertError } = await serviceClient.from("feedback_submissions").insert({
      user_id: user.id,
      feedback_type: feedbackType,
      title,
      description,
      metadata,
      submission_key: submissionKey,
    });
    if (insertError?.code === "23505") {
      return jsonResponse({ ok: true, duplicate: true });
    }
    if (insertError) throw insertError;

    const metadataLines = metadata
      ? Object.entries(metadata)
          .filter(([, value]) => value)
          .map(([key, value]) => `${key}: ${String(value)}`)
          .join("\n")
      : "Not included";
    await sendEmail({
      to: SCHEDOVA_SUPPORT_EMAIL,
      fromName: "Schedova Feedback",
      subject: `Schedova feedback: ${title}`,
      text: `Type: ${feedbackType}\n\n${description}\n\nApp information:\n${metadataLines}`,
      html: `<h2>Schedova feedback</h2><p><strong>Type:</strong> ${escapeHtml(feedbackType)}</p><p><strong>Title:</strong> ${escapeHtml(title)}</p><p>${escapeHtml(description).replace(/\n/g, "<br />")}</p><h3>App information</h3><pre>${escapeHtml(metadataLines)}</pre>`,
      replyTo: user.email || SCHEDOVA_SUPPORT_EMAIL,
    });

    return jsonResponse({ ok: true });
  } catch (error) {
    console.log("Feedback submission failed", { error: getErrorMessage(error) });
    return jsonResponse({ ok: false, error: "Feedback could not be sent right now." }, 502);
  }
});
