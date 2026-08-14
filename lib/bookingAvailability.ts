export type AvailabilityRuleRecord = {
  day_of_week?: number | null;
  is_available?: boolean | null;
  start_time?: string | null;
  end_time?: string | null;
};

export type BookingAvailabilityWindow = {
  isAvailable: boolean;
  startMinutes: number;
  endMinutes: number;
  hasRule: boolean;
  hasAnyRules: boolean;
};

export type BookingAvailabilityCheckResult = {
  allowed: boolean;
  reason: "available" | "unconfigured" | "closed_day" | "outside_hours";
  window: BookingAvailabilityWindow;
};

const DEFAULT_RULE_START_MINUTES = 8 * 60;
const DEFAULT_RULE_END_MINUTES = 18 * 60;
const UNCONFIGURED_DAY_START_MINUTES = 0;
const UNCONFIGURED_DAY_END_MINUTES = 24 * 60;

function parseDateOnly(dateText: string) {
  const [year, month, day] = String(dateText || "").slice(0, 10).split("-").map(Number);
  return new Date(year, month - 1, day, 12, 0, 0, 0);
}

function timeToMinutes(value: unknown) {
  const text = String(value || "").slice(0, 5);
  const [hourText, minuteText] = text.split(":");
  const hours = Number(hourText);
  const minutes = Number(minuteText);

  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) {
    return Number.NaN;
  }

  return hours * 60 + minutes;
}

export function getBookingAvailabilityWindow(
  dateText: string,
  rules: AvailabilityRuleRecord[] = [],
): BookingAvailabilityWindow {
  const safeRules = Array.isArray(rules) ? rules.filter(Boolean) : [];

  if (safeRules.length === 0) {
    return {
      isAvailable: true,
      startMinutes: UNCONFIGURED_DAY_START_MINUTES,
      endMinutes: UNCONFIGURED_DAY_END_MINUTES,
      hasRule: false,
      hasAnyRules: false,
    };
  }

  const dayNumber = parseDateOnly(dateText).getDay();
  const rule = safeRules.find(
    (item) => Number(item?.day_of_week) === Number(dayNumber),
  );

  if (!rule) {
    return {
      isAvailable: true,
      startMinutes: DEFAULT_RULE_START_MINUTES,
      endMinutes: DEFAULT_RULE_END_MINUTES,
      hasRule: false,
      hasAnyRules: true,
    };
  }

  const startMinutes = timeToMinutes(String(rule.start_time || "08:00"));
  const endMinutes = timeToMinutes(String(rule.end_time || "18:00"));
  const safeStart = Number.isFinite(startMinutes)
    ? startMinutes
    : DEFAULT_RULE_START_MINUTES;
  const safeEnd =
    Number.isFinite(endMinutes) && endMinutes > safeStart
      ? endMinutes
      : DEFAULT_RULE_END_MINUTES;

  return {
    isAvailable:
      rule.is_available === undefined || rule.is_available === null
        ? true
        : Boolean(rule.is_available),
    startMinutes: safeStart,
    endMinutes: safeEnd,
    hasRule: true,
    hasAnyRules: true,
  };
}

export function checkBookingAvailability(input: {
  dateText: string;
  startTime: string;
  endTime: string;
  rules?: AvailabilityRuleRecord[];
}): BookingAvailabilityCheckResult {
  const window = getBookingAvailabilityWindow(input.dateText, input.rules || []);

  if (!window.hasAnyRules) {
    return {
      allowed: true,
      reason: "unconfigured",
      window,
    };
  }

  if (!window.isAvailable) {
    return {
      allowed: false,
      reason: "closed_day",
      window,
    };
  }

  const startMinutes = timeToMinutes(input.startTime);
  const endMinutes = timeToMinutes(input.endTime);

  if (
    !Number.isFinite(startMinutes) ||
    !Number.isFinite(endMinutes) ||
    startMinutes < window.startMinutes ||
    endMinutes > window.endMinutes
  ) {
    return {
      allowed: false,
      reason: "outside_hours",
      window,
    };
  }

  return {
    allowed: true,
    reason: "available",
    window,
  };
}
