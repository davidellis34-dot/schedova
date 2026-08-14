export type SuggestedBookingDateTime = {
  date: string;
  time: string;
};

const DEFAULT_SUGGESTED_INTERVAL_MINUTES = 30;
const DEFAULT_DAY_START_HOUR = 9;
const DEFAULT_LAST_SAME_DAY_HOUR = 18;

function normalizeIntervalMinutes(value: unknown) {
  const parsed = Number(value);

  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_SUGGESTED_INTERVAL_MINUTES;
  }

  return Math.max(5, Math.min(60, Math.round(parsed)));
}

function toDateOnly(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(
    2,
    "0",
  )}-${String(date.getDate()).padStart(2, "0")}`;
}

export function getSuggestedBookingDateTime(input?: {
  intervalMinutes?: number;
  now?: Date;
}): SuggestedBookingDateTime {
  const safeInterval = normalizeIntervalMinutes(input?.intervalMinutes);
  const next = input?.now ? new Date(input.now) : new Date();

  next.setSeconds(0, 0);

  if (next.getMinutes() % safeInterval === 0) {
    next.setMinutes(next.getMinutes() + safeInterval, 0, 0);
  } else {
    next.setMinutes(
      Math.ceil(next.getMinutes() / safeInterval) * safeInterval,
      0,
      0,
    );
  }

  if (next.getHours() < DEFAULT_DAY_START_HOUR) {
    next.setHours(DEFAULT_DAY_START_HOUR, 0, 0, 0);
  } else if (
    next.getHours() > DEFAULT_LAST_SAME_DAY_HOUR ||
    (next.getHours() === DEFAULT_LAST_SAME_DAY_HOUR && next.getMinutes() > 0)
  ) {
    next.setDate(next.getDate() + 1);
    next.setHours(DEFAULT_DAY_START_HOUR, 0, 0, 0);
  }

  return {
    date: toDateOnly(next),
    time: `${String(next.getHours()).padStart(2, "0")}:${String(
      next.getMinutes(),
    ).padStart(2, "0")}`,
  };
}
