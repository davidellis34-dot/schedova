import { normalizePhoneForSmsWithUserDefault } from "./countrySettings";
import { supabase } from "./supabase";

export type CommunicationRecipient = {
  id?: string | null;
  clientId?: string | null;
  name: string;
  relationship: string;
  phone: string;
  email: string;
  smsEnabled: boolean;
  emailEnabled: boolean;
  isPrimary?: boolean;
};

type ClientContactRow = {
  id: string;
  client_id: string;
  contact_name: string | null;
  relationship: string | null;
  phone: string | null;
  email: string | null;
  sms_enabled: boolean | null;
  email_enabled: boolean | null;
  is_primary: boolean | null;
};

function cleanEmail(value: string) {
  return String(value || "").trim().toLowerCase();
}

export function createPrimaryRecipient(input: {
  clientId?: string | null;
  name?: string | null;
  phone?: string | null;
  email?: string | null;
  smsOptIn?: boolean | null;
  emailOptIn?: boolean | null;
}): CommunicationRecipient {
  const phone = String(input.phone || "").trim();
  const email = String(input.email || "").trim();

  return {
    clientId: input.clientId || null,
    name: String(input.name || "").trim(),
    relationship: "",
    phone,
    email,
    smsEnabled: Boolean(input.smsOptIn && phone),
    emailEnabled: Boolean(input.emailOptIn && email),
    isPrimary: true,
  };
}

export function normalizeRecipient(row: ClientContactRow): CommunicationRecipient {
  return {
    id: row.id,
    clientId: row.client_id,
    name: String(row.contact_name || "").trim(),
    relationship: String(row.relationship || "").trim(),
    phone: String(row.phone || "").trim(),
    email: String(row.email || "").trim(),
    smsEnabled: Boolean(row.sms_enabled && row.phone),
    emailEnabled: Boolean(row.email_enabled && row.email),
    isPrimary: Boolean(row.is_primary),
  };
}

export function getSmsRecipientCount(recipients: CommunicationRecipient[]) {
  return recipients.filter(
    (recipient) => recipient.smsEnabled && String(recipient.phone || "").trim(),
  ).length;
}

export function getEmailRecipientCount(recipients: CommunicationRecipient[]) {
  return recipients.filter(
    (recipient) => recipient.emailEnabled && String(recipient.email || "").trim(),
  ).length;
}

export async function fetchClientCommunicationRecipients(input: {
  userId: string;
  clientId: string;
  primary?: {
    name?: string | null;
    phone?: string | null;
    email?: string | null;
    smsOptIn?: boolean | null;
    emailOptIn?: boolean | null;
  };
}) {
  const { data, error } = await supabase
    .from("client_contacts")
    .select(
      "id, client_id, contact_name, relationship, phone, email, sms_enabled, email_enabled, is_primary",
    )
    .eq("user_id", input.userId)
    .eq("client_id", input.clientId)
    .order("is_primary", { ascending: false })
    .order("created_at", { ascending: true });

  if (error) throw error;

  const rows = ((data || []) as ClientContactRow[]).map(normalizeRecipient);
  if (rows.length > 0) return rows;

  return [
    createPrimaryRecipient({
      clientId: input.clientId,
      name: input.primary?.name,
      phone: input.primary?.phone,
      email: input.primary?.email,
      smsOptIn: input.primary?.smsOptIn,
      emailOptIn: input.primary?.emailOptIn,
    }),
  ];
}

