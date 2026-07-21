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

const MAX_TRANSITION_EVENTS = 120;
const scopedCleanups = new Set<AccountScopedCleanup>();
const transitionEvents: AccountTransitionEvent[] = [];

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
    details,
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
    "switch-button-pressed",
    { source, userId: previousUserId ?? null },
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
    "new-supabase-session-established",
    { source, userId: targetUserId },
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

  recordAccountTransitionEvent("transition-completed", { source }, runId);
  currentTransition = {
    active: false,
    previousUserId: null,
    runId,
    targetUserId: currentTransition.targetUserId,
  };
  return true;
}

export function registerAccountScopedCleanup(cleanup: AccountScopedCleanup) {
  scopedCleanups.add(cleanup);

  return () => {
    scopedCleanups.delete(cleanup);
  };
}

export async function cancelAccountScopedWork(
  source: string,
  runId: number,
) {
  const cleanups = [...scopedCleanups];
  recordAccountTransitionEvent(
    "previous-account-async-work-canceling",
    { cleanupCount: cleanups.length, source },
    runId,
  );

  const results = await Promise.allSettled(
    cleanups.map(async (cleanup) => cleanup()),
  );
  const rejectedCount = results.filter((result) => result.status === "rejected").length;

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
