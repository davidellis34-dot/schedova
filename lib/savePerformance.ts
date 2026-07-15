type SaveTimingContext = Record<string, unknown>;

function nowMs() {
  if (
    typeof globalThis !== "undefined" &&
    globalThis.performance &&
    typeof globalThis.performance.now === "function"
  ) {
    return globalThis.performance.now();
  }

  return Date.now();
}

function roundDuration(durationMs: number) {
  return Math.round(durationMs * 10) / 10;
}

export function getSavePerformanceNow() {
  return nowMs();
}

export function logSaveTiming(
  flowName: string,
  operation: string,
  durationMs: number,
  context: SaveTimingContext = {},
) {
  if (!__DEV__) return;

  console.log(`[SaveTiming] ${flowName} ${operation}`, {
    durationMs: roundDuration(durationMs),
    ...context,
  });
}

export async function measureSaveStep<T>(
  flowName: string,
  operation: string,
  run: () => Promise<T> | T,
  context: SaveTimingContext = {},
) {
  const startedAt = nowMs();

  try {
    return await run();
  } finally {
    logSaveTiming(flowName, operation, nowMs() - startedAt, context);
  }
}

export function scheduleSaveCompletionTiming(
  flowName: string,
  saveStartedAt: number,
  options: {
    postSupabaseStartedAt?: number | null;
    context?: SaveTimingContext;
  } = {},
) {
  const navigationStartedAt = nowMs();

  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      const completedAt = nowMs();
      const context = options.context || {};

      logSaveTiming(
        flowName,
        "navigation completion",
        completedAt - navigationStartedAt,
        context,
      );

      if (options.postSupabaseStartedAt) {
        logSaveTiming(
          flowName,
          "post-supabase to navigation completion",
          completedAt - options.postSupabaseStartedAt,
          context,
        );
      }

      logSaveTiming(
        flowName,
        "total time until continue",
        completedAt - saveStartedAt,
        context,
      );
    });
  });
}
