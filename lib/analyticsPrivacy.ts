import type { CaptureEvent, JsonType, PostHogEventProperties } from "@posthog/core";

export const SAFE_ANALYTICS_PROPERTY_KEYS = [
  "platform",
  "app_version",
  "acquisition_source",
  "acquisition_campaign",
  "business_category",
  "source",
  "screen_name",
  "flow",
  "result",
  "reason_code",
  "entry_type",
  "is_first",
] as const;

export type SafeAnalyticsPropertyKey =
  (typeof SAFE_ANALYTICS_PROPERTY_KEYS)[number];
export type SafeAnalyticsProperties = Partial<
  Record<SafeAnalyticsPropertyKey, JsonType>
>;

const SAFE_ANALYTICS_PROPERTY_KEY_SET = new Set<string>(
  SAFE_ANALYTICS_PROPERTY_KEYS,
);
const SAFE_INTERNAL_EVENT_PROPERTY_KEYS = new Set<string>([
  "anonymous_id",
  "distinct_id",
  "session_id",
  "token",
]);

const BUSINESS_CATEGORY_MATCHERS: Array<{
  category: string;
  pattern: RegExp;
}> = [
  {
    category: "hair",
    pattern: /(barber|braid|colorist|hair|loc|salon|stylist)/i,
  },
  {
    category: "nails",
    pattern: /(manicur|nail|pedicur)/i,
  },
  {
    category: "lashes_brows",
    pattern: /(brow|lash)/i,
  },
  {
    category: "skincare",
    pattern: /(esthetic|facial|skin|spa|wax)/i,
  },
  {
    category: "massage_bodywork",
    pattern: /(bodywork|chiropr|massage)/i,
  },
  {
    category: "tattoo_piercing",
    pattern: /(pierc|tattoo)/i,
  },
  {
    category: "fitness",
    pattern: /(fitness|gym|pilates|trainer|yoga)/i,
  },
  {
    category: "wellness",
    pattern: /(coach|coaching|meditation|wellness)/i,
  },
  {
    category: "healthcare",
    pattern: /(clinic|counsel|doctor|medical|nurse|therap|therapy)/i,
  },
  {
    category: "dental",
    pattern: /(dent|orthodont)/i,
  },
  {
    category: "pet_grooming",
    pattern: /(cat|dog|groom|pet)/i,
  },
];

export function sanitizeAnalyticsText(
  value: unknown,
  maxLength = 64,
): string | null {
  if (typeof value !== "string") return null;

  const trimmed = value.trim().toLowerCase();
  if (!trimmed) return null;

  const normalized = trimmed
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/_+/g, "_")
    .slice(0, maxLength);

  return normalized || null;
}

export function normalizeBusinessCategory(value: unknown): string | null {
  if (typeof value !== "string") return null;

  const trimmed = value.trim();
  if (!trimmed) return null;

  for (const matcher of BUSINESS_CATEGORY_MATCHERS) {
    if (matcher.pattern.test(trimmed)) {
      return matcher.category;
    }
  }

  return null;
}

function normalizeSafeAnalyticsString(
  key: SafeAnalyticsPropertyKey,
  value: unknown,
) {
  if (typeof value !== "string") return null;

  const trimmed = value.trim();
  if (!trimmed) return null;

  if (key === "app_version" || key === "platform") {
    return trimmed.slice(0, 32);
  }

  return sanitizeAnalyticsText(trimmed);
}

export function normalizeSafeAnalyticsProperties(
  properties:
    | Partial<Record<SafeAnalyticsPropertyKey, unknown>>
    | null
    | undefined,
): SafeAnalyticsProperties | undefined {
  if (!properties) return undefined;

  const next: SafeAnalyticsProperties = {};

  for (const [rawKey, rawValue] of Object.entries(properties)) {
    if (!SAFE_ANALYTICS_PROPERTY_KEY_SET.has(rawKey)) {
      continue;
    }

    const key = rawKey as SafeAnalyticsPropertyKey;

    if (key === "is_first") {
      if (typeof rawValue === "boolean") {
        next[key] = rawValue;
      }
      continue;
    }

    const normalizedValue = normalizeSafeAnalyticsString(key, rawValue);
    if (normalizedValue) {
      next[key] = normalizedValue;
    }
  }

  return Object.keys(next).length > 0 ? next : undefined;
}

export function getAppointmentMilestoneEvents(
  existingAppointmentCount: number,
  createdAppointmentCount = 1,
) {
  const safeExistingCount = Math.max(0, Math.floor(existingAppointmentCount));
  const safeCreatedCount = Math.max(0, Math.floor(createdAppointmentCount));

  if (safeCreatedCount === 0) return [] as Array<
    "first_appointment_created" | "second_appointment_created"
  >;

  const nextCount = safeExistingCount + safeCreatedCount;
  const events: Array<"first_appointment_created" | "second_appointment_created"> =
    [];

  if (safeExistingCount === 0) {
    events.push("first_appointment_created");
  }

  if (safeExistingCount < 2 && nextCount >= 2) {
    events.push("second_appointment_created");
  }

  return events;
}

export function filterSafeAnalyticsProperties(
  properties: PostHogEventProperties | undefined,
  { preserveInternalKeys = true }: { preserveInternalKeys?: boolean } = {},
): PostHogEventProperties | undefined {
  if (!properties) return undefined;

  const next: PostHogEventProperties = {};

  for (const [key, value] of Object.entries(properties)) {
    const isSafeCustomKey = SAFE_ANALYTICS_PROPERTY_KEY_SET.has(key);
    const isSafeInternalKey =
      preserveInternalKeys &&
      (key.startsWith("$") || SAFE_INTERNAL_EVENT_PROPERTY_KEYS.has(key));

    if (!isSafeCustomKey && !isSafeInternalKey) {
      continue;
    }

    next[key] = value as JsonType;
  }

  return Object.keys(next).length > 0 ? next : undefined;
}

export function sanitizeAnalyticsCaptureEvent(
  event: CaptureEvent | null,
): CaptureEvent | null {
  if (!event) return null;

  const properties = filterSafeAnalyticsProperties(event.properties, {
    preserveInternalKeys: true,
  });
  const setProperties = filterSafeAnalyticsProperties(event.$set, {
    preserveInternalKeys: false,
  });
  const setOnceProperties = filterSafeAnalyticsProperties(event.$set_once, {
    preserveInternalKeys: false,
  });

  return {
    ...event,
    ...(properties ? { properties } : {}),
    ...(properties ? {} : { properties: undefined }),
    ...(setProperties ? { $set: setProperties } : { $set: undefined }),
    ...(setOnceProperties
      ? { $set_once: setOnceProperties }
      : { $set_once: undefined }),
  };
}
