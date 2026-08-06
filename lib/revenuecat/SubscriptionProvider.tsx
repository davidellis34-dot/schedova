import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Alert } from "react-native";
import type { CustomerInfo } from "react-native-purchases";

import {
  IOS_AUTH_NATIVE_ISOLATION,
  shouldSkipAuthNativeWork,
} from "../authNativeIsolation";
import { shouldStartRevenueCatIdentitySync } from "../accountSwitchUtils";
import {
  recordAccountTransitionEvent,
  registerAccountScopedCleanup,
} from "../accountTransition";
import {
  refreshFeatureAccess,
  setCachedEntitlementFeatureAccess,
  setRevenueCatFeatureAccess,
  useFeatureAccess,
} from "../featureAccess";
import { ENABLE_PRO } from "../proFeatureFlag";
import { hasSchedovaProAccess } from "../subscriptionAccess";
import { REVENUECAT_ENTITLEMENT_ID } from "./constants";
import {
  addCustomerInfoUpdateListener,
  clearLastRevenueCatErrorDetails,
  getCustomerInfo,
  getActiveRevenueCatEntitlementIds,
  getRevenueCatErrorDetails,
  isRevenueCatUnknownBackendError,
  logRevenueCatDebugStatus,
  logRevenueCatError,
  hasSchedovaPro,
  isRevenueCatSupported,
  logInRevenueCatUser,
  presentSchedovaPaywall,
  presentSchedovaPaywallIfNeeded,
  presentCustomerCenter,
  restorePurchases,
  type RevenueCatErrorDetails,
} from "./revenueCatService";
import { syncRevenueCatSubscriptionToSupabase } from "./subscriptionSync";

type CustomerInfoFetchStatus =
  | "idle"
  | "loading"
  | "success"
  | "error"
  | "unsupported";

export type ProEntitlementStatus = "checking" | "active" | "inactive";

const CUSTOMER_INFO_FRESHNESS_MS = 60_000;

type SubscriptionContextValue = {
  loading: boolean;
  customerInfo: CustomerInfo | null;
  isPro: boolean;
  proEntitlementStatus: ProEntitlementStatus;
  revenueCatSupported: boolean;
  authReady: boolean;
  userId: string | null;
  lastKnownProForCurrentUser: boolean;
  lastCustomerInfoRefreshAt: string | null;
  lastRestoreAt: string | null;
  customerInfoFetchStatus: CustomerInfoFetchStatus;
  lastRevenueCatError: RevenueCatErrorDetails | null;
  prefetchSubscriptionData: () => Promise<CustomerInfo | null>;
  refresh: () => Promise<CustomerInfo | null>;
  forceRevenueCatRefresh: () => Promise<CustomerInfo | null>;
  syncRevenueCatAfterAuthSettle: () => Promise<CustomerInfo | null>;
  recoverProForCurrentUser: () => Promise<boolean>;
  restore: () => Promise<boolean>;
  showPaywall: () => Promise<boolean>;
  showPaywallIfNeeded: () => Promise<boolean>;
  showCustomerCenter: () => Promise<void>;
};

const SubscriptionContext = createContext<SubscriptionContextValue | null>(
  null,
);
const LAST_KNOWN_PRO_STORAGE_PREFIX =
  "schedova_revenuecat_last_known_pro_user_";
const POST_PURCHASE_CUSTOMER_INFO_REFRESH_TIMEOUT_MS = 12_000;

type ConfirmedEntitlement = {
  userId: string | null;
  isPro: boolean | null;
};

type DelayedAuthSync = {
  userId: string;
  promise: Promise<CustomerInfo | null>;
};

type Props = {
  children: ReactNode;
  authReady?: boolean;
  userId?: string | null;
};

function createSubscriptionTimeoutError(label: string, timeoutMs: number) {
  const error = new Error(
    `${label} did not finish within ${timeoutMs / 1000} seconds.`,
  );
  error.name = "SubscriptionTimeout";
  return error;
}

