type SaveNoticeListener = (notice: SaveNotice) => void;

export type SaveNotice = {
  id: number;
  message: string;
};

const saveNoticeListeners = new Set<SaveNoticeListener>();
let nextSaveNoticeId = 1;

export function emitSaveNotice(message: string) {
  const trimmedMessage = String(message || "").trim();
  if (!trimmedMessage) return;

  const notice = {
    id: nextSaveNoticeId++,
    message: trimmedMessage,
  } satisfies SaveNotice;

  for (const listener of saveNoticeListeners) {
    listener(notice);
  }
}

export function subscribeToSaveNotices(listener: SaveNoticeListener) {
  saveNoticeListeners.add(listener);

  return () => {
    saveNoticeListeners.delete(listener);
  };
}
