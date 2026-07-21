import { useEffect, useSyncExternalStore } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";

import { FREE_TIER_LIMITS } from "./freePlanLimits";
import { ENABLE_PRO } from "./proFeatureFlag";
import {
  hasAdminLifetimeSchedovaProAccess,
  hasSchedovaProAccess,
  hasRevenueCatStyleSchedovaProAccess,
  type UserSubscription,
} from "./subscriptionAccess";
import { supabase } from "./supabase";

export const PRO_FEATURE_HIGHLIGHTS = [
  "Email appointment messages",
  "Smart rebooking and follow-up reminders",
  "Reports and business insights",
  "Advanced client history timeline",
  "Client photo gallery",
  "Service formulas and appointment notes",
  "Waitlist",
  "No-show tracker",
  "Deposit tracking",
  "Custom business hours and blocked time",
  "Unlimited message templates",
  "Custom colors/statuses",
] as const;

export type FeatureKey =
  | "moreClients"
  | "moreServices"
  | "moreAppointments"
  | "revenueInsights"
  | "reports"
  | "fullClientHistory"
  | "unlimitedMessageTemplates"
  | "customTagsStatusesColors"
  | "smsAutomation"
  | "emailMessaging"
  | "smartReminders"
  | "waitlist"
  | "noShowTracker"
  | "depositTracking"
  | "photoGallery"
  | "serviceFormulas"
  | "customBusinessHours"
  | "clientReplies";

type FeatureAccessState = {
  userId: string | null;
  subscription: UserSubscription | null;
  isPro: boolean | null;
  subscriptionLoaded: boolean;
  cachedEntitlementIsPro: boolean;
  revenueCatLoaded: boolean;
  revenueCatIsPro: boolean | null;
  loading: boolean;
  loadedAt: string | null;
  source: string;
  resolutionSource: string;
  error: string | null;
};

const initialState: FeatureAccessState = {
  userId: null,
  subscription: null,
  isPro: false,
  subscriptionLoaded: false,
  cachedEntitlementIsPro: false,
  revenueCatLoaded: false,
  revenueCatIsPro: null,
  loading: false,
  loadedAt: null,
  source: "initial",
  resolutionSource: "not-authenticated",
  error: null,
};
const LAST_KNOWN_PRO_STORAGE_PREFIX =
  "schedova_revenuecat_last_known_pro_user_";

let featureAccessState = initialState;
let refreshGeneration = 0;
let lastHookRefreshAt = 0;
const listeners = new Set<() => void>();

function resolveEffectiveProAccess(
  subscription: UserSubscription | null,
  subscriptionLoaded: boolean,
  revenueCatLoaded: boolean,
  revenueCatIsPro: boolean | null,
  cachedEntitlementIsPro: boolean,
) {
  if (!ENABLE_PRO) return { isPro: false, source: "pro-disabled" };

  if (hasAdminLifetimeSchedovaProAccess(subscription)) {
    return { isPro: true, source: "supabase-admin-lifetime" };
  }

  if (hasSchedovaProAccess(subscription)) {
    return { isPro: true, source: "supabase-subscription" };
  }

  if (revenueCatLoaded && revenueCatIsPro === true) {
    return { isPro: true, source: "revenuecat-schedova-pro" };
  }

  // A valid prior entitlement protects the account only while the two live
  // sources are still resolving. An empty cache is never persisted as proof.
  if (cachedEntitlementIsPro && (!subscriptionLoaded || !revenueCatLoaded)) {
    return { isPro: true, source: "cached-entitlement-temporary" };
  }

  if (!subscriptionLoaded || !revenueCatLoaded) {
    return { isPro: null, source: "entitlement-unresolved" };
  }

  return { isPro: false, source: "no-active-entitlement" };
}

function withResolvedProAccess(
  state: FeatureAccessState,
  overrides: Partial<FeatureAccessState> = {},
) {
  const next = { ...state, ...overrides };
  const resolution = resolveEffectiveProAccess(
    next.subscription,
    next.subscriptionLoaded,
    next.revenueCatLoaded,
    next.revenueCatIsPro,
    next.cachedEntitlementIsPro,
  );

  return {
    ...next,
    isPro: resolution.isPro,
    loading: resolution.isPro === null,
    source: overrides.source || resolution.source,
    resolutionSource: resolution.source,
  };
}

function debugFeatureAccess(state: FeatureAccessState) {
  if (!__DEV__) return;

  console.log("Schedova Pro gate", {
    source: state.source,
    userId: state.userId,
    isPro: state.isPro,
    subscription: state.subscription,
    subscriptionLoaded: state.subscriptionLoaded,
    revenueCatLoaded: state.revenueCatLoaded,
    revenueCatIsPro: state.revenueCatIsPro,
    cachedEntitlementIsPro: state.cachedEntitlementIsPro,
    resolutionSource: state.resolutionSource,
    error: state.error,
  });
}

