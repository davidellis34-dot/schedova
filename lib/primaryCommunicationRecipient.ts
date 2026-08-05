export type PrimaryCommunicationRecipient = {
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

export function createPrimaryCommunicationRecipient(input: {
  clientId?: string | null;
  name?: string | null;
  phone?: string | null;
  email?: string | null;
  smsOptIn?: boolean | null;
  emailOptIn?: boolean | null;
}): PrimaryCommunicationRecipient {
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

export function syncPrimaryCommunicationRecipient(
  current: PrimaryCommunicationRecipient | null | undefined,
  input: {
    clientId?: string | null;
    name?: string | null;
    phone?: string | null;
    email?: string | null;
    smsOptIn?: boolean | null;
    emailOptIn?: boolean | null;
    fallbackName?: string | null;
  },
): PrimaryCommunicationRecipient {
  const phone = String(input.phone || "").trim();
  const email = String(input.email || "").trim();
  const name = String(input.name || "").trim();
  const fallbackName = String(input.fallbackName || "").trim();
  const base =
    current ||
    createPrimaryCommunicationRecipient({
      clientId: input.clientId,
    });

  return {
    ...base,
    clientId: input.clientId ?? base.clientId ?? null,
    name: name || fallbackName,
    relationship: String(base.relationship || "").trim(),
    phone,
    email,
    smsEnabled: Boolean(input.smsOptIn && phone),
    emailEnabled: Boolean(input.emailOptIn && email),
    isPrimary: true,
  };
}
