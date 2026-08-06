export type CalendarFinderCacheEntry = {
  appointments: any[];
  loadedAt: number;
};

const finderCacheByUserId = new Map<string, CalendarFinderCacheEntry>();

export function getCalendarFinderCache(userId: string) {
  return finderCacheByUserId.get(userId) ?? null;
}

export function setCalendarFinderCache(
  userId: string,
  entry: CalendarFinderCacheEntry,
) {
  finderCacheByUserId.set(userId, entry);
}

export function clearCalendarFinderCache(userId?: string | null) {
  if (userId) {
    finderCacheByUserId.delete(userId);
    return;
  }

  finderCacheByUserId.clear();
}
