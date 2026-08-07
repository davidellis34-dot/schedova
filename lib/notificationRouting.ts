import {
  CLIENT_MESSAGE_NOTIFICATION_TITLE,
  CLIENT_MESSAGE_NOTIFICATION_TYPE,
} from "./clientMessageNotifications";

export type ClientMessageRoute =
  | "/messages"
  | {
      pathname: "/messages";
      params: {
        openClientId?: string;
        openMessageId?: string;
        openRequestAt?: string;
      };
    };

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

function asTrimmedString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

export function isClientMessageData(data: unknown) {
  return asRecord(data).type === CLIENT_MESSAGE_NOTIFICATION_TYPE;
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
    (content?.title || "").trim() === CLIENT_MESSAGE_NOTIFICATION_TITLE
  );
}

export function getClientMessageRouteFromData(data: unknown) {
  if (!isClientMessageData(data)) return null;

  const source = asRecord(data);
  const openClientId = asTrimmedString(source.clientId);
  const openMessageId =
    asTrimmedString(source.messageId) || asTrimmedString(source.replyId);
  const openRequestAt =
    asTrimmedString(source.openRequestAt) || new Date().toISOString();

  if (!openClientId && !openMessageId) {
    return "/messages" as const;
  }

  return {
    pathname: "/messages" as const,
    params: {
      ...(openClientId ? { openClientId } : {}),
      ...(openMessageId ? { openMessageId } : {}),
      openRequestAt,
    },
  } satisfies ClientMessageRoute;
}

export function getClientMessageRouteFromNotification(notification: unknown) {
  if (!isClientMessageNotification(notification)) return null;

  const item = asRecord(notification) as NotificationLike;
  const content = item.request?.content;
  const trigger = asRecord(item.request?.trigger);
  const remoteMessage = asRecord(trigger.remoteMessage);
  const triggerData = asRecord(trigger.data);

  return (
    getClientMessageRouteFromData(content?.data) ||
    getClientMessageRouteFromData(remoteMessage.data) ||
    getClientMessageRouteFromData(triggerData) ||
    ("/messages" as const)
  );
}
