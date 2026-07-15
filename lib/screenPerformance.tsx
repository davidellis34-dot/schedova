import { usePathname } from "expo-router";
import { useCallback, useEffect, useRef } from "react";

type ScreenTimingPhase =
  | "navigation-start"
  | "first-visible-content"
  | "fully-loaded-interactive"
  | "primary-interactive"
  | "background-refresh-complete"
  | "supabase-request"
  | "duplicate-request"
  | "spinner-visible"
  | "interaction-response";

type ScreenTimingEntry = {
  startedAt: number;
  requestCount: number;
  pendingRequests: number;
  renderCount: number;
  rowsReturned: number;
  firstVisibleLogged: boolean;
  fullyLoadedLogged: boolean;
  primaryInteractiveLogged: boolean;
  backgroundRefreshCompleteLogged: boolean;
  manualInteractive: boolean;
  idleTimer: ReturnType<typeof setTimeout> | null;
  requestSignatures: Map<string, number>;
};

const DEFAULT_SCREEN = "unknown";
let activeScreen = DEFAULT_SCREEN;
const screenEntries = new Map<string, ScreenTimingEntry>();

function nowMs() {
  return globalThis.performance?.now?.() ?? Date.now();
}

function roundDuration(durationMs: number) {
  return Math.round(durationMs * 10) / 10;
}

function normalizeScreen(screen: string | null | undefined) {
  if (!screen || screen === "/") return "index";
  return screen.replace(/^\//, "").replace(/\?.*$/, "") || "index";
}

function getEntry(screen = activeScreen) {
  const normalizedScreen = normalizeScreen(screen);
  let entry = screenEntries.get(normalizedScreen);

  if (!entry) {
    entry = {
      startedAt: nowMs(),
      requestCount: 0,
      pendingRequests: 0,
      renderCount: 0,
      rowsReturned: 0,
      firstVisibleLogged: false,
      fullyLoadedLogged: false,
      primaryInteractiveLogged: false,
      backgroundRefreshCompleteLogged: false,
      manualInteractive: false,
      idleTimer: null,
      requestSignatures: new Map(),
    };
    screenEntries.set(normalizedScreen, entry);
  }

  return [normalizedScreen, entry] as const;
}

function logScreenTiming(
  screen: string,
  phase: ScreenTimingPhase,
  durationMs: number,
  entry: ScreenTimingEntry,
  extras: Record<string, unknown> = {},
) {
  if (!__DEV__) return;

  console.log(
    `[ScreenTiming] ${JSON.stringify({
      screen,
      phase,
      durationMs: roundDuration(durationMs),
      requestCount: entry.requestCount,
      renderCount: entry.renderCount,
      rowsReturned: entry.rowsReturned,
      ...extras,
    })}`,
  );
}

function scheduleFullyLoaded(screen: string, entry: ScreenTimingEntry) {
  if (
    entry.manualInteractive ||
    entry.fullyLoadedLogged ||
    entry.pendingRequests > 0
  ) {
    return;
  }

  if (entry.idleTimer) {
    clearTimeout(entry.idleTimer);
  }

  // Effects start after the first paint, so leave a short window for initial data loads.
  entry.idleTimer = setTimeout(() => {
    if (entry.fullyLoadedLogged || entry.pendingRequests > 0) return;
    entry.fullyLoadedLogged = true;
    logScreenTiming(
      screen,
      "fully-loaded-interactive",
      nowMs() - entry.startedAt,
      entry,
    );
  }, 100);
}

export function startScreenTiming(screen: string) {
  if (!__DEV__) return;

  const normalizedScreen = normalizeScreen(screen);
  if (activeScreen === normalizedScreen && screenEntries.has(normalizedScreen)) {
    return;
  }

  activeScreen = normalizedScreen;
  const entry: ScreenTimingEntry = {
    startedAt: nowMs(),
    requestCount: 0,
    pendingRequests: 0,
    renderCount: 0,
    rowsReturned: 0,
    firstVisibleLogged: false,
    fullyLoadedLogged: false,
    primaryInteractiveLogged: false,
    backgroundRefreshCompleteLogged: false,
    manualInteractive: false,
    idleTimer: null,
    requestSignatures: new Map(),
  };
  screenEntries.set(normalizedScreen, entry);
  logScreenTiming(normalizedScreen, "navigation-start", 0, entry);

  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      if (activeScreen !== normalizedScreen || entry.firstVisibleLogged) return;
      entry.firstVisibleLogged = true;
      logScreenTiming(
        normalizedScreen,
        "first-visible-content",
        nowMs() - entry.startedAt,
        entry,
      );
      scheduleFullyLoaded(normalizedScreen, entry);
    });
  });
}

export function useManualScreenInteractiveTiming(screen?: string) {
  const pathname = usePathname();
  const requestedScreen = normalizeScreen(screen || pathname);

  if (!__DEV__) return;

  if (activeScreen !== requestedScreen) {
    startScreenTiming(requestedScreen);
  }

  const [normalizedScreen, entry] = getEntry(requestedScreen);
  entry.manualInteractive = true;

  if (entry.idleTimer) {
    clearTimeout(entry.idleTimer);
    entry.idleTimer = null;
  }

  // Dashboard records its own usable-content milestone without a React state update.
}

