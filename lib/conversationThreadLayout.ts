export type SafeAreaInsetsLike = {
  bottom?: number | null;
  top?: number | null;
};

export type ConversationHeaderAction = "close" | "more";

export const CONVERSATION_HEADER_ACTION_SIZE = 44;

function getSafeInset(value?: number | null) {
  return Math.max(0, Number(value) || 0);
}

export function getConversationThreadLayout(insets: SafeAreaInsetsLike) {
  const topInset = getSafeInset(insets.top);
  const bottomInset = getSafeInset(insets.bottom);

  return {
    composerPaddingBottom: Math.max(bottomInset, 10) + 8,
    headerActionSize: CONVERSATION_HEADER_ACTION_SIZE,
    headerContentGap: 8,
    headerHorizontalPadding: 12,
    headerPaddingBottom: 10,
    // Keeps every header control below the actual status-bar cutout.
    headerPaddingTop: topInset + 8,
    menuPaddingBottom: Math.max(bottomInset, 10),
  };
}

export function getConversationHeaderActionOutcome(action: ConversationHeaderAction) {
  return action === "close"
    ? { closeThread: true, openOptions: false }
    : { closeThread: false, openOptions: true };
}