function publishFeatureAccess(nextState: FeatureAccessState) {
  featureAccessState = nextState;
  debugFeatureAccess(nextState);
  listeners.forEach((listener) => listener());
}

function getFeatureAccessSnapshot() {
  return featureAccessState;
}

function shouldRefreshFromHook(state: FeatureAccessState) {
  if (state.loading) return false;

  const now = Date.now();
  const loadedAt = state.loadedAt ? new Date(state.loadedAt).getTime() : 0;
  const snapshotIsFresh =
    Number.isFinite(loadedAt) && now - loadedAt < 30 * 1000;
  const hookRefreshIsFresh = now - lastHookRefreshAt < 30 * 1000;

  if (snapshotIsFresh || hookRefreshIsFresh) return false;

  lastHookRefreshAt = now;
  return true;
}

export function useFeatureAccess() {
  const state = useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getFeatureAccessSnapshot,
    getFeatureAccessSnapshot,
  );

  useEffect(() => {
    // Root auth bootstrap owns the first lookup. Avoid a second auth request from
    // every screen that subscribes before the shared session has populated state.
    if (state.userId && shouldRefreshFromHook(state)) {
      void refreshFeatureAccess(state.userId, "feature-hook");
    }
  }, [state]);

  return state;
}

export function clearFeatureAccess(source = "clear") {
  refreshGeneration += 1;
  publishFeatureAccess({
    ...initialState,
    source,
    loadedAt: new Date().toISOString(),
  });
}

export function setRevenueCatFeatureAccess(
  isPro: boolean,
  source = "revenuecat",
) {
  const subscription = featureAccessState.subscription;
  const adminLifetimeAccess = hasAdminLifetimeSchedovaProAccess(subscription);
  const revenueCatStyleAccess =
    hasRevenueCatStyleSchedovaProAccess(subscription);
  const nextState = withResolvedProAccess(featureAccessState, {
    revenueCatLoaded: true,
    revenueCatIsPro: isPro,
    source,
    error: null,
  });

  if (__DEV__) {
    console.log("[FeatureAccess] entitlement resolution", {
      supabaseSubscriptionResult: subscription,
      revenueCatEntitlementResult: isPro,
      cachedEntitlementResult: featureAccessState.cachedEntitlementIsPro,
      adminLifetimeAccess,
      revenueCatStyleAccess,
      finalSource: nextState.resolutionSource,
      finalIsPro: nextState.isPro,
    });
  }

  publishFeatureAccess({ ...nextState, loadedAt: new Date().toISOString() });
}

async function readCachedEntitlement(userId: string) {
  try {
    return (
      (await AsyncStorage.getItem(
        `${LAST_KNOWN_PRO_STORAGE_PREFIX}${userId}`,
      )) === "true"
    );
  } catch {
    return false;
  }
}

export function setCachedEntitlementFeatureAccess(
  userId: string,
  isPro: boolean,
  source = "cached-entitlement",
) {
  if (!userId || featureAccessState.userId !== userId) return;

  const nextState = withResolvedProAccess(featureAccessState, {
    cachedEntitlementIsPro: isPro,
    source,
  });

  if (__DEV__) {
    console.log("[FeatureAccess] cached entitlement result", {
      userId,
      cachedEntitlementResult: isPro,
      finalSource: nextState.resolutionSource,
      finalIsPro: nextState.isPro,
    });
  }

  publishFeatureAccess(nextState);
}

