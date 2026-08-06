import type { RealtimeChannel } from "@supabase/supabase-js";

type RealtimeChannelLike = {
  subscribe: RealtimeChannel["subscribe"];
  topic?: string | null;
};

type RealtimeClientLike<TChannel extends RealtimeChannelLike = RealtimeChannel> = {
  channel: (topic: string) => TChannel;
  getChannels: () => TChannel[];
  removeChannel: (channel: TChannel) => Promise<unknown>;
};

const REALTIME_TOPIC_PREFIX = "realtime:";

let nextUserScopedRealtimeChannelId = 1;

function getUserScopedTopicStem(prefix: string, userId: string) {
  const normalizedPrefix = String(prefix || "").trim();
  const normalizedUserId = String(userId || "").trim();

  if (!normalizedPrefix || !normalizedUserId) {
    return "";
  }

  return `${normalizedPrefix}${normalizedUserId}-`;
}

export function getRealtimeChannelTopic(
  channel?: Pick<RealtimeChannelLike, "topic"> | null,
) {
  return String(channel?.topic || "");
}

export function createUserScopedRealtimeChannelName(
  prefix: string,
  userId: string,
) {
  const topicStem = getUserScopedTopicStem(prefix, userId);

  if (!topicStem) {
    throw new Error("User-scoped realtime channels require a prefix and user ID.");
  }

  return `${topicStem}${nextUserScopedRealtimeChannelId++}`;
}

export function matchesUserScopedRealtimeChannel(
  channel: Pick<RealtimeChannelLike, "topic"> | null | undefined,
  {
    prefix,
    userId,
  }: {
    prefix: string;
    userId: string;
  },
) {
  const topicStem = getUserScopedTopicStem(prefix, userId);

  if (!topicStem) {
    return false;
  }

  const topic = getRealtimeChannelTopic(channel);

  return (
    topic.startsWith(`${REALTIME_TOPIC_PREFIX}${topicStem}`) ||
    topic.startsWith(topicStem)
  );
}

export async function removeRealtimeChannel<TChannel extends RealtimeChannelLike>(
  client: Pick<RealtimeClientLike<TChannel>, "removeChannel">,
  channel: TChannel | null | undefined,
) {
  if (!channel) return;

  try {
    await client.removeChannel(channel);
  } catch (error) {
    if (__DEV__) {
      console.log("[RealtimeLifecycle] removeChannel failed", error);
    }
  }
}

export async function removeUserScopedRealtimeChannels<
  TChannel extends RealtimeChannelLike,
>(
  client: RealtimeClientLike<TChannel>,
  {
    except,
    prefix,
    userId,
  }: {
    except?: TChannel | null;
    prefix: string;
    userId: string;
  },
) {
  const matchingChannels = client
    .getChannels()
    .filter(
      (channel) =>
        channel !== except &&
        matchesUserScopedRealtimeChannel(channel, { prefix, userId }),
    );

  await Promise.all(
    matchingChannels.map((channel) => removeRealtimeChannel(client, channel)),
  );

  return matchingChannels.length;
}

export async function openUserScopedRealtimeChannel<
  TChannel extends RealtimeChannelLike,
>(
  client: RealtimeClientLike<TChannel>,
  {
    onSubscribe,
    prefix,
    registerCallbacks,
    shouldAbort,
    userId,
  }: {
    onSubscribe?: (channel: TChannel) => void;
    prefix: string;
    registerCallbacks: (channel: TChannel) => void;
    shouldAbort?: () => boolean;
    userId: string;
  },
) {
  await removeUserScopedRealtimeChannels(client, { prefix, userId });

  if (shouldAbort?.()) {
    return null;
  }

  const channel = client.channel(
    createUserScopedRealtimeChannelName(prefix, userId),
  );

  registerCallbacks(channel);

  if (shouldAbort?.()) {
    await removeRealtimeChannel(client, channel);
    return null;
  }

  if (onSubscribe) {
    onSubscribe(channel);
  } else {
    channel.subscribe();
  }

  if (shouldAbort?.()) {
    await removeRealtimeChannel(client, channel);
    return null;
  }

  return channel;
}

export function resetRealtimeChannelLifecycleForTests() {
  nextUserScopedRealtimeChannelId = 1;
}
