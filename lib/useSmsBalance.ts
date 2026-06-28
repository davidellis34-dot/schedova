import { useFocusEffect } from "expo-router";
import { useCallback, useEffect, useState } from "react";
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
    if (!userId) return;

    const channel: RealtimeChannel = supabase
      .channel(`sms-balance-${userId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "message_credit_balances",
          filter: `user_id=eq.${userId}`,
        },
        () => {
          void refresh();
        },
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [refresh, userId]);

  return {
    balance,
    error,
    hasUnlimited,
    isZero: !hasUnlimited && !loading && balance.balance <= 0,
    loading,
    refresh,
  };
}
