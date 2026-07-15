export type MessageSenderUserLike = {
  email?: string | null;
  user_metadata?: Record<string, unknown> | null;
};

function asTrimmedString(value: unknown) {
  return String(value || "").trim();
}

function asObject(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function toTitleCase(value: string) {
  return value
    .split(" ")
    .filter(Boolean)
    .map((word) => {
      if (word.length <= 1) return word.toUpperCase();
      return `${word.slice(0, 1).toUpperCase()}${word.slice(1)}`;
    })
    .join(" ");
}

function sanitizeSenderName(value: unknown) {
  return asTrimmedString(value)
    .replace(/[\r\n]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isPlaceholderBusinessName(value: string) {
  return value.toLowerCase() === "your business";
}

function formatEmailLocalPart(email: string) {
  const localPart = asTrimmedString(email).split("@")[0] || "";
  const normalized = localPart
    .replace(/[._-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!normalized) return null;

  const formatted = /[A-Z]/.test(normalized)
    ? normalized
    : toTitleCase(normalized.toLowerCase());

  return sanitizeSenderName(formatted) || null;
}

export function getProviderAccountName(
  user: MessageSenderUserLike | null | undefined,
) {
  const metadata = asObject(user?.user_metadata);
  const givenName = sanitizeSenderName(metadata.given_name);
  const familyName = sanitizeSenderName(metadata.family_name);
  const combinedName = sanitizeSenderName(
    [givenName, familyName].filter(Boolean).join(" "),
  );
  const candidates = [
    metadata.full_name,
    metadata.name,
    metadata.display_name,
    combinedName,
    metadata.preferred_username,
    metadata.user_name,
    metadata.username,
  ];

  for (const candidate of candidates) {
    const normalized = sanitizeSenderName(candidate);
    if (normalized) return normalized;
  }

  return formatEmailLocalPart(asTrimmedString(user?.email)) || null;
}

export function getMessageSenderDisplayName(input: {
  businessName?: string | null;
  user?: MessageSenderUserLike | null;
  fallback?: string | null;
}) {
  const normalizedBusinessName = sanitizeSenderName(input.businessName);

  if (
    normalizedBusinessName &&
    !isPlaceholderBusinessName(normalizedBusinessName)
  ) {
    return normalizedBusinessName;
  }

  return (
    getProviderAccountName(input.user) ||
    sanitizeSenderName(input.fallback) ||
    "Schedova Appointment"
  );
}
