export type MessageBadgeRow = {
  archived_at?: string | null;
  conversation_id?: string | null;
  hidden_at?: string | null;
  id?: string | null;
  direction?: string | null;
  is_archived?: boolean | null;
  is_hidden?: boolean | null;
  is_internal?: boolean | null;
  metadata?: Record<string, unknown> | null;
  read_at?: string | null;
  resolved_at?: string | null;
  status?: string | null;
};

function hasMetadataFlag(
  metadata: Record<string, unknown> | null | undefined,
  names: string[],
) {
  return names.some((name) => metadata?.[name] === true);
}

function getMessageStatus(message: MessageBadgeRow) {
  return String(message.status || "").trim().toLowerCase();
}

export function isMessageVisibleInInbox(message: MessageBadgeRow) {
  const status = getMessageStatus(message);

  return !(
    message.archived_at ||
    message.hidden_at ||
    message.is_archived ||
    message.is_hidden ||
    message.is_internal ||
    hasMetadataFlag(message.metadata, [
      "archived",
      "hidden",
      "internal",
      "is_archived",
      "is_hidden",
      "is_internal",
      "system",
    ]) ||
    ["archived", "deleted", "hidden", "internal", "system"].includes(status)
  );
}

export function isUnreadUnresolvedInboundMessage(message: MessageBadgeRow) {
  return (
    isMessageVisibleInInbox(message) &&
    message.direction === "inbound" &&
    !message.read_at &&
    !message.resolved_at
  );
}

export function getUnreadUnresolvedMessages<T extends MessageBadgeRow>(
  messages: T[],
) {
  return messages.filter(isUnreadUnresolvedInboundMessage);
}

export function getUnreadUnresolvedMessageCount(messages: MessageBadgeRow[]) {
  return getUnreadUnresolvedMessages(messages).length;
}

export function getMessageConversationId(message: MessageBadgeRow) {
  return String(message.conversation_id || message.id || "").trim();
}

export function getOpenActionableConversationThreadIds(
  messages: MessageBadgeRow[],
) {
  return Array.from(
    new Set(
      getUnreadUnresolvedMessages(messages)
        .map(getMessageConversationId)
        .filter(Boolean),
    ),
  );
}

export function getOpenActionableConversationThreadCount(
  messages: MessageBadgeRow[],
) {
  return getOpenActionableConversationThreadIds(messages).length;
}

export function logMessageBadgeState(label: string, messages: MessageBadgeRow[]) {
  const unreadMessages = getUnreadUnresolvedMessages(messages);
  const conversationIds = getOpenActionableConversationThreadIds(messages);
  const resolvedCount = messages.filter((message) => Boolean(message.resolved_at)).length;

  console.log(label, {
    totalMessages: messages.length,
    unreadCount: unreadMessages.length,
    resolvedCount,
    badgeCount: conversationIds.length,
    badgeConversationIds: conversationIds,
    badgeMessageIds: unreadMessages
      .map((message) => String(message.id || ""))
      .filter(Boolean),
  });
}