export async function refreshFeatureAccess(
  userId?: string | null,
  source = "refresh",
) {
  let activeUserId = userId || null;
  let authEmail: string | null = null;

  if (
    activeUserId &&
    featureAccessState.loading &&
    featureAccessState.userId === activeUserId
  ) {
    return featureAccessState;
  }

  // Do not invalidate an active request for the same account. Auth events can
  // arrive twice during hydration, and the first response must still commit.
  const generation = ++refreshGeneration;

  publishFeatureAccess(withResolvedProAccess(featureAccessState, {
    userId: activeUserId ?? featureAccessState.userId,
    subscriptionLoaded: false,
    source,
    error: null,
  }));

  try {
    if (!activeUserId) {
      const { data, error } = await supabase.auth.getUser();

      if (generation !== refreshGeneration) return featureAccessState;

      if (error || !data.user?.id) {
        publishFeatureAccess({
          ...initialState,
          source,
          loadedAt: new Date().toISOString(),
          error: error?.message || null,
        });
        return featureAccessState;
      }

      activeUserId = data.user.id;
      authEmail = data.user.email ?? null;
    }

    // Callers with a shared session already supplied the authenticated account.
    // The subscription query is scoped to that ID, so another auth round trip adds
    // no correctness value and delays every subscribed screen.
    const authUserId = activeUserId;
    const subscriptionSelect =
      "status, plan, current_period_end, entitlement, entitlement_source, entitlement_expires_at";

    const cachedEntitlementPromise = readCachedEntitlement(activeUserId);
    const { data, error } = await supabase
      .from("user_subscriptions")
      .select(subscriptionSelect)
      .eq("user_id", activeUserId);

    if (generation !== refreshGeneration) return featureAccessState;

    const cachedEntitlementIsPro = await cachedEntitlementPromise;

    if (generation !== refreshGeneration) return featureAccessState;

    if (error) {
      const nextState = withResolvedProAccess(featureAccessState, {
        userId: activeUserId,
        subscription: null,
        subscriptionLoaded: false,
        cachedEntitlementIsPro,
        source,
        error: error.message,
      });

      if (__DEV__) {
        console.log("[FeatureAccess] entitlement resolution", {
          userId: authUserId,
          authEmail,
          supabaseSubscriptionResult: null,
          revenueCatEntitlementResult: featureAccessState.revenueCatIsPro,
          cachedEntitlementResult: cachedEntitlementIsPro,
          finalSource: nextState.resolutionSource,
          finalIsPro: nextState.isPro,
          error: error.message,
        });
      }

      publishFeatureAccess({ ...nextState, loadedAt: new Date().toISOString() });
      return featureAccessState;
    }

    const subscriptions = (data || []) as UserSubscription[];
    const subscription =
      subscriptions.find(hasSchedovaProAccess) || subscriptions[0] || null;
    const subscriptionIsPro = hasSchedovaProAccess(subscription);
    const adminLifetimeAccess = hasAdminLifetimeSchedovaProAccess(subscription);

    if (__DEV__) {
      console.log("[FeatureAccess] Supabase subscription fetched", {
        userId: authUserId,
        row: subscription
          ? {
              status: subscription.status ?? null,
              plan: subscription.plan ?? null,
              entitlement: subscription.entitlement ?? null,
              entitlement_source: subscription.entitlement_source ?? null,
              entitlement_expires_at:
                subscription.entitlement_expires_at ?? null,
            }
          : null,
        subscriptionLoaded: true,
        adminLifetimeAccess,
        supabaseSubscriptionResult: subscriptionIsPro,
      });
    }

    const nextState = withResolvedProAccess(featureAccessState, {
      userId: activeUserId,
      subscription,
      subscriptionLoaded: true,
      cachedEntitlementIsPro,
      source,
      error: null,
    });

    if (__DEV__) {
      console.log("[FeatureAccess] entitlement resolution", {
        userId: authUserId,
        authEmail,
        supabaseSubscriptionRow: subscription,
        supabaseSubscriptionResult: subscriptionIsPro,
        revenueCatEntitlementResult: featureAccessState.revenueCatIsPro,
        cachedEntitlementResult: cachedEntitlementIsPro,
        adminLifetimeAccess,
        revenueCatStyleAccess: hasRevenueCatStyleSchedovaProAccess(subscription),
        finalSource: nextState.resolutionSource,
        finalIsPro: nextState.isPro,
      });
    }

    publishFeatureAccess({ ...nextState, loadedAt: new Date().toISOString() });
  } catch (error) {
    if (generation !== refreshGeneration) return featureAccessState;

    const message =
      error instanceof Error
        ? error.message
        : "Feature access could not be refreshed.";

    publishFeatureAccess(withResolvedProAccess(featureAccessState, {
      userId: activeUserId,
      loadedAt: new Date().toISOString(),
      source,
      error: message,
    }));
  }

  return featureAccessState;
}

export function isPro() {
  // Avoid hiding Pro controls while a signed-in account is still resolving.
  return ENABLE_PRO && featureAccessState.isPro !== false;
}

export function canUseFeature(feature: FeatureKey) {
  if (!ENABLE_PRO) return false;

  switch (feature) {
    case "moreClients":
    case "moreServices":
    case "moreAppointments":
    case "revenueInsights":
    case "reports":
    case "fullClientHistory":
    case "unlimitedMessageTemplates":
    case "customTagsStatusesColors":
    case "emailMessaging":
    case "smartReminders":
    case "waitlist":
    case "noShowTracker":
    case "depositTracking":
    case "photoGallery":
    case "serviceFormulas":
    case "customBusinessHours":
    case "clientReplies":
      return isPro();
    case "smsAutomation":
      return isPro();
    default:
      return false;
  }
}
