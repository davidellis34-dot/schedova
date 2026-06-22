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
  refreshFeatureAccess,
  setRevenueCatFeatureAccess,
  useFeatureAccess,
} from "../featureAccess";
import { ENABLE_PRO } from "../proFeatureFlag";
import { hasSchedovaProAccess } from "../subscriptionAccess";
import { REVENUECAT_ENTITLEMENT_ID } from "./constants";
import {
  addCustomerInfoUpdateListener,
  getCustomerInfo,
  getRevenueCatErrorDetails,
  isRevenueCatUnknownBackendError,
  logRevenueCatDebugStatus,
  logRevenueCatError,
  hasSchedovaPro,
  isRevenueCatSupported,
  logInRevenueCatUser,
  logOutRevenueCatUser,
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

const CUSTOMER_INFO_FRESHNESS_MS = 60_000;

type SubscriptionContextValue = {
  loading: boolean;
  customerInfo: CustomerInfo | null;
  isPro: boolean;
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
  const customerInfoRef = useRef<CustomerInfo | null>(null);
  const lastCustomerInfoRefreshAtRef = useRef<string | null>(null);
  const activeUserIdRef = useRef<string | null>(null);
  const cachedRevenueCatUserIdRef = useRef<string | null>(null);
  const lastKnownProByUserRef = useRef<Record<string, boolean>>({});

  const lastKnownProForCurrentUser =
    Boolean(userId) &&
    cachedRevenueCatUserIdRef.current === userId &&
    cachedRevenueCatIsPro;
  const effectiveIsPro = featureAccess.isPro;
  const effectiveLoading = loading || featureAccess.loading;
  const activeSupabaseSchedovaPro = hasSchedovaProAccess(
    featureAccess.subscription,
  );

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
            { source, userId },
          );
        }
        return;
      }

      const nextIsPro = hasSchedovaPro(info);
      const activeEntitlements = Object.keys(info.entitlements.active ?? {});
      const activeUserId = userId ?? null;
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
          userId,
          originalAppUserId: info.originalAppUserId,
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

        await syncRevenueCatSubscriptionToSupabase({
          userId,
          customerInfo: info,
          allowInactive: false,
        });

        if (__DEV__) {
          console.log(
            "[RevenueCat] Preserved last-known Pro because inactive state was not confirmed",
            { userId, source },
          );
        }

        return;
      }

      customerInfoRef.current = info;
      setCustomerInfo(info);
      setRevenueCatFeatureAccess(nextIsPro, source);

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
              { userId, source },
            );
          }
        } else {
          lastKnownProByUserRef.current[userId] = false;
          setCachedRevenueCatIsPro(false);
          await writeLastKnownPro(userId, false);
        }

        await syncRevenueCatSubscriptionToSupabase({
          userId,
          customerInfo: info,
          allowInactive: nextIsPro || allowInactiveSync,
        });
        await refreshFeatureAccess(userId, `${source}:supabase-sync`);
      }
    },
    [featureAccess.isPro, userId],
  );

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
        console.log("[RevenueCat] Supabase user ID changed:", userId);
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

    void hydrateLastKnownPro();

    return () => {
      mounted = false;
    };
  }, [authReady, userId]);

  const resolvePotentialInactiveCustomerInfo = useCallback(
    async (
      info: CustomerInfo | null,
      activeUserId: string,
      source: string,
    ): Promise<{
      info: CustomerInfo | null;
      inactiveConfirmed: boolean;
    }> => {
      if (hasSchedovaPro(info)) {
        return { info, inactiveConfirmed: false };
      }

      const cachedKnownPro =
        activeSupabaseSchedovaPro ||
        lastKnownProByUserRef.current[activeUserId] === true ||
        (await readLastKnownPro(activeUserId));

      lastKnownProByUserRef.current[activeUserId] = cachedKnownPro;

      if (!cachedKnownPro) {
        return { info, inactiveConfirmed: true };
      }

      if (__DEV__) {
        console.log(
          "[RevenueCat] Known Pro user returned inactive; attempting restore before marking Free",
          { userId: activeUserId, source },
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
                activeEntitlements: Object.keys(
                  restored?.customerInfo?.entitlements.active ?? {},
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
            userId: activeUserId,
            activeEntitlements: Object.keys(
              refreshedInfo?.entitlements.active ?? {},
            ),
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
    [activeSupabaseSchedovaPro],
  );

  const refresh = useCallback(async () => {
    if (!revenueCatSupported) {
      setCustomerInfoFetchStatus("unsupported");
      return null;
    }

    if (!authReady) {
      setCustomerInfoFetchStatus("loading");
      return customerInfoRef.current;
    }

    if (!userId) {
      if (__DEV__) {
        console.log("[RevenueCat] refresh skipped; no Supabase user ID yet");
      }
      return null;
    }

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
    }
  }, [
    applyCustomerInfo,
    authReady,
    resolvePotentialInactiveCustomerInfo,
    revenueCatSupported,
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

  const forceRevenueCatRefresh = useCallback(async () => {
    if (!revenueCatSupported) {
      setCustomerInfoFetchStatus("unsupported");
      return null;
    }

    if (!authReady || !userId) {
      setCustomerInfoFetchStatus("loading");
      return customerInfoRef.current;
    }

    if (__DEV__) {
      console.log("[RevenueCat] Force refresh before", {
        userId,
        activeEntitlements: Object.keys(
          customerInfoRef.current?.entitlements.active ?? {},
        ),
      });
    }

    setCustomerInfoFetchStatus("loading");

    try {
      const rawInfo = await getCustomerInfo(userId);
      const { info, inactiveConfirmed } =
        await resolvePotentialInactiveCustomerInfo(
          rawInfo,
          userId,
          "revenuecat:force-refresh",
        );

      await applyCustomerInfo(info, "revenuecat:force-refresh", {
        allowKnownProDowngrade: inactiveConfirmed,
        allowInactiveSync: inactiveConfirmed,
      });

      if (__DEV__) {
        console.log("[RevenueCat] Force refresh after", {
          userId,
          activeEntitlements: Object.keys(info?.entitlements.active ?? {}),
          isPro: hasSchedovaPro(info),
          inactiveConfirmed,
        });
      }

      return info;
    } catch (error) {
      logRevenueCatError("Force RevenueCat refresh failed", error);
      setLastRevenueCatError(getRevenueCatErrorDetails(error));
      setCustomerInfoFetchStatus("error");
      return null;
    }
  }, [
    applyCustomerInfo,
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

    if (__DEV__) {
      console.log("[RevenueCat] Recover Pro for current user started", {
        userId,
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
          { userId },
        );
      }

      if (__DEV__) {
        console.log("[RevenueCat] Recover Pro for current user completed", {
          userId,
          recovered,
          activeEntitlements: Object.keys(finalInfo?.entitlements.active ?? {}),
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
  }, [applyCustomerInfo, authReady, revenueCatSupported, userId]);

  const prefetchSubscriptionData = useCallback(async () => {
    return getFreshCustomerInfo();
  }, [getFreshCustomerInfo]);

  useEffect(() => {
    let mounted = true;

    async function init() {
      if (!revenueCatSupported) {
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

      try {
        if (!userId) {
          if (__DEV__) {
            console.log("[RevenueCat] logout called");
          }

          activeUserIdRef.current = null;
          cachedRevenueCatUserIdRef.current = null;
          setCachedRevenueCatIsPro(false);
          customerInfoRef.current = null;
          setCustomerInfo(null);
          setRevenueCatFeatureAccess(false, "revenuecat:logout");
          if (__DEV__) {
            console.log("[RevenueCat] Local subscription state cleared");
          }
          await logOutRevenueCatUser();

          if (mounted) {
            setCustomerInfoFetchStatus("idle");
            setLastCustomerInfoRefreshAt(null);
            lastCustomerInfoRefreshAtRef.current = null;
          }

          return;
        }

        if (activeUserIdRef.current && activeUserIdRef.current !== userId) {
          if (__DEV__) {
            console.log("[RevenueCat] Supabase user ID changed:", userId);
          }

          cachedRevenueCatUserIdRef.current = userId;
          setCachedRevenueCatIsPro(false);
          customerInfoRef.current = null;
          setCustomerInfo(null);
          setRevenueCatFeatureAccess(false, "revenuecat:user-switch");
        }

        if (__DEV__) {
          console.log("[RevenueCat] Supabase sign in user id", userId);
          console.log("[RevenueCat] startup user id", userId);
          console.log("[RevenueCat] logIn called with appUserID", userId);
        }

        const loginInfo = await logInRevenueCatUser(userId);
        const { info, inactiveConfirmed } =
          await resolvePotentialInactiveCustomerInfo(
            loginInfo,
            userId,
            "revenuecat:init",
          );

        if (mounted) {
          activeUserIdRef.current = userId;
          await applyCustomerInfo(info, "revenuecat:init", {
            allowKnownProDowngrade: inactiveConfirmed,
            allowInactiveSync: inactiveConfirmed,
          });
          void logRevenueCatDebugStatus(info);
        }
      } catch (error) {
        logRevenueCatError("RevenueCat init failed", error);
        setLastRevenueCatError(getRevenueCatErrorDetails(error));
        setCustomerInfoFetchStatus("error");

        if (__DEV__) {
          console.log("RevenueCat init failed:", error);
        }
      } finally {
        if (mounted) setLoading(false);
      }
    }

    void init();

    return () => {
      mounted = false;
    };
  }, [
    applyCustomerInfo,
    authReady,
    resolvePotentialInactiveCustomerInfo,
    revenueCatSupported,
    userId,
  ]);

  useEffect(() => {
    let removeListener: (() => void) | null = null;
    let mounted = true;

    async function listenForUpdates() {
      if (!revenueCatSupported || !authReady || !userId) return;

      removeListener = await addCustomerInfoUpdateListener((info) => {
        if (!mounted) return;
        void (async () => {
          const { info: resolvedInfo, inactiveConfirmed } =
            await resolvePotentialInactiveCustomerInfo(
              info,
              userId,
              "revenuecat:update",
            );

          if (!mounted) return;

          await applyCustomerInfo(resolvedInfo, "revenuecat:update", {
            allowKnownProDowngrade: inactiveConfirmed,
            allowInactiveSync: inactiveConfirmed,
          });
        })();
      });
    }

    void listenForUpdates();

    return () => {
      mounted = false;
      removeListener?.();
    };
  }, [
    applyCustomerInfo,
    authReady,
    resolvePotentialInactiveCustomerInfo,
    revenueCatSupported,
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
          activeEntitlements: Object.keys(finalInfo?.entitlements.active ?? {}),
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
  }, [applyCustomerInfo, authReady, revenueCatSupported, userId]);

  const showPaywall = useCallback(async () => {
    if (!ENABLE_PRO) {
      if (__DEV__) {
        console.log("[RevenueCat] Paywall request ignored; Pro is disabled.");
      }
      return false;
    }

    if (__DEV__) {
      console.log("[RevenueCat] Paywall request ignored; Pro is preview-only.");
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

      console.log("[RevenueCat] entitlement status", {
        source: "provider:showPaywall",
        customerInfoLoaded: Boolean(refreshedInfo),
        entitlement: REVENUECAT_ENTITLEMENT_ID,
        active: false,
        paywallUiEnabled: false,
      });

      if (__DEV__) {
        console.log(
          "[RevenueCat] RevenueCat UI paywall disabled; locked Pro preview remains visible.",
        );
      }

      return false;
    } catch (error) {
      setLastRevenueCatError(getRevenueCatErrorDetails(error));
      logRevenueCatError("Customer info refresh before Pro preview failed", error);
      return false;
    }
  }, [
    authReady,
    customerInfo,
    getFreshCustomerInfo,
    revenueCatSupported,
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

    if (__DEV__) {
      console.log(
        "[RevenueCat] Paywall-if-needed request ignored; Pro is preview-only.",
      );
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

      console.log("[RevenueCat] entitlement status", {
        source: "provider:showPaywallIfNeeded",
        customerInfoLoaded: Boolean(refreshedInfo),
        entitlement: REVENUECAT_ENTITLEMENT_ID,
        active: false,
        paywallUiEnabled: false,
      });

      if (__DEV__) {
        console.log(
          "[RevenueCat] RevenueCat UI paywall-if-needed disabled; locked Pro preview remains visible.",
        );
      }

      return false;
    } catch (error) {
      setLastRevenueCatError(getRevenueCatErrorDetails(error));
      logRevenueCatError("Customer info refresh before Pro preview failed", error);
      return false;
    }
  }, [
    authReady,
    customerInfo,
    getFreshCustomerInfo,
    revenueCatSupported,
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
    userId,
  ]);

  const value = useMemo(
    () => ({
      loading: effectiveLoading,
      customerInfo,
      isPro: effectiveIsPro,
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
