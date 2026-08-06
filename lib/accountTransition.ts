export type AccountTransitionEvent = {
  at: string;
  details?: Record<string, unknown>;
  event: string;
  runId: number | null;
};

type AccountTransition = {
  active: boolean;
  previousUserId: string | null;
  runId: number;
  targetUserId: string | null;
};

type AccountScopedCleanup = () => void | Promise<void>;
type AccountScopedCleanupKind =
  | "notifications"
  | "realtime"
  | "subscription"
  | "other";

const MAX_TRANSITION_EVENTS = 120;
const scopedCleanups = new Map<AccountScopedCleanup, AccountScopedCleanupKind>();
const transitionEvents: AccountTransitionEvent[] = [];

const PRIVATE_DETAIL_KEY =
  /(app.?user.?id|client|email|message|name|phone|token|user.?id)/i;

function sanitizeDetails(
  details?: Record<string, unknown>,
): Record<string, unknown> | undefined {
  if (!details) return undefined;

  return Object.fromEntries(
    Object.entries(details).map(([key, value]) => {
      if (PRIVATE_DETAIL_KEY.test(key)) {
        return [key.replace(/id$/i, "IdPresent"), Boolean(value)];
      }

      if (value instanceof Error) {
        return [key, value.message];
      }

      return [key, value];
    }),
  );
}

let nextTransitionRunId = 1;
let currentTransition: AccountTransition = {
  active: false,
  previousUserId: null,
  runId: 0,
  targetUserId: null,
};

export function recordAccountTransitionEvent(
  event: string,
  details?: Record<string, unknown>,
  runId: number | null = currentTransition.active
    ? currentTransition.runId
    : null,
) {
  const entry: AccountTransitionEvent = {
    at: new Date().toISOString(),
    // Account switching is production-diagnosed from device logs. Keep the
    // event sequence useful without persisting account or client identifiers.
    details: sanitizeDetails(details),
    event,
    runId,
  };

  transitionEvents.push(entry);
  if (transitionEvents.length > MAX_TRANSITION_EVENTS) {
    transitionEvents.splice(0, transitionEvents.length - MAX_TRANSITION_EVENTS);
  }

  // Keep the release-build sequence in device logs for TestFlight diagnostics.
  console.log("[AccountSwitch]", entry);
}

export function beginAccountTransition(
  source: string,
  previousUserId?: string | null,
) {
  if (currentTransition.active) {
    recordAccountTransitionEvent("switch-ignored-in-flight", { source });
    return { accepted: false, ...currentTransition };
  }

  currentTransition = {
    active: true,
    previousUserId: previousUserId ?? null,
    runId: nextTransitionRunId++,
    targetUserId: null,
  };
  recordAccountTransitionEvent(
    "account_switch_started",
    { source, previousUserId: previousUserId ?? null },
    currentTransition.runId,
  );
  recordAccountTransitionEvent(
    "account_transition_lock_acquired",
    { source },
    currentTransition.runId,
  );

  return { accepted: true, ...currentTransition };
}

export function continueAccountTransition(
  source: string,
  targetUserId: string,
) {
  if (!currentTransition.active) {
    currentTransition = {
      active: true,
      previousUserId: null,
      runId: nextTransitionRunId++,
      targetUserId,
    };
  } else {
    currentTransition = {
      ...currentTransition,
      targetUserId,
    };
  }

  recordAccountTransitionEvent(
    "new_supabase_session_ready",
    { source, targetUserId },
    currentTransition.runId,
  );

  return currentTransition;
}

export function isCurrentAccountTransition(runId: number) {
  return currentTransition.active && currentTransition.runId === runId;
}

export function completeAccountTransition(runId: number, source: string) {
  if (!isCurrentAccountTransition(runId)) {
    recordAccountTransitionEvent("transition-completion-ignored", { source, runId });
    return false;
  }

  recordAccountTransitionEvent("account_switch_completed", { source }, runId);
  currentTransition = {
    active: false,
    previousUserId: null,
    runId,
    targetUserId: currentTransition.targetUserId,
  };
  return true;
}

export function registerAccountScopedCleanup(
  cleanup: AccountScopedCleanup,
  kind: AccountScopedCleanupKind = "other",
) {
  scopedCleanups.set(cleanup, kind);

  return () => {
    scopedCleanups.delete(cleanup);
  };
}

export async function cancelAccountScopedWork(
  source: string,
  runId: number,
) {
  const cleanups = [...scopedCleanups.entries()];
  const cleanupCounts = cleanups.reduce(
    (counts, [, kind]) => ({
      ...counts,
      [kind]: counts[kind] + 1,
    }),
    { notifications: 0, realtime: 0, subscription: 0, other: 0 },
  );
  recordAccountTransitionEvent(
    "previous-account-async-work-canceling",
    { cleanupCount: cleanups.length, source },
    runId,
  );

  const results = await Promise.allSettled(
    cleanups.map(async ([cleanup]) => cleanup()),
  );
  const rejectedCount = results.filter((result) => result.status === "rejected").length;

  recordAccountTransitionEvent(
    "old_listeners_removed",
    { cleanupCount: cleanups.length, rejectedCount, source },
    runId,
  );
  recordAccountTransitionEvent(
    "realtime_listeners_removed",
    { cleanupCount: cleanupCounts.realtime },
    runId,
  );
  recordAccountTransitionEvent(
    "notification_listeners_removed",
    { cleanupCount: cleanupCounts.notifications },
    runId,
  );

  recordAccountTransitionEvent(
    "previous-account-async-work-canceled",
    { cleanupCount: cleanups.length, rejectedCount, source },
    runId,
  );
}

export function getAccountTransitionEvents() {
  return [...transitionEvents];
}

export function resetAccountTransitionStateForTests() {
  scopedCleanups.clear();
  transitionEvents.length = 0;
  nextTransitionRunId = 1;
  currentTransition = {
    active: false,
    previousUserId: null,
    runId: 0,
    targetUserId: null,
  };
}
