import {
  DEFAULT_COUNTRY_REGION,
  normalizePhoneForSms,
} from "./phoneNumbers.ts";

export type InboundSmsContextCandidate = {
  id?: string | null;
  user_id?: string | null;
  client_id?: string | null;
  appointment_id?: string | null;
  message_type?: string | null;
  created_at?: string | null;
};

export type InboundSmsClientCandidate = {
  id?: string | null;
  user_id?: string | null;
  name?: string | null;
  phone?: string | null;
  updated_at?: string | null;
  created_at?: string | null;
  archived_at?: string | null;
};

export const INBOUND_SMS_CONTEXT_MESSAGE_TYPES = [
  "confirmation",
  "reminder",
  "update",
  "cancellation",
  "manual",
] as const;

const CONTEXT_MESSAGE_TYPES = new Set<string>(INBOUND_SMS_CONTEXT_MESSAGE_TYPES);

type ResolvedTenantContext = {
  status: "resolved";
  reason: "matched_recent_outbound_sms_thread";
  userId: string;
  context: InboundSmsContextCandidate;
  candidateUserIds: string[];
};

type UnresolvedTenantContext = {
  status: "unresolved";
  reason:
    | "no_recent_outbound_context"
    | "ambiguous_recent_outbound_context";
  candidateUserIds: string[];
  recentCandidates: InboundSmsContextCandidate[];
};

export type InboundSmsTenantContextResolution =
  | ResolvedTenantContext
  | UnresolvedTenantContext;

export type ScopedInboundSmsClientResolution = {
  client: InboundSmsClientCandidate | null;
  reason:
    | "matched_context_client"
    | "matched_scoped_phone"
    | "matched_scoped_phone_after_missing_context_client"
    | "no_scoped_phone_match";
  matchCount: number;
};

function asTrimmedString(value: unknown) {
  return String(value || "").trim();
}

function normalizePhone(value: unknown) {
  const raw = asTrimmedString(value);
  if (!raw) return "";

  return normalizePhoneForSms(raw, DEFAULT_COUNTRY_REGION) || raw;
}

function digitsOnly(value: unknown) {
  return asTrimmedString(value).replace(/\D/g, "");
}

function phoneNumbersMatch(left: unknown, right: unknown) {
  const normalizedLeft = normalizePhone(left);
  const normalizedRight = normalizePhone(right);

  if (!normalizedLeft || !normalizedRight) return false;
  if (normalizedLeft === normalizedRight) return true;

  const leftDigits = digitsOnly(normalizedLeft);
  const rightDigits = digitsOnly(normalizedRight);

  if (!leftDigits || !rightDigits) return false;
  if (leftDigits === rightDigits) return true;

  return (
    leftDigits.length >= 10 &&
    rightDigits.length >= 10 &&
    leftDigits.slice(-10) === rightDigits.slice(-10)
  );
}

function compareNewestFirst(
  left: InboundSmsContextCandidate,
  right: InboundSmsContextCandidate,
) {
  const leftTime = Date.parse(asTrimmedString(left.created_at) || "1970-01-01T00:00:00.000Z");
  const rightTime = Date.parse(asTrimmedString(right.created_at) || "1970-01-01T00:00:00.000Z");

  return rightTime - leftTime;
}

function sortByMostRecentlyUpdated(
  left: InboundSmsClientCandidate,
  right: InboundSmsClientCandidate,
) {
  const leftTimestamp = Date.parse(
    asTrimmedString(left.updated_at || left.created_at) || "1970-01-01T00:00:00.000Z",
  );
  const rightTimestamp = Date.parse(
    asTrimmedString(right.updated_at || right.created_at) || "1970-01-01T00:00:00.000Z",
  );

  return rightTimestamp - leftTimestamp;
}

export function resolveInboundSmsTenantContext(
  candidates: InboundSmsContextCandidate[],
): InboundSmsTenantContextResolution {
  const recentCandidates = (Array.isArray(candidates) ? candidates : [])
    .filter((candidate) => {
      const userId = asTrimmedString(candidate?.user_id);
      const messageType = asTrimmedString(candidate?.message_type).toLowerCase();
      return Boolean(userId) && CONTEXT_MESSAGE_TYPES.has(messageType);
    })
    .sort(compareNewestFirst);

  if (recentCandidates.length === 0) {
    return {
      status: "unresolved",
      reason: "no_recent_outbound_context",
      candidateUserIds: [],
      recentCandidates: [],
    };
  }

  const latestCreatedAt =
    asTrimmedString(recentCandidates[0]?.created_at) || null;
  const latestCandidates = latestCreatedAt
    ? recentCandidates.filter(
        (candidate) => asTrimmedString(candidate?.created_at) === latestCreatedAt,
      )
    : [recentCandidates[0]];
  const candidateUserIds = Array.from(
    new Set(
      latestCandidates
        .map((candidate) => asTrimmedString(candidate?.user_id))
        .filter(Boolean),
    ),
  );

  if (candidateUserIds.length !== 1) {
    return {
      status: "unresolved",
      reason: "ambiguous_recent_outbound_context",
      candidateUserIds,
      recentCandidates: latestCandidates,
    };
  }

  return {
    status: "resolved",
    reason: "matched_recent_outbound_sms_thread",
    userId: candidateUserIds[0],
    context: latestCandidates[0],
    candidateUserIds,
  };
}

export function resolveScopedInboundSmsClient({
  tenantUserId,
  contextClientId,
  normalizedFromNumber,
  clientRows,
}: {
  tenantUserId: string;
  contextClientId?: string | null;
  normalizedFromNumber: string;
  clientRows: InboundSmsClientCandidate[];
}): ScopedInboundSmsClientResolution {
  const tenantRows = (Array.isArray(clientRows) ? clientRows : []).filter(
    (row) =>
      asTrimmedString(row?.user_id) === tenantUserId &&
      !asTrimmedString(row?.archived_at),
  );
  const wantedContextClientId = asTrimmedString(contextClientId);

  if (wantedContextClientId) {
    const contextClient =
      tenantRows.find((row) => asTrimmedString(row?.id) === wantedContextClientId) ||
      null;

    if (contextClient) {
      return {
        client: contextClient,
        reason: "matched_context_client",
        matchCount: 1,
      };
    }
  }

  const phoneMatches = tenantRows
    .filter((row) => phoneNumbersMatch(row?.phone, normalizedFromNumber))
    .sort(sortByMostRecentlyUpdated);

  if (phoneMatches.length === 0) {
    return {
      client: null,
      reason: "no_scoped_phone_match",
      matchCount: 0,
    };
  }

  return {
    client: phoneMatches[0],
    reason: wantedContextClientId
      ? "matched_scoped_phone_after_missing_context_client"
      : "matched_scoped_phone",
    matchCount: phoneMatches.length,
  };
}
