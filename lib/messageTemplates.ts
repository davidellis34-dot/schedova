import { supabase } from "./supabase";

export type MessageTemplateSource = "builtin" | "custom";

export type MessageTemplate = {
  id: string;
  title: string;
  body: string;
  category?: string | null;
  source: MessageTemplateSource;
  created_at?: string | null;
  updated_at?: string | null;
};

export type MessageTemplateValues = {
  client_name?: string | null;
  appointment_date?: string | null;
  appointment_time?: string | null;
  service_name?: string | null;
  business_name?: string | null;
  add_to_schedova_link?: string | null;
};

export const MESSAGE_TEMPLATE_VARIABLES = [
  "{client_name}",
  "{appointment_date}",
  "{appointment_time}",
  "{service_name}",
  "{business_name}",
  "{add_to_schedova_link}",
] as const;

export const BUILT_IN_MESSAGE_TEMPLATES: MessageTemplate[] = [
  {
    id: "builtin_confirmation",
    title: "Appointment confirmation",
    category: "Confirmation",
    source: "builtin",
    body:
      "Hi {client_name}, confirming your appointment for {appointment_date} at {appointment_time}. Reply here if you need to make a change.",
  },
  {
    id: "builtin_running_late",
    title: "Running late",
    category: "Update",
    source: "builtin",
    body:
      "Hi {client_name}, I am running a few minutes late and will update you if that changes. Thank you for your patience.",
  },
  {
    id: "builtin_cancellation",
    title: "Cancellation/reschedule",
    category: "Update",
    source: "builtin",
    body:
      "Hi {client_name}, we need to cancel or reschedule your appointment on {appointment_date}. Please reply with a time that works for you.",
  },
];

type MessageTemplateRow = {
  id: string;
  title: string | null;
  body: string | null;
  category?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
};

function normalizeTemplate(row: MessageTemplateRow): MessageTemplate {
  return {
    id: row.id,
    title: row.title?.trim() || "Untitled template",
    body: row.body || "",
    category: row.category,
    source: "custom",
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export async function fetchCustomMessageTemplates(userId: string) {
  const { data, error } = await supabase
    .from("message_templates")
    .select("id, title, body, category, created_at, updated_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });

  if (error) throw error;

  return ((data || []) as MessageTemplateRow[]).map(normalizeTemplate);
}

export async function createCustomMessageTemplate(input: {
  userId: string;
  title: string;
  body: string;
  category?: string | null;
}) {
  const { data, error } = await supabase
    .from("message_templates")
    .insert({
      user_id: input.userId,
      title: input.title,
      body: input.body,
      category: input.category || null,
      source: "custom",
    })
    .select("id, title, body, category, created_at, updated_at")
    .single();

  if (error) throw error;

  return normalizeTemplate(data as MessageTemplateRow);
}

export async function updateCustomMessageTemplate(input: {
  id: string;
  userId: string;
  title: string;
  body: string;
  category?: string | null;
}) {
  const { data, error } = await supabase
    .from("message_templates")
    .update({
      title: input.title,
      body: input.body,
      category: input.category || null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", input.id)
    .eq("user_id", input.userId)
    .select("id, title, body, category, created_at, updated_at")
    .single();

  if (error) throw error;

  return normalizeTemplate(data as MessageTemplateRow);
}

export async function deleteCustomMessageTemplate(input: {
  id: string;
  userId: string;
}) {
  const { error } = await supabase
    .from("message_templates")
    .delete()
    .eq("id", input.id)
    .eq("user_id", input.userId);

  if (error) throw error;
}

export function renderMessageTemplate(
  body: string,
  values: MessageTemplateValues,
) {
  return body.replace(
    /\{(client_name|appointment_date|appointment_time|service_name|business_name|add_to_schedova_link)\}/g,
    (placeholder, key: keyof MessageTemplateValues) => {
      const value = values[key];
      return value ? String(value) : placeholder;
    },
  );
}

export function getMessageTemplatePreview(body: string, length = 96) {
  const normalized = body.replace(/\s+/g, " ").trim();
  if (normalized.length <= length) return normalized;

  return `${normalized.slice(0, length - 1).trim()}...`;
}
