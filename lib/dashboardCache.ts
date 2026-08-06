type DashboardPrimaryData = {
  appointments: any[];
  clients: any[];
  services: any[];
  loadedAt: number;
};

const CACHE_FRESHNESS_MS = 60_000;
const dashboardPrimaryCache = new Map<string, DashboardPrimaryData>();

export function getDashboardPrimaryCache(userId: string | null | undefined) {
  if (!userId) return null;
  return dashboardPrimaryCache.get(userId) ?? null;
}

export function isDashboardPrimaryCacheFresh(
  cache: DashboardPrimaryData | null,
) {
  return Boolean(cache && Date.now() - cache.loadedAt < CACHE_FRESHNESS_MS);
}

export function setDashboardPrimaryCache(
  userId: string,
  data: Omit<DashboardPrimaryData, "loadedAt">,
) {
  dashboardPrimaryCache.set(userId, {
    ...data,
    loadedAt: Date.now(),
  });
}

export function updateDashboardCachedAppointments(
  userId: string | null | undefined,
  appointments: any[],
) {
  const current = getDashboardPrimaryCache(userId);
  if (!userId || !current) return;

  setDashboardPrimaryCache(userId, {
    ...current,
    appointments,
  });
}

export function clearDashboardPrimaryCache(userId?: string | null) {
  if (userId) {
    dashboardPrimaryCache.delete(userId);
    return;
  }

  dashboardPrimaryCache.clear();
}
