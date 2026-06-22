const CLIENT_MESSAGE_TYPE = "client_message";
const CLIENT_MESSAGE_TITLE = "New client message";

type NotificationLike = {
  request?: {
    content?: {
      title?: string | null;
      data?: unknown;
    };
    trigger?: unknown;
  };
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function isClientMessageData(data: unknown) {
  return asRecord(data).type === CLIENT_MESSAGE_TYPE;
}

export function isClientMessageNotification(notification: unknown) {
  const item = asRecord(notification) as NotificationLike;
  const content = item.request?.content;
  const trigger = asRecord(item.request?.trigger);
  const remoteMessage = asRecord(trigger.remoteMessage);
  const triggerData = asRecord(trigger.data);

  return (
    isClientMessageData(content?.data) ||
    isClientMessageData(remoteMessage.data) ||
    isClientMessageData(triggerData) ||
    (content?.title || "").trim() === CLIENT_MESSAGE_TITLE
  );
}

export function getClientMessageRouteFromData(data: unknown) {
  if (!isClientMessageData(data)) return null;

  return "/messages" as const;
}

export function getClientMessageRouteFromNotification(notification: unknown) {
  if (!isClientMessageNotification(notification)) return null;

  return "/messages" as const;
}
