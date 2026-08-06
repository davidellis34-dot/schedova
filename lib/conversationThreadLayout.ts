export type SafeAreaInsetsLike = {
  bottom?: number | null;
  top?: number | null;
};

export type ConversationHeaderAction = "close" | "more";

export const CONVERSATION_HEADER_ACTION_SIZE = 44;
export const CONVERSATION_KEYBOARD_VERTICAL_OFFSET = 0;

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

export function getConversationKeyboardBehavior(
  platform: string,
): "height" | "padding" | "position" {
  // The conversation is presented full-screen with no native navigation header.
  // Keeping this here prevents individual screens from guessing a header offset.
  // Padding keeps Android's normal-flow composer attached to the keyboard even
  // when window resize is delayed by edge-to-edge system bars.
  return "padding";
}

export function getAndroidKeyboardFallbackInset(
  viewportHeight: number,
  keyboardTop: number,
) {
  const safeViewportHeight = Math.max(0, Number(viewportHeight) || 0);
  const safeKeyboardTop = Math.max(0, Number(keyboardTop) || 0);

  // Only fill the overlap that remains after native keyboard avoidance has had
  // a chance to resize the conversation viewport.
  return Math.max(0, Math.round(safeViewportHeight - safeKeyboardTop));
}

export function getConversationHeaderActionOutcome(action: ConversationHeaderAction) {
  return action === "close"
    ? { closeThread: true, openOptions: false }
    : { closeThread: false, openOptions: true };
}
