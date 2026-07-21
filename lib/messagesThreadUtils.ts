export type MessageThreadRow = {
  channel?: "sms" | "email" | null;
  client_id?: string | null;
  conversation_id?: string | null;
  created_at?: string | null;
  from_number?: string | null;
  id: string;
  recipient?: string | null;
  sender?: string | null;
  to_number?: string | null;
};

export type DraftThreadMessage = MessageThreadRow & {
  body?: string | null;
  direction?: "inbound" | "outbound" | null;
  needs_attention?: boolean | null;
  read_at?: string | null;
  resolved_at?: string | null;
};

function normalizeComparablePhone(value?: string | null) {
  return String(value || "").replace(/\D/g, "");
}

function phoneNumbersMatch(left?: string | null, right?: string | null) {
  const normalizedLeft = normalizeComparablePhone(left);
  const normalizedRight = normalizeComparablePhone(right);

  if (!normalizedLeft || !normalizedRight) return false;
  if (normalizedLeft === normalizedRight) return true;

  return (
    normalizedLeft.length >= 10 &&
    normalizedRight.length >= 10 &&
    (normalizedLeft.endsWith(normalizedRight) ||
      normalizedRight.endsWith(normalizedLeft))
  );
}

function getComparableMessagePhones(message: MessageThreadRow) {
  return [
    message.sender,
    message.recipient,
    message.from_number,
    message.to_number,
  ]
    .map((value) => normalizeComparablePhone(value))
    .filter(Boolean);
}

export function messageMatchesClientPhone(
  message: MessageThreadRow,
  normalizedClientPhone?: string | null,
) {
  const cleanClientPhone = normalizeComparablePhone(normalizedClientPhone);
  if (!cleanClientPhone) return false;

  return getComparableMessagePhones(message).some((value) =>
    phoneNumbersMatch(value, cleanClientPhone),
  );
}

export function findLatestSmsMessageForClientThread(
  rows: MessageThreadRow[],
  clientId?: string | null,
  normalizedClientPhone?: string | null,
) {
  const cleanClientId = String(clientId || "").trim();
  const smsRows = [...rows]
    .filter((row) => row.channel === "sms")
    .sort(
      (left, right) =>
        new Date(right.created_at || 0).getTime() -
        new Date(left.created_at || 0).getTime(),
    );

  const phoneMatches = normalizedClientPhone
    ? smsRows.filter((row) => messageMatchesClientPhone(row, normalizedClientPhone))
    : [];

  if (cleanClientId) {
    const clientPhoneMatches = phoneMatches.filter(
      (row) => String(row.client_id || "").trim() === cleanClientId,
    );
    if (clientPhoneMatches.length > 0) {
      return clientPhoneMatches[0];
    }
  }

  if (phoneMatches.length > 0) {
    return phoneMatches[0];
  }

  if (!cleanClientId) return null;

  return (
    smsRows.find((row) => String(row.client_id || "").trim() === cleanClientId) ||
    null
  );
}

export function buildDraftMessage(input: {
  clientId?: string | null;
  clientName?: string | null;
  phone?: string | null;
}): DraftThreadMessage {
  const cleanClientId = String(input.clientId || "").trim();
  const cleanPhone = String(input.phone || "").trim();
  const cleanClientName = String(input.clientName || "").trim();

  return {
    id: `draft-client-thread:${cleanClientId || cleanPhone || "new"}`,
    channel: "sms",
    client_id: cleanClientId || null,
    created_at: null,
    direction: null,
    from_number: null,
    needs_attention: false,
    read_at: null,
    recipient: cleanPhone || null,
    resolved_at: null,
    sender: cleanClientName || "Client",
    to_number: cleanPhone || null,
  };
}

export function resolveThreadOpenTarget(input: {
  clientId?: string | null;
  clientName?: string | null;
  clientPhone?: string | null;
  loadedClientName?: string | null;
  loadedClientPhone?: string | null;
  messages: MessageThreadRow[];
}) {
  const existingMessage = findLatestSmsMessageForClientThread(
    input.messages,
    input.clientId,
    input.clientPhone,
  );

  if (existingMessage) {
    return {
      draftMessage: null,
      existingMessage,
      shouldSendImmediately: false,
      targetType: "existing" as const,
    };
  }

  return {
    draftMessage: buildDraftMessage({
      clientId: input.clientId,
      clientName: input.loadedClientName || input.clientName || "Client",
      phone: input.loadedClientPhone || input.clientPhone || "",
    }),
    existingMessage: null,
    shouldSendImmediately: false,
    targetType: "draft" as const,
  };
}