async function withSubscriptionTimeout<T>(
  label: string,
  promise: Promise<T>,
  timeoutMs = POST_PURCHASE_CUSTOMER_INFO_REFRESH_TIMEOUT_MS,
) {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;

  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => {
          reject(createSubscriptionTimeoutError(label, timeoutMs));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
}

function isCustomerInfoFresh(lastRefreshAt: string | null) {
  if (!lastRefreshAt) return false;

  const refreshedAt = new Date(lastRefreshAt).getTime();

  return (
    Number.isFinite(refreshedAt) &&
    Date.now() - refreshedAt < CUSTOMER_INFO_FRESHNESS_MS
  );
}

function getLastKnownProStorageKey(userId: string) {
  return `${LAST_KNOWN_PRO_STORAGE_PREFIX}${userId}`;
}

async function readLastKnownPro(userId: string) {
  const value = await AsyncStorage.getItem(getLastKnownProStorageKey(userId));
  return value === "true";
}

async function writeLastKnownPro(userId: string, value: boolean) {
  await AsyncStorage.setItem(
    getLastKnownProStorageKey(userId),
    value ? "true" : "false",
  );
}

export function SubscriptionProvider({
  children,
  authReady = true,
  userId,
}: Props) {
  const featureAccess = useFeatureAccess();
  const revenueCatSupported = isRevenueCatSupported();
  const [loading, setLoading] = useState(revenueCatSupported);
  const [customerInfo, setCustomerInfo] = useState<CustomerInfo | null>(null);
  const [lastCustomerInfoRefreshAt, setLastCustomerInfoRefreshAt] = useState<
    string | null
  >(null);
  const [lastRestoreAt, setLastRestoreAt] = useState<string | null>(null);
  const [customerInfoFetchStatus, setCustomerInfoFetchStatus] =
    useState<CustomerInfoFetchStatus>(
      revenueCatSupported ? "idle" : "unsupported",
    );
  const [lastRevenueCatError, setLastRevenueCatError] =
    useState<RevenueCatErrorDetails | null>(null);
  const [cachedRevenueCatIsPro, setCachedRevenueCatIsPro] = useState(false);
  const [confirmedEntitlement, setConfirmedEntitlement] =
    useState<ConfirmedEntitlement>({ userId: null, isPro: null });
  const customerInfoRef = useRef<CustomerInfo | null>(null);
  const lastCustomerInfoRefreshAtRef = useRef<string | null>(null);
  const activeUserIdRef = useRef<string | null>(null);
  const cachedRevenueCatUserIdRef = useRef<string | null>(null);
  const lastKnownProByUserRef = useRef<Record<string, boolean>>({});
  const latestUserIdRef = useRef<string | null>(userId ?? null);
  const initRunIdRef = useRef(0);
  const customerInfoListenerRunIdRef = useRef(0);
  const customerInfoListenerRemoveRef = useRef<(() => void) | null>(null);
  const delayedAuthSyncRef = useRef<DelayedAuthSync | null>(null);
  const delayedAuthSyncRunIdRef = useRef(0);
  const customerInfoRefreshPromiseRef = useRef<Promise<CustomerInfo | null> | null>(
    null,
  );
  const featureAccessRef = useRef(featureAccess);

  featureAccessRef.current = featureAccess;

  const lastKnownProForCurrentUser =
    Boolean(userId) &&
    cachedRevenueCatUserIdRef.current === userId &&
    cachedRevenueCatIsPro;
  const effectiveIsPro = featureAccess.isPro !== false;
  const effectiveLoading =
    loading || featureAccess.loading || featureAccess.isPro === null;
  const confirmedEntitlementIsPro =
    confirmedEntitlement.userId === (userId ?? null)
      ? confirmedEntitlement.isPro
      : null;
  const proEntitlementStatus: ProEntitlementStatus =
    confirmedEntitlementIsPro === null
      ? "checking"
      : confirmedEntitlementIsPro
        ? "active"
        : "inactive";
  latestUserIdRef.current = userId ?? null;

  const markConfirmedEntitlement = useCallback(
    (targetUserId: string, nextIsPro: boolean) => {
      if (latestUserIdRef.current !== targetUserId) return;

      setConfirmedEntitlement((current) => {
        if (current.userId === targetUserId && current.isPro === nextIsPro) {
          return current;
        }

        return { userId: targetUserId, isPro: nextIsPro };
      });
    },
    [],
  );

  const shouldSkipRevenueCatDuringTransition = useCallback(
    (source: string, targetUserId?: string | null) => {
      const activeUserId = targetUserId ?? userId ?? null;

      if (
        !IOS_AUTH_NATIVE_ISOLATION ||
        !shouldSkipAuthNativeWork(activeUserId)
      ) {
        return false;
      }

      console.log("[AuthNative] skipped RevenueCat during transition", {
        source,
        hasAuthenticatedAccount: Boolean(activeUserId),
      });
      return true;
    },
    [userId],
  );

  const clearLocalRevenueCatState = useCallback((
    source: string,
    nextUserId: string | null = null,
  ) => {
    // Invalidate listeners and every asynchronous customer-info result before
    // clearing state. This prevents account A from updating account B's UI.
    delayedAuthSyncRunIdRef.current += 1;
    customerInfoListenerRunIdRef.current += 1;
    customerInfoListenerRemoveRef.current?.();
    customerInfoListenerRemoveRef.current = null;
    customerInfoRefreshPromiseRef.current = null;
    activeUserIdRef.current = null;
    cachedRevenueCatUserIdRef.current = nextUserId;
    setCachedRevenueCatIsPro(false);
    customerInfoRef.current = null;
    setCustomerInfo(null);
    setRevenueCatFeatureAccess(false, source);
    clearLastRevenueCatErrorDetails();
    setLastRevenueCatError(null);
    setLastRestoreAt(null);
    setLastCustomerInfoRefreshAt(null);
    lastCustomerInfoRefreshAtRef.current = null;
    setCustomerInfoFetchStatus("idle");
    setConfirmedEntitlement({ userId: nextUserId, isPro: null });
    recordAccountTransitionEvent("local_user_state_cleared", { source });
  }, []);

  useEffect(() => {
    if (userId) return;

    clearLocalRevenueCatState("revenuecat:account-cleared");
    setLoading(false);
  }, [clearLocalRevenueCatState, userId]);

  useEffect(() => {
    if (!userId) return;

    return registerAccountScopedCleanup(
      () => {
        if (latestUserIdRef.current !== userId) return;

        clearLocalRevenueCatState("revenuecat:account-transition");
        setLoading(false);
      },
      "subscription",
    );
  }, [clearLocalRevenueCatState, userId]);

  const applyCustomerInfo = useCallback(
    async (
      info: CustomerInfo | null,
      source: string,
      {
        allowKnownProDowngrade = false,
        allowInactiveSync = false,
      }: {
        allowKnownProDowngrade?: boolean;
        allowInactiveSync?: boolean;
      } = {},
    ) => {
      if (!info) {
        if (__DEV__) {
          console.log(
            "[RevenueCat] customerInfo fetch returned no data; keeping previous subscription state",
            { source, hasAuthenticatedAccount: Boolean(userId) },
          );
        }
        return;
      }

      const activeUserId = userId ?? null;
      const latestUserId = latestUserIdRef.current ?? null;

      if (!activeUserId || latestUserId !== activeUserId) {
        if (__DEV__) {
          console.log("[RevenueCat] Ignoring stale customerInfo result", {
            source,
            hasSourceAccount: Boolean(activeUserId),
            hasLatestAccount: Boolean(latestUserId),
          });
        }
        return;
      }

      const nextIsPro = hasSchedovaPro(info);
      const hasConfirmedSupabaseAccess = hasSchedovaProAccess(
        featureAccessRef.current.subscription,
      );
      const activeEntitlements = getActiveRevenueCatEntitlementIds(info);
      const wasKnownPro =
        activeUserId !== null &&
        lastKnownProByUserRef.current[activeUserId] === true;
      const shouldPreserveKnownPro =
        activeUserId !== null &&
        wasKnownPro &&
        !nextIsPro &&
        !allowKnownProDowngrade;

      if (__DEV__) {
        console.log("[RevenueCat] customerInfo fetched", {
          source,
          hasAuthenticatedAccount: Boolean(userId),
          hasOriginalAppUserId: Boolean(info.originalAppUserId),
        });
        console.log("revenuecat result", nextIsPro);
        console.log("final isPro value", featureAccess.isPro);
        console.log("[RevenueCat] active entitlements", activeEntitlements);
        console.log("[RevenueCat] setting isPro", nextIsPro, {
          entitlement: REVENUECAT_ENTITLEMENT_ID,
        });
      }

      if (shouldPreserveKnownPro) {
        const refreshedAt = new Date().toISOString();
        const currentCustomerInfoIsPro = hasSchedovaPro(
          customerInfoRef.current,
        );
        lastCustomerInfoRefreshAtRef.current = refreshedAt;
        setLastCustomerInfoRefreshAt(refreshedAt);
        setCustomerInfoFetchStatus("success");
        if (currentCustomerInfoIsPro) {
          setRevenueCatFeatureAccess(true, `${source}:preserved-current-pro`);
        }
        setCachedRevenueCatIsPro(true);
        markConfirmedEntitlement(activeUserId, true);

        if (latestUserIdRef.current !== activeUserId) {
          return;
        }

        await syncRevenueCatSubscriptionToSupabase({
          userId,
          customerInfo: info,
          allowInactive: false,
        });

        if (__DEV__) {
          console.log(
            "[RevenueCat] Preserved last-known Pro because inactive state was not confirmed",
            { hasAuthenticatedAccount: Boolean(userId), source },
          );
        }

        return;
      }

      customerInfoRef.current = info;
      setCustomerInfo(info);
      setRevenueCatFeatureAccess(nextIsPro, source);

      if (nextIsPro || hasConfirmedSupabaseAccess) {
        markConfirmedEntitlement(activeUserId, true);
      } else if (featureAccessRef.current.subscriptionLoaded) {
        // An inactive RevenueCat response is only final after the Supabase
        // grant lookup completes, so manual Pro accounts never flash as Free.
        markConfirmedEntitlement(activeUserId, false);
      }

      const refreshedAt = new Date().toISOString();
      lastCustomerInfoRefreshAtRef.current = refreshedAt;
      setLastCustomerInfoRefreshAt(refreshedAt);
      setCustomerInfoFetchStatus("success");
      setLastRevenueCatError(null);

      if (userId) {
        cachedRevenueCatUserIdRef.current = userId;
        if (nextIsPro) {
          lastKnownProByUserRef.current[userId] = true;
          setCachedRevenueCatIsPro(true);
          await writeLastKnownPro(userId, true);
        } else if (wasKnownPro) {
          setCachedRevenueCatIsPro(true);
          if (__DEV__) {
            console.log(
              "[RevenueCat] Keeping last-known Pro recovery hint after confirmed inactive customerInfo",
              { hasAuthenticatedAccount: Boolean(userId), source },
            );
          }
        } else {
          lastKnownProByUserRef.current[userId] = false;
          setCachedRevenueCatIsPro(false);
          await writeLastKnownPro(userId, false);
        }

        if (latestUserIdRef.current !== userId) {
          return;
        }

        await syncRevenueCatSubscriptionToSupabase({
          userId,
          customerInfo: info,
          allowInactive: nextIsPro || allowInactiveSync,
        });

        if (latestUserIdRef.current !== userId) {
          return;
        }

        await refreshFeatureAccess(userId, `${source}:supabase-sync`);
      }
    },
    [markConfirmedEntitlement, userId],
  );

  useEffect(() => {
    const currentUserId = userId ?? null;

    setConfirmedEntitlement((current) =>
      current.userId === currentUserId
        ? current
        : { userId: currentUserId, isPro: null },
    );
  }, [userId]);

  useEffect(() => {
    const currentUserId = userId ?? null;

    if (
      !currentUserId ||
      featureAccess.userId !== currentUserId ||
      !hasSchedovaProAccess(featureAccess.subscription)
    ) {
      return;
    }

    // Manual and lifetime grants are confirmed by Supabase and do not need a
    // RevenueCat response before the Settings card can show Pro as active.
    markConfirmedEntitlement(currentUserId, true);
  }, [
    featureAccess.subscription,
    featureAccess.userId,
    markConfirmedEntitlement,
    userId,
  ]);

  useEffect(() => {
    const currentUserId = userId ?? null;

    if (
      !currentUserId ||
      featureAccess.userId !== currentUserId ||
      !featureAccess.subscriptionLoaded ||
      !featureAccess.revenueCatLoaded ||
      featureAccess.isPro !== false
    ) {
      return;
    }

    markConfirmedEntitlement(currentUserId, false);
  }, [
    featureAccess.isPro,
    featureAccess.revenueCatLoaded,
    featureAccess.subscriptionLoaded,
    featureAccess.userId,
    markConfirmedEntitlement,
    userId,
  ]);

  useEffect(() => {
    if (!authReady) return;

    let mounted = true;

    async function hydrateLastKnownPro() {
      if (!userId) {
        cachedRevenueCatUserIdRef.current = null;
        setCachedRevenueCatIsPro(false);
        return;
      }

      if (__DEV__) {
        console.log("[RevenueCat] authenticated account changed");
      }

      if (cachedRevenueCatUserIdRef.current !== userId) {
        cachedRevenueCatUserIdRef.current = userId;
        setCachedRevenueCatIsPro(false);
      }

      const cachedIsPro = await readLastKnownPro(userId);

      if (!mounted) return;

      lastKnownProByUserRef.current[userId] = cachedIsPro;
      cachedRevenueCatUserIdRef.current = userId;
      setCachedRevenueCatIsPro(cachedIsPro);
      setCachedEntitlementFeatureAccess(
        userId,
        cachedIsPro,
        "revenuecat-last-known-cache",
      );

      if (cachedIsPro) {
        markConfirmedEntitlement(userId, true);
      }

      if (cachedIsPro && !customerInfoRef.current) {
        if (__DEV__) {
          console.log(
            "[RevenueCat] using cached last-known Pro as recovery hint",
            {
              userId,
            },
          );
        }
      }
    }

    void hydrateLastKnownPro().catch((error) => {
      if (__DEV__) {
        console.log("[RevenueCat] last-known Pro hydrate failed", error);
      }
    });

    return () => {
      mounted = false;
    };
  }, [authReady, markConfirmedEntitlement, userId]);

  const resolvePotentialInactiveCustomerInfo = useCallback(
    async (
      info: CustomerInfo | null,
      activeUserId: string,
      source: string,
    ): Promise<{
      info: CustomerInfo | null;
      inactiveConfirmed: boolean;
    }> => {
      if (shouldSkipRevenueCatDuringTransition(source, activeUserId)) {
        return { info, inactiveConfirmed: false };
      }

      if (hasSchedovaPro(info)) {
        return { info, inactiveConfirmed: false };
      }

      const cachedKnownPro =
        hasSchedovaProAccess(featureAccessRef.current.subscription) ||
        lastKnownProByUserRef.current[activeUserId] === true ||
        (await readLastKnownPro(activeUserId));

      lastKnownProByUserRef.current[activeUserId] = cachedKnownPro;

      if (!cachedKnownPro) {
        return { info, inactiveConfirmed: true };
      }

      if (__DEV__) {
        console.log(
          "[RevenueCat] Known Pro user returned inactive; attempting restore before marking Free",
          { hasAuthenticatedAccount: Boolean(activeUserId), source },
        );
      }

      try {
        const restored = await restorePurchases(activeUserId);
        const restoredAt = new Date().toISOString();
        setLastRestoreAt(restoredAt);

        if (hasSchedovaPro(restored?.customerInfo)) {
          if (__DEV__) {
            console.log(
              "[RevenueCat] Known Pro entitlement recovered during login restore",
              {
                userId: activeUserId,
                activeEntitlements: getActiveRevenueCatEntitlementIds(
                  restored?.customerInfo,
                ),
              },
            );
          }

          return {
            info: restored?.customerInfo ?? info,
            inactiveConfirmed: false,
          };
        }

        const refreshedInfo = await getCustomerInfo(activeUserId);

        if (__DEV__) {
          console.log("[RevenueCat] customerInfo after login restore attempt", {
            hasAuthenticatedAccount: Boolean(activeUserId),
            activeEntitlements:
              getActiveRevenueCatEntitlementIds(refreshedInfo),
            isPro: hasSchedovaPro(refreshedInfo),
          });
        }

        return {
          info: refreshedInfo ?? restored?.customerInfo ?? info,
          inactiveConfirmed: false,
        };
      } catch (error) {
        logRevenueCatError("Known Pro login restore failed", error);
        setLastRevenueCatError(getRevenueCatErrorDetails(error));
        setCustomerInfoFetchStatus("error");
        return { info, inactiveConfirmed: false };
      }
    },
    [shouldSkipRevenueCatDuringTransition],
  );

  const refresh = useCallback(() => {
    if (!revenueCatSupported) {
      setCustomerInfoFetchStatus("unsupported");
      return Promise.resolve(null);
    }

    if (shouldSkipRevenueCatDuringTransition("revenuecat:refresh")) {
      setCustomerInfoFetchStatus("idle");
      return Promise.resolve(customerInfoRef.current);
    }

    if (!authReady) {
      setCustomerInfoFetchStatus("loading");
      return Promise.resolve(customerInfoRef.current);
    }

    if (!userId) {
      if (__DEV__) {
        console.log("[RevenueCat] refresh skipped; no Supabase user ID yet");
      }
      return Promise.resolve(null);
    }

    if (customerInfoRefreshPromiseRef.current) {
      return customerInfoRefreshPromiseRef.current;
    }

    let request: Promise<CustomerInfo | null> | null = null;
    request = (async () => {
      setCustomerInfoFetchStatus("loading");
      try {
        const rawInfo = await getCustomerInfo(userId);
        const { info, inactiveConfirmed } =
          await resolvePotentialInactiveCustomerInfo(
            rawInfo,
            userId,
            "revenuecat:refresh",
          );

        await applyCustomerInfo(info, "revenuecat:refresh", {
          allowKnownProDowngrade: inactiveConfirmed,
          allowInactiveSync: inactiveConfirmed,
        });

        return info;
      } catch (error) {
        logRevenueCatError("Customer info refresh failed", error);
        setLastRevenueCatError(getRevenueCatErrorDetails(error));
        setCustomerInfoFetchStatus("error");

        if (__DEV__) {
          console.log("Failed to refresh RevenueCat customer info:", error);
        }
        return null;
      } finally {
        if (request && customerInfoRefreshPromiseRef.current === request) {
          customerInfoRefreshPromiseRef.current = null;
        }
      }
    })();

    customerInfoRefreshPromiseRef.current = request;
    return request;
  }, [
    applyCustomerInfo,
    authReady,
    resolvePotentialInactiveCustomerInfo,
    revenueCatSupported,
    shouldSkipRevenueCatDuringTransition,
    userId,
  ]);

  const getFreshCustomerInfo = useCallback(async () => {
    const cachedCustomerInfo = customerInfoRef.current;

    if (
      cachedCustomerInfo &&
      isCustomerInfoFresh(lastCustomerInfoRefreshAtRef.current)
    ) {
      if (__DEV__) {
        console.log("[RevenueCat] Using cached customer info");
      }

      return cachedCustomerInfo;
    }

    return refresh();
  }, [refresh]);

  const attachCustomerInfoListener = useCallback(
    async (targetUserId: string) => {
      if (
        !revenueCatSupported ||
        !authReady ||
        !targetUserId ||
        shouldSkipRevenueCatDuringTransition(
          "revenuecat:add-customer-info-listener",
          targetUserId,
        )
      ) {
        return;
      }

      customerInfoListenerRemoveRef.current?.();
      customerInfoListenerRemoveRef.current = null;

      const runId = ++customerInfoListenerRunIdRef.current;
      const nextRemoveListener = await addCustomerInfoUpdateListener((info) => {
        void (async () => {
          try {
            const { info: resolvedInfo, inactiveConfirmed } =
              await resolvePotentialInactiveCustomerInfo(
                info,
                targetUserId,
                "revenuecat:update",
              );

            if (
              runId !== customerInfoListenerRunIdRef.current ||
              latestUserIdRef.current !== targetUserId
            ) {
              return;
            }

            await applyCustomerInfo(resolvedInfo, "revenuecat:update", {
              allowKnownProDowngrade: inactiveConfirmed,
              allowInactiveSync: inactiveConfirmed,
            });
          } catch (error) {
            logRevenueCatError("RevenueCat customer info update failed", error);
            setLastRevenueCatError(getRevenueCatErrorDetails(error));
            setCustomerInfoFetchStatus("error");
          }
        })();
      });

      if (
        runId !== customerInfoListenerRunIdRef.current ||
        latestUserIdRef.current !== targetUserId
      ) {
        nextRemoveListener();
        return;
      }

      customerInfoListenerRemoveRef.current = nextRemoveListener;
    },
    [
      applyCustomerInfo,
      authReady,
      resolvePotentialInactiveCustomerInfo,
      revenueCatSupported,
      shouldSkipRevenueCatDuringTransition,
    ],
  );

  const forceRevenueCatRefresh = useCallback(() => refresh(), [refresh]);

  const syncRevenueCatAfterAuthSettle = useCallback(async () => {
    if (!revenueCatSupported || !authReady || !userId) {
      return customerInfoRef.current;
    }

    const existingSync = delayedAuthSyncRef.current;
    if (
      !shouldStartRevenueCatIdentitySync({
        targetUserId: userId,
        activeUserId: latestUserIdRef.current,
        inFlightUserId: existingSync?.userId,
      })
    ) {
      return existingSync?.promise ?? customerInfoRef.current;
    }

    const runId = ++delayedAuthSyncRunIdRef.current;

    let syncPromise: Promise<CustomerInfo | null> | null = null;
    syncPromise = (async () => {
      setLoading(true);
      setCustomerInfoFetchStatus("loading");
      try {
        const loginInfo = await logInRevenueCatUser(userId);

        if (
          latestUserIdRef.current !== userId ||
          runId !== delayedAuthSyncRunIdRef.current
        ) {
          return customerInfoRef.current;
        }

        const { info, inactiveConfirmed } =
          await resolvePotentialInactiveCustomerInfo(
            loginInfo,
            userId,
            "revenuecat:delayed-auth-sync",
          );

        if (
          latestUserIdRef.current !== userId ||
          runId !== delayedAuthSyncRunIdRef.current
        ) {
          return customerInfoRef.current;
        }

        activeUserIdRef.current = userId;
        recordAccountTransitionEvent("revenuecat_logged_in", {
          source: "revenuecat:delayed-auth-sync",
          userId,
        });
        await applyCustomerInfo(info, "revenuecat:delayed-auth-sync", {
          allowKnownProDowngrade: inactiveConfirmed,
          allowInactiveSync: inactiveConfirmed,
        });
        await attachCustomerInfoListener(userId);
        void logRevenueCatDebugStatus(info);

        return info;
      } catch (error) {
        logRevenueCatError("Delayed RevenueCat auth sync failed", error);
        setLastRevenueCatError(getRevenueCatErrorDetails(error));
        setCustomerInfoFetchStatus("error");
        return customerInfoRef.current;
      } finally {
        if (
          latestUserIdRef.current === userId &&
          runId === delayedAuthSyncRunIdRef.current
        ) {
          setLoading(false);
        }

        if (delayedAuthSyncRef.current?.promise === syncPromise) {
          delayedAuthSyncRef.current = null;
        }
      }
    })();

    delayedAuthSyncRef.current = { userId, promise: syncPromise };
    return syncPromise;
  }, [
    applyCustomerInfo,
    attachCustomerInfoListener,
    authReady,
    resolvePotentialInactiveCustomerInfo,
    revenueCatSupported,
    userId,
  ]);

  const recoverProForCurrentUser = useCallback(async () => {
    if (!revenueCatSupported) {
      Alert.alert(
        "Purchases unavailable",
        "Purchases are available in iOS and Android development or release builds.",
      );
      return false;
    }

    if (!authReady || !userId) {
      Alert.alert(
        "Recovery unavailable",
        "Please sign in before recovering Schedova Pro.",
      );
      return false;
    }

    if (
      shouldSkipRevenueCatDuringTransition("revenuecat:debug-recovery", userId)
    ) {
      return false;
    }

    if (__DEV__) {
      console.log("[RevenueCat] Recover Pro for current user started", {
        hasAuthenticatedAccount: true,
      });
    }

    setCustomerInfoFetchStatus("loading");

    try {
      const loginInfo = await logInRevenueCatUser(userId);
      const restoreResult = await restorePurchases(userId);
      const restoredAt = new Date().toISOString();
      setLastRestoreAt(restoredAt);
      const refreshedInfo = await getCustomerInfo(userId);
      const finalInfo =
        refreshedInfo ?? restoreResult?.customerInfo ?? loginInfo ?? null;

      const recovered = hasSchedovaPro(finalInfo);
      const knownProUser =
        lastKnownProByUserRef.current[userId] === true ||
        (await readLastKnownPro(userId));

      await applyCustomerInfo(finalInfo, "revenuecat:debug-recovery", {
        allowKnownProDowngrade: recovered || !knownProUser,
        allowInactiveSync: recovered || !knownProUser,
      });

      if (!recovered && knownProUser && __DEV__) {
        console.log(
          "[RevenueCat] Recovery returned inactive for a known-Pro user; inactive Supabase sync was skipped",
          { hasAuthenticatedAccount: true },
        );
      }

      if (__DEV__) {
        console.log("[RevenueCat] Recover Pro for current user completed", {
          hasAuthenticatedAccount: true,
          recovered,
          activeEntitlements: getActiveRevenueCatEntitlementIds(finalInfo),
        });
      }

      Alert.alert(
        recovered ? "Schedova Pro active" : "No active subscription found",
        recovered
          ? "RevenueCat returned an active schedova_pro entitlement."
          : knownProUser
            ? "RevenueCat did not return an active entitlement yet, so Schedova did not mark this known Pro user inactive."
            : "RevenueCat did not return an active schedova_pro entitlement for this user.",
      );

      return recovered;
    } catch (error) {
      logRevenueCatError("Recover Pro for current user failed", error);
      setLastRevenueCatError(getRevenueCatErrorDetails(error));
      setCustomerInfoFetchStatus("error");
      Alert.alert(
        "Recovery failed",
        "Unable to recover Schedova Pro. Please try again.",
      );
      return false;
    }
  }, [
    applyCustomerInfo,
    authReady,
    revenueCatSupported,
    shouldSkipRevenueCatDuringTransition,
    userId,
  ]);

  const prefetchSubscriptionData = useCallback(async () => {
    return getFreshCustomerInfo();
  }, [getFreshCustomerInfo]);

  useEffect(() => {
    let mounted = true;
    const runId = ++initRunIdRef.current;

    async function init() {
      if (!revenueCatSupported) {
        if (userId) {
          setRevenueCatFeatureAccess(false, "revenuecat:unsupported");
        }
        setLoading(false);
        return;
      }

      if (!authReady) {
        setLoading(true);
        setCustomerInfoFetchStatus("loading");
        return;
      }

      setLoading(true);
      setCustomerInfoFetchStatus("loading");
      let revenueCatLoginInFlight = false;

      try {
        if (!userId) {
          return;
        }

        if (activeUserIdRef.current && activeUserIdRef.current !== userId) {
          if (__DEV__) {
            console.log("[RevenueCat] authenticated account changed");
          }

          clearLocalRevenueCatState("revenuecat:user-switch", userId);
        }

        if (IOS_AUTH_NATIVE_ISOLATION) {
          if (mounted && runId === initRunIdRef.current) {
            setCustomerInfoFetchStatus("idle");
          }
          return;
        }

        if (shouldSkipRevenueCatDuringTransition("revenuecat:init", userId)) {
          if (mounted && runId === initRunIdRef.current) {
            setCustomerInfoFetchStatus("idle");
          }
          return;
        }

        if (__DEV__) console.log("[RevenueCat] beginning identity sync");

        revenueCatLoginInFlight = true;
        recordAccountTransitionEvent("revenuecat_login_started", {
          source: "revenuecat:init",
        });
        const loginInfo = await logInRevenueCatUser(userId);
        recordAccountTransitionEvent("revenuecat_login_finished", {
          source: "revenuecat:init",
        });
        revenueCatLoginInFlight = false;
        const { info, inactiveConfirmed } =
          await resolvePotentialInactiveCustomerInfo(
            loginInfo,
            userId,
            "revenuecat:init",
          );

        if (
          mounted &&
          runId === initRunIdRef.current &&
          latestUserIdRef.current === userId
        ) {
          activeUserIdRef.current = userId;
          recordAccountTransitionEvent("revenuecat_logged_in", {
            source: "revenuecat:init",
            userId,
          });
          await applyCustomerInfo(info, "revenuecat:init", {
            allowKnownProDowngrade: inactiveConfirmed,
            allowInactiveSync: inactiveConfirmed,
          });
          await attachCustomerInfoListener(userId);
          void logRevenueCatDebugStatus(info);
        }
      } catch (error) {
        if (revenueCatLoginInFlight) {
          recordAccountTransitionEvent("revenuecat_login_finished", {
            outcome: "failed",
            source: "revenuecat:init",
          });
        }
        logRevenueCatError("RevenueCat init failed", error);
        setLastRevenueCatError(getRevenueCatErrorDetails(error));
        setCustomerInfoFetchStatus("error");
        // A failed identity refresh must never leave a prior account's access
        // visible. Manual Supabase grants can still resolve independently.
        setRevenueCatFeatureAccess(false, "revenuecat:init-failed");

        if (__DEV__) {
          console.log("RevenueCat init failed:", error);
        }
      } finally {
        if (mounted && runId === initRunIdRef.current) {
          setLoading(false);
        }
      }
    }

    void init();

    return () => {
      mounted = false;
    };
  }, [
    applyCustomerInfo,
    attachCustomerInfoListener,
    authReady,
    clearLocalRevenueCatState,
    resolvePotentialInactiveCustomerInfo,
    revenueCatSupported,
    shouldSkipRevenueCatDuringTransition,
    userId,
  ]);

  const restore = useCallback(async () => {
    if (!revenueCatSupported) {
      Alert.alert(
        "Purchases unavailable",
        "Purchases are available in iOS and Android development or release builds.",
      );
      return false;
    }

    if (!authReady || !userId) {
      Alert.alert(
        "Subscription unavailable",
        "Please sign in before managing Schedova Pro.",
      );
      return false;
    }

    if (shouldSkipRevenueCatDuringTransition("revenuecat:restore", userId)) {
      return false;
    }

    try {
      if (__DEV__) {
        console.log("[RevenueCat] restore started");
      }

      const result = await restorePurchases(userId);
      const restoredAt = new Date().toISOString();
      setLastRestoreAt(restoredAt);

      const refreshedInfo = await getCustomerInfo(userId);
      const finalInfo = refreshedInfo ?? result?.customerInfo ?? null;
      const restoredIsPro =
        Boolean(result?.isPro) || hasSchedovaPro(refreshedInfo);
      const knownProUser =
        lastKnownProByUserRef.current[userId] === true ||
        (await readLastKnownPro(userId));

      if (finalInfo) {
        await applyCustomerInfo(finalInfo, "revenuecat:restore-refresh", {
          allowKnownProDowngrade: restoredIsPro || !knownProUser,
          allowInactiveSync: restoredIsPro || !knownProUser,
        });
      }

      if (__DEV__) {
        console.log("[RevenueCat] restore completed", {
          restoredIsPro,
          knownProUser,
          activeEntitlements: getActiveRevenueCatEntitlementIds(finalInfo),
        });
      }

      if (restoredIsPro) {
        Alert.alert("Purchases restored.");
        return true;
      }

      if (knownProUser) {
        Alert.alert(
          "Subscription still checking",
          "RevenueCat did not return an active entitlement yet, so Schedova did not mark this known Pro user inactive. Try Force RevenueCat Refresh again in a moment.",
        );
        return false;
      }

      Alert.alert("No active subscription found.");
      return false;
    } catch (error) {
      logRevenueCatError("Restore purchases failed", error);
      setLastRevenueCatError(getRevenueCatErrorDetails(error));

      if (__DEV__) {
        console.log("Restore purchases failed:", error);
      }
      Alert.alert(
        "Restore failed",
        "Purchases could not be restored. Please try again.",
      );
      return false;
    }
  }, [
    applyCustomerInfo,
    authReady,
    revenueCatSupported,
    shouldSkipRevenueCatDuringTransition,
    userId,
  ]);

  const showPaywall = useCallback(async () => {
    if (!ENABLE_PRO) {
      if (__DEV__) {
        console.log("[RevenueCat] Paywall request ignored; Pro is disabled.");
      }
      return false;
    }

    if (!revenueCatSupported) {
      Alert.alert(
        "Purchases unavailable",
        "Purchases are available in iOS and Android development or release builds.",
      );
      return false;
    }

    if (!authReady || !userId) {
      Alert.alert(
        "Subscription unavailable",
        "Please sign in before upgrading to Schedova Pro.",
      );
      return false;
    }

    if (shouldSkipRevenueCatDuringTransition("revenuecat:show-paywall", userId)) {
      return false;
    }

    try {
      const refreshedInfo = (await getFreshCustomerInfo()) || customerInfo;
      const isProAfterRefresh = hasSchedovaPro(refreshedInfo);

      if (__DEV__) {
        console.log("[RevenueCat] isPro after refresh:", isProAfterRefresh);
      }

      void logRevenueCatDebugStatus(refreshedInfo);

      if (isProAfterRefresh) {
        if (__DEV__) {
          console.log("[RevenueCat] Pro already active; no paywall needed.");
        }
        return true;
      }

      const paywallResult = await presentSchedovaPaywall();

      if (__DEV__) {
        console.log("[RevenueCat] Paywall finished", {
          result: paywallResult,
        });
      }

      const rawPostPaywallInfo = await withSubscriptionTimeout(
        "RevenueCat post-paywall refresh",
        getCustomerInfo(userId),
      );
      const { info: postPaywallInfo, inactiveConfirmed } =
        await resolvePotentialInactiveCustomerInfo(
          rawPostPaywallInfo,
          userId,
          "revenuecat:paywall",
        );

      await applyCustomerInfo(postPaywallInfo, "revenuecat:paywall", {
        allowKnownProDowngrade: inactiveConfirmed,
        allowInactiveSync: inactiveConfirmed,
      });
      void logRevenueCatDebugStatus(postPaywallInfo);

      return hasSchedovaPro(postPaywallInfo);
    } catch (error) {
      setLastRevenueCatError(getRevenueCatErrorDetails(error));
      logRevenueCatError("Paywall workflow failed", error);
      throw error;
    }
  }, [
    applyCustomerInfo,
    authReady,
    customerInfo,
    getFreshCustomerInfo,
    resolvePotentialInactiveCustomerInfo,
    revenueCatSupported,
    shouldSkipRevenueCatDuringTransition,
    userId,
  ]);

  const showPaywallIfNeeded = useCallback(async () => {
    if (!ENABLE_PRO) {
      if (__DEV__) {
        console.log(
          "[RevenueCat] Paywall-if-needed request ignored; Pro is disabled.",
        );
      }
      return false;
    }

    if (!revenueCatSupported) {
      Alert.alert(
        "Schedova Pro",
        "Purchases are available in iOS and Android development or release builds.",
      );
      return false;
    }

    if (!authReady || !userId) {
      Alert.alert(
        "Schedova Pro",
        "Please sign in before upgrading to Schedova Pro.",
      );
      return false;
    }

    if (
      shouldSkipRevenueCatDuringTransition(
        "revenuecat:show-paywall-if-needed",
        userId,
      )
    ) {
      return false;
    }

    try {
      const refreshedInfo = (await getFreshCustomerInfo()) || customerInfo;
      const isProAfterRefresh = hasSchedovaPro(refreshedInfo);

      if (__DEV__) {
        console.log("[RevenueCat] isPro after refresh:", isProAfterRefresh);
      }

      void logRevenueCatDebugStatus(refreshedInfo);

      if (isProAfterRefresh) {
        if (__DEV__) {
          console.log("[RevenueCat] Pro already active; no paywall needed.");
        }
        return true;
      }

      const paywallResult = await presentSchedovaPaywallIfNeeded();

      if (__DEV__) {
        console.log("[RevenueCat] Paywall-if-needed finished", {
          result: paywallResult,
        });
      }

      const rawPostPaywallInfo = await withSubscriptionTimeout(
        "RevenueCat post-paywall-if-needed refresh",
        getCustomerInfo(userId),
      );
      const { info: postPaywallInfo, inactiveConfirmed } =
        await resolvePotentialInactiveCustomerInfo(
          rawPostPaywallInfo,
          userId,
          "revenuecat:paywall-if-needed",
        );

      await applyCustomerInfo(postPaywallInfo, "revenuecat:paywall-if-needed", {
        allowKnownProDowngrade: inactiveConfirmed,
        allowInactiveSync: inactiveConfirmed,
      });
      void logRevenueCatDebugStatus(postPaywallInfo);

      return hasSchedovaPro(postPaywallInfo);
    } catch (error) {
      setLastRevenueCatError(getRevenueCatErrorDetails(error));
      logRevenueCatError("Paywall-if-needed workflow failed", error);
      throw error;
    }
  }, [
    applyCustomerInfo,
    authReady,
    customerInfo,
    getFreshCustomerInfo,
    resolvePotentialInactiveCustomerInfo,
    revenueCatSupported,
    shouldSkipRevenueCatDuringTransition,
    userId,
  ]);

  const showCustomerCenter = useCallback(async () => {
    if (!revenueCatSupported) {
      Alert.alert(
        "Subscription management unavailable",
        "Subscription management is available in iOS and Android development or release builds.",
      );
      return;
    }

    if (!authReady || !userId) {
      Alert.alert(
        "Subscription management unavailable",
        "Please sign in before managing your subscription.",
      );
      return;
    }

    if (
      shouldSkipRevenueCatDuringTransition(
        "revenuecat:show-customer-center",
        userId,
      )
    ) {
      return;
    }

    try {
      const info = (await getFreshCustomerInfo()) || customerInfo;
      void logRevenueCatDebugStatus(info);
      await presentCustomerCenter();
      await refresh();
    } catch (error) {
      logRevenueCatError("Customer Center failed", error);
      setLastRevenueCatError(getRevenueCatErrorDetails(error));

      if (__DEV__ && isRevenueCatUnknownBackendError(error)) {
        console.log(
          "[RevenueCat] Customer Center workflow/default appears unavailable. Configure and publish RevenueCat Customer Center, reset the Test Store customer, or test with a new Supabase user ID.",
        );
      }

      if (isRevenueCatUnknownBackendError(error)) {
        Alert.alert(
          "Subscription management unavailable",
          "Unable to open subscription management right now. Your Pro status is still safe.",
        );
        return;
      }

      Alert.alert(
        "Subscription management unavailable",
        "Unable to open subscription management. Please try again.",
      );
    }
  }, [
    authReady,
    customerInfo,
    getFreshCustomerInfo,
    refresh,
    revenueCatSupported,
    shouldSkipRevenueCatDuringTransition,
    userId,
  ]);

  const value = useMemo(
    () => ({
      loading: effectiveLoading,
      customerInfo,
      isPro: effectiveIsPro,
      proEntitlementStatus,
      revenueCatSupported,
      authReady,
      userId: userId ?? null,
      lastKnownProForCurrentUser,
      lastCustomerInfoRefreshAt,
      lastRestoreAt,
      customerInfoFetchStatus,
      lastRevenueCatError,
      prefetchSubscriptionData,
      refresh,
      forceRevenueCatRefresh,
      syncRevenueCatAfterAuthSettle,
      recoverProForCurrentUser,
      restore,
      showPaywall,
      showPaywallIfNeeded,
      showCustomerCenter,
    }),
    [
      customerInfo,
      effectiveIsPro,
      effectiveLoading,
      proEntitlementStatus,
      revenueCatSupported,
      authReady,
      userId,
      lastKnownProForCurrentUser,
      lastCustomerInfoRefreshAt,
      lastRestoreAt,
      customerInfoFetchStatus,
      lastRevenueCatError,
      prefetchSubscriptionData,
      refresh,
      forceRevenueCatRefresh,
      syncRevenueCatAfterAuthSettle,
      recoverProForCurrentUser,
      restore,
      showPaywall,
      showPaywallIfNeeded,
      showCustomerCenter,
    ],
  );

  return (
    <SubscriptionContext.Provider value={value}>
      {children}
    </SubscriptionContext.Provider>
  );
}

export function useSubscription() {
  const value = useContext(SubscriptionContext);

  if (!value) {
    throw new Error("useSubscription must be used inside SubscriptionProvider");
  }

  return value;
}