export function recordPrimaryScreenInteractive(screen: string) {
  if (!__DEV__) return;

  const [normalizedScreen, entry] = getEntry(screen);
  if (entry.primaryInteractiveLogged) return;

  entry.primaryInteractiveLogged = true;
  logScreenTiming(
    normalizedScreen,
    "primary-interactive",
    nowMs() - entry.startedAt,
    entry,
  );
}

export function recordScreenBackgroundRefreshComplete(screen: string) {
  if (!__DEV__) return;

  const [normalizedScreen, entry] = getEntry(screen);
  if (entry.backgroundRefreshCompleteLogged) return;

  entry.backgroundRefreshCompleteLogged = true;
  logScreenTiming(
    normalizedScreen,
    "background-refresh-complete",
    nowMs() - entry.startedAt,
    entry,
  );
}

export function recordScreenRender(screen?: string) {
  if (!__DEV__) return;
  const requestedScreen = normalizeScreen(screen);
  if (activeScreen !== requestedScreen) {
    startScreenTiming(requestedScreen);
  }
  const [normalizedScreen, entry] = getEntry(screen);
  entry.renderCount += 1;

  if (!entry.firstVisibleLogged) {
    entry.firstVisibleLogged = true;
    logScreenTiming(
      normalizedScreen,
      "first-visible-content",
      nowMs() - entry.startedAt,
      entry,
    );
  }
}

export function recordScreenSpinner(screen: string, durationMs: number) {
  if (!__DEV__ || durationMs < 500) return;
  const [normalizedScreen, entry] = getEntry(screen);
  logScreenTiming(normalizedScreen, "spinner-visible", durationMs, entry);
}

export function recordScreenInteraction(screen: string, interaction: string) {
  if (!__DEV__) return;

  const startedAt = nowMs();
  requestAnimationFrame(() => {
    const [normalizedScreen, entry] = getEntry(screen);
    logScreenTiming(
      normalizedScreen,
      "interaction-response",
      nowMs() - startedAt,
      entry,
      { interaction },
    );
  });
}

function getRequestSignature(input: RequestInfo | URL, init?: RequestInit) {
  const requestUrl =
    typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
  const url = new URL(requestUrl);
  return `${init?.method || "GET"} ${url.pathname}?${url.searchParams
    .toString()
    .replace(/([=,])[\w-]{12,}/g, "$1:id")}`;
}

async function countResponseRows(response: Response) {
  const contentType = response.headers.get("content-type") || "";
  if (!contentType.includes("application/json")) return 0;

  try {
    const body = await response.clone().json();
    return Array.isArray(body) ? body.length : body ? 1 : 0;
  } catch {
    return 0;
  }
}

export async function screenTimedFetch(
  input: RequestInfo | URL,
  init?: RequestInit,
) {
  const fetchImplementation = globalThis.fetch;
  if (!__DEV__) return fetchImplementation(input, init);

  const screenAtStart = activeScreen;
  const [screen, entry] = getEntry(screenAtStart);
  const startedAt = nowMs();
  const signature = getRequestSignature(input, init);
  const signatureCount = (entry.requestSignatures.get(signature) || 0) + 1;
  entry.requestSignatures.set(signature, signatureCount);
  entry.requestCount += 1;
  entry.pendingRequests += 1;

  if (entry.idleTimer) {
    clearTimeout(entry.idleTimer);
    entry.idleTimer = null;
  }

  if (signatureCount > 1) {
    logScreenTiming(screen, "duplicate-request", nowMs() - entry.startedAt, entry, {
      request: signature,
      repeats: signatureCount,
    });
  }

  try {
    const response = await fetchImplementation(input, init);
    void countResponseRows(response).then((rowsReturned) => {
      entry.rowsReturned += rowsReturned;
      logScreenTiming(screen, "supabase-request", nowMs() - startedAt, entry, {
        request: signature,
        status: response.status,
        rowsReturned,
      });
    });
    return response;
  } finally {
    entry.pendingRequests = Math.max(0, entry.pendingRequests - 1);
    scheduleFullyLoaded(screen, entry);
  }
}

export function ScreenPerformanceBootstrap() {
  const pathname = usePathname();

  useEffect(() => {
    startScreenTiming(pathname);
  }, [pathname]);

  return null;
}

export function useScreenRenderTiming() {
  const pathname = usePathname();
  recordScreenRender(pathname);
}

export function useScreenLoadingTiming(isLoading: boolean) {
  const pathname = usePathname();
  const startedAtRef = useRef<number | null>(null);

  useEffect(() => {
    if (isLoading) {
      startedAtRef.current ??= nowMs();
      return;
    }

    if (startedAtRef.current !== null) {
      recordScreenSpinner(pathname, nowMs() - startedAtRef.current);
      startedAtRef.current = null;
    }
  }, [isLoading, pathname]);
}

export function useScreenInteractionTiming() {
  const pathname = usePathname();

  return useCallback(
    (interaction: string) => recordScreenInteraction(pathname, interaction),
    [pathname],
  );
}
