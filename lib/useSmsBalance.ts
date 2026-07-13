import { useFocusEffect } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";

import {
  loadMessageCreditBalance,
  type MessageCreditBalance,
} from "./messageCredits";
import { subscribeToSmsBalanceEvents } from "./smsBalanceEvents";
import { supabase } from "./supabase";
import type { UserSubscription } from "./subscriptionAccess";

const EMPTY_SMS_BALANCE: MessageCreditBalance = {
  balance: 0,
  totalPurchased: 0,
  totalUsed: 0,
  updatedAt: null,
  lastPurchaseAt: null,
  lastUsedAt: null,
};
const SMS_BALANCE_CHANNEL_PREFIX = "sms-balance-";

function hasUnlimitedSmsAccess(_subscription?: UserSubscription | null) {
  // Schedova Pro and lifetime/admin access do not bypass SMS credit usage.
  return false;
}

export function useSmsBalance({
  userId,
  subscription,
}: {
  userId?: string | null;
  subscription?: UserSubscription | null;
} = {}) {
  const [balance, setBalance] = useState<MessageCreditBalance>(EMPTY_SMS_BALANCE);
  const [loading, setLoading] = useState(Boolean(userId));
  const [error, setError] = useState<string | null>(null);
  const hasUnlimited = hasUnlimitedSmsAccess(subscription);
  const channelRef = useRef<RealtimeChannel | null>(null);
  const channelUserIdRef = useRef<string | null>(null);
  const subscriptionSerialRef = useRef(0);
  const channelOperationRef = useRef<Promise<void>>(Promise.resolve());
  const refreshRef = useRef<() => Promise<MessageCreditBalance>>(
    async () => EMPTY_SMS_BALANCE,
  );

  const refresh = useCallback(async () => {
    if (!userId) {
      setBalance(EMPTY_SMS_BALANCE);
      setLoading(false);
      setError(null);
      return EMPTY_SMS_BALANCE;
    }

    setLoading(true);

    try {
      const nextBalance = await loadMessageCreditBalance(userId);
      setBalance(nextBalance);
      setError(null);
      return nextBalance;
    } catch (refreshError) {
      setError(
        refreshError instanceof Error
          ? refreshError.message
          : "SMS balance could not be loaded.",
      );
      return EMPTY_SMS_BALANCE;
    } finally {
      setLoading(false);
    }
  }, [userId]);

  refreshRef.current = refresh;

  const getChannelTopic = useCallback((channel: RealtimeChannel | null) => {
    if (!channel) return "";

    return String(
      (channel as RealtimeChannel & { topic?: string }).topic ?? "",
    );
  }, []);

  const matchesSmsBalanceChannelForUser = useCallback(
    (channel: RealtimeChannel, targetUserId: string) => {
      const topic = getChannelTopic(channel);
      return topic.includes(`${SMS_BALANCE_CHANNEL_PREFIX}${targetUserId}`);
    },
    [getChannelTopic],
  );

  const enqueueChannelOperation = useCallback(
    async (operation: () => Promise<void>) => {
      const nextOperation = channelOperationRef.current
        .catch(() => undefined)
        .then(operation);

      channelOperationRef.current = nextOperation.catch(() => undefined);
      await nextOperation;
    },
    [],
  );

  const safeRemoveChannel = useCallback(
    async (channel: RealtimeChannel | null) => {
      if (!channel) return;

      try {
        await supabase.removeChannel(channel);
      } catch (error) {
        if (__DEV__) {
          console.log("[SmsBalance] removeChannel failed", error);
        }
      }
    },
    [],
  );

  useFocusEffect(
    useCallback(() => {
      void refresh();
    }, [refresh]),
  );

  useEffect(() => {
    return subscribeToSmsBalanceEvents(() => {
      void refresh();
    });
  }, [refresh]);

  useEffect(() => {
    if (!userId) {
      setBalance(EMPTY_SMS_BALANCE);
      setLoading(false);
      setError(null);
      return;
    }

    setBalance(EMPTY_SMS_BALANCE);
    setLoading(true);
    setError(null);
  }, [userId]);

  useEffect(() => {
    const targetUserId = userId ?? null;
    const subscriptionSerial = subscriptionSerialRef.current + 1;
    subscriptionSerialRef.current = subscriptionSerial;
    let ownedChannel: RealtimeChannel | null = null;
    let ownedUserId: string | null = targetUserId;

    function isStaleChannel(channel: RealtimeChannel | null) {
      return (
        subscriptionSerialRef.current !== subscriptionSerial ||
        ownedChannel !== channel ||
        channelRef.current !== channel ||
        channelUserIdRef.current !== targetUserId
      );
    }

    void enqueueChannelOperation(async () => {
      if (subscriptionSerialRef.current !== subscriptionSerial) {
        return;
      }

      if (
        targetUserId &&
        channelRef.current &&
        channelUserIdRef.current === targetUserId
      ) {
        if (__DEV__) {
          console.log("[SmsBalance] skip duplicate subscription", {
            userId: targetUserId,
          });
        }
        return;
      }

      const previousChannel = channelRef.current;
      const previousUserId = channelUserIdRef.current;

      channelRef.current = null;
      channelUserIdRef.current = null;

      if (previousChannel) {
        if (__DEV__) {
          console.log("[SmsBalance] cleanup userId", previousUserId);
        }
        await safeRemoveChannel(previousChannel);
      }

      if (subscriptionSerialRef.current !== subscriptionSerial) {
        return;
      }

      if (!targetUserId) {
        return;
      }

      const duplicateChannels = supabase.getChannels().filter((channel) =>
        matchesSmsBalanceChannelForUser(channel, targetUserId),
      );

      if (duplicateChannels.length > 0) {
        await Promise.all(
          duplicateChannels.map(async (channel) => {
            if (__DEV__) {
              console.log("[SmsBalance] cleanup userId", targetUserId);
            }
            await safeRemoveChannel(channel);
          }),
        );
      }

      if (subscriptionSerialRef.current !== subscriptionSerial) {
        return;
      }

      if (
        channelRef.current &&
        channelUserIdRef.current === targetUserId
      ) {
        if (__DEV__) {
          console.log("[SmsBalance] skip duplicate subscription", {
            userId: targetUserId,
          });
        }
        return;
      }

      const channel = supabase.channel(
        `${SMS_BALANCE_CHANNEL_PREFIX}${targetUserId}-${subscriptionSerial}`,
      );

      ownedChannel = channel;
      ownedUserId = targetUserId;

      channel.on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "message_credit_balances",
          filter: `user_id=eq.${targetUserId}`,
        },
        () => {
          if (isStaleChannel(channel)) {
            if (__DEV__) {
              console.log("[SmsBalance] stale event ignored", {
                userId: targetUserId,
              });
            }
            return;
          }

          void refreshRef.current();
        },
      );

      channelRef.current = channel;
      channelUserIdRef.current = targetUserId;

      if (__DEV__) {
        console.log("[SmsBalance] subscribe userId", targetUserId);
      }

      channel.subscribe((status) => {
        if (isStaleChannel(channel)) {
          if (__DEV__) {
            console.log("[SmsBalance] stale event ignored", {
              userId: targetUserId,
              status,
            });
          }
          return;
        }

        if (__DEV__ && status === "CHANNEL_ERROR") {
          console.log("[SmsBalance] realtime channel error", {
            topic: getChannelTopic(channel),
            userId: targetUserId,
          });
        }
      });

      if (isStaleChannel(channel)) {
        if (channelRef.current === channel) {
          channelRef.current = null;
          channelUserIdRef.current = null;
        }
        await safeRemoveChannel(channel);
        return;
      }

      void refreshRef.current();
    });

    return () => {
      const cleanupChannel = ownedChannel;
      const cleanupUserId = ownedUserId;

      if (subscriptionSerialRef.current === subscriptionSerial) {
        subscriptionSerialRef.current = subscriptionSerial + 1;
      }

      if (channelRef.current === cleanupChannel) {
        channelRef.current = null;
        channelUserIdRef.current = null;
      }

      if (__DEV__) {
        console.log("[SmsBalance] cleanup userId", cleanupUserId);
      }

      void enqueueChannelOperation(async () => {
        await safeRemoveChannel(cleanupChannel);
      });
    };
  }, [
    enqueueChannelOperation,
    getChannelTopic,
    matchesSmsBalanceChannelForUser,
    safeRemoveChannel,
    userId,
  ]);

  return {
    balance,
    error,
    hasUnlimited,
    isZero: !hasUnlimited && !loading && balance.balance <= 0,
    loading,
    refresh,
  };
}