export async function saveClientCommunicationRecipients(input: {
  userId: string;
  clientId: string;
  recipients: CommunicationRecipient[];
}) {
  const normalizedRecipients = await Promise.all(
    input.recipients
      .map((recipient, index) => ({
        ...recipient,
        name: String(recipient.name || "").trim(),
        relationship: String(recipient.relationship || "").trim(),
        phone: String(recipient.phone || "").trim(),
        email: cleanEmail(recipient.email || ""),
        isPrimary: index === 0 ? true : Boolean(recipient.isPrimary),
      }))
      .filter((recipient) => recipient.name || recipient.phone || recipient.email)
      .map(async (recipient) => ({
        ...recipient,
        phone: recipient.phone
          ? await normalizePhoneForSmsWithUserDefault(recipient.phone)
          : "",
      })),
  );

  const existingIds = normalizedRecipients
    .map((recipient) => String(recipient.id || "").trim())
    .filter(Boolean);

  if (existingIds.length > 0) {
    const { error: deleteMissingError } = await supabase
      .from("client_contacts")
      .delete()
      .eq("user_id", input.userId)
      .eq("client_id", input.clientId)
      .not("id", "in", `(${existingIds.join(",")})`);

    if (deleteMissingError) throw deleteMissingError;
  } else {
    const { error: deleteAllError } = await supabase
      .from("client_contacts")
      .delete()
      .eq("user_id", input.userId)
      .eq("client_id", input.clientId);

    if (deleteAllError) throw deleteAllError;
  }

  for (const recipient of normalizedRecipients) {
    const payload = {
      user_id: input.userId,
      client_id: input.clientId,
      contact_name: recipient.name || "Contact",
      relationship: recipient.relationship || null,
      phone: recipient.phone || null,
      email: recipient.email || null,
      sms_enabled: Boolean(recipient.smsEnabled && recipient.phone),
      email_enabled: Boolean(recipient.emailEnabled && recipient.email),
      sms_consent_at:
        recipient.smsEnabled && recipient.phone ? new Date().toISOString() : null,
      email_consent_at:
        recipient.emailEnabled && recipient.email ? new Date().toISOString() : null,
      is_primary: Boolean(recipient.isPrimary),
    };

    if (recipient.id) {
      const { error } = await supabase
        .from("client_contacts")
        .update(payload)
        .eq("id", recipient.id)
        .eq("user_id", input.userId)
        .eq("client_id", input.clientId);

      if (error) throw error;
      continue;
    }

    const { error } = await supabase.from("client_contacts").insert(payload);
    if (error) throw error;
  }

  return normalizedRecipients;
}

export async function saveAppointmentCommunicationRecipients(input: {
  userId: string;
  clientId: string | null;
  appointmentId: string;
  recipients: CommunicationRecipient[];
}) {
  await supabase
    .from("appointment_message_recipients")
    .delete()
    .eq("appointment_id", input.appointmentId)
    .eq("user_id", input.userId);

  const rows = input.recipients
    .filter(
      (recipient) =>
        (recipient.smsEnabled && recipient.phone) ||
        (recipient.emailEnabled && recipient.email),
    )
    .map((recipient) => ({
      appointment_id: input.appointmentId,
      user_id: input.userId,
      client_id: input.clientId || null,
      client_contact_id: recipient.id || null,
      contact_name: recipient.name || "Contact",
      relationship: recipient.relationship || null,
      phone: recipient.phone || null,
      email: cleanEmail(recipient.email || "") || null,
      send_sms: Boolean(recipient.smsEnabled && recipient.phone),
      send_email: Boolean(recipient.emailEnabled && recipient.email),
    }));

  if (rows.length === 0) return;

  const { error } = await supabase
    .from("appointment_message_recipients")
    .insert(rows);

  if (error) throw error;
}

export async function sendConsentRequests(input: {
  clientId: string;
  recipients: CommunicationRecipient[];
}) {
  const selectedRecipients = input.recipients.filter(
    (recipient) =>
      (recipient.smsEnabled && recipient.phone) ||
      (recipient.emailEnabled && recipient.email),
  );

  if (selectedRecipients.length === 0) {
    return { ok: false, code: "no_recipients" };
  }

  const { data, error } = await supabase.functions.invoke(
    "send-communication-consent",
    {
      body: {
        clientId: input.clientId,
        recipients: selectedRecipients.map((recipient) => ({
          contactId: recipient.id || null,
          name: recipient.name,
          relationship: recipient.relationship,
          phone: recipient.phone,
          email: recipient.email,
          sms: recipient.smsEnabled,
          emailOptIn: recipient.emailEnabled,
        })),
      },
    },
  );

  if (error) throw error;

  return data as {
    ok?: boolean;
    code?: string;
    sent?: number;
    failures?: unknown[];
  };
}
