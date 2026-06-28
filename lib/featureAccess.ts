import { useEffect, useSyncExternalStore } from "react";

import { ENABLE_PRO } from "./proFeatureFlag";
import {
  hasAdminLifetimeSchedovaProAccess,
  hasSchedovaProAccess,
  hasRevenueCatStyleSchedovaProAccess,
  type UserSubscription,
} from "./subscriptionAccess";
import { supabase } from "./supabase";

export const FREE_TIER_LIMITS = {
  clients: 25,
  services: 5,
  appointmentsPerMonth: 30,
  messageTemplates: 3,
  clientHistoryItems: 3,
} as const;

export const PRO_FEATURE_HIGHLIGHTS = [
  "SMS appointment texts and confirmations",
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
  | "smartReminders"
  | "waitlist"
  | "noShowTracker"
  | "depositTracking"
  | "photoGallery"
  | "serviceFormulas"
  | "customBusinessHours";

type FeatureAccessState = {
  userId: string | null;
  subscription: UserSubscription | null;
  isPro: boolean;
  revenueCatLoaded: boolean;
  revenueCatIsPro: boolean | null;
  loading: boolean;
  loadedAt: string | null;
  source: string;
  error: string | null;
};

const initialState: FeatureAccessState = {
  userId: null,
  subscription: null,
  isPro: false,
  revenueCatLoaded: false,
  revenueCatIsPro: null,
  loading: false,
  loadedAt: null,
  source: "initial",
  error: null,
};

let featureAccessState = initialState;
let refreshGeneration = 0;
let lastHookRefreshAt = 0;
const listeners = new Set<() => void>();

function getEffectiveProAccess(
  subscription: UserSubscription | null,
  revenueCatLoaded: boolean,
  revenueCatIsPro: boolean | null,
) {
  if (!ENABLE_PRO) return false;

  const supabaseIsPro = hasSchedovaProAccess(subscription);

  // Supabase user_subscriptions is the source of truth for current Pro access.
  if (subscription) return supabaseIsPro;
  if (revenueCatLoaded) return Boolean(revenueCatIsPro);

  return false;
}

function debugFeatureAccess(state: FeatureAccessState) {
  if (!__DEV__) return;

  console.log("Schedova Pro gate", {
    source: state.source,
    userId: state.userId,
    isPro: state.isPro,
    subscription: state.subscription,
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
    if (shouldRefreshFromHook(state)) {
      void refreshFeatureAccess(undefined, "feature-hook");
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
  const visibleProAccess = getEffectiveProAccess(
    subscription,
    true,
    isPro,
  );

  console.log("revenuecat result", isPro);
  console.log("subscription object used", subscription);
  console.log("adminLifetimeAccess", adminLifetimeAccess);
  console.log("revenueCatStyleAccess", revenueCatStyleAccess);
  console.log("final isPro", visibleProAccess);

  publishFeatureAccess({
    ...featureAccessState,
    isPro: visibleProAccess,
    revenueCatLoaded: true,
    revenueCatIsPro: isPro,
    loading: false,
    loadedAt: new Date().toISOString(),
    source,
    error: null,
  });
}

export async function refreshFeatureAccess(
  userId?: string | null,
  source = "refresh",
) {
  const generation = ++refreshGeneration;

  publishFeatureAccess({
    ...featureAccessState,
    loading: true,
    source,
    error: null,
  });

  let activeUserId = userId || null;

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
  }

  const { data: authUserData } = await supabase.auth.getUser();
  const authUserId = authUserData.user?.id ?? activeUserId;
  const authEmail = authUserData.user?.email ?? null;
  const subscriptionSelect =
    "status, plan, current_period_end, entitlement, entitlement_source, entitlement_expires_at";

  const { data, error } = await supabase
    .from("user_subscriptions")
    .select(subscriptionSelect)
    .eq("user_id", activeUserId);

  if (generation !== refreshGeneration) return featureAccessState;

  if (error) {
    const adminLifetimeAccess = false;
    const revenueCatStyleAccess = false;
    const computedIsPro = getEffectiveProAccess(
      null,
      featureAccessState.revenueCatLoaded,
      featureAccessState.revenueCatIsPro,
    );

    console.log("current auth user id", authUserId);
    console.log("current auth email", authEmail);
    console.log("subscription object used", null);
    console.log("subscription row loaded from Supabase", null);
    console.log("adminLifetimeAccess", adminLifetimeAccess);
    console.log("revenueCatStyleAccess", revenueCatStyleAccess);
    console.log("revenuecat result", featureAccessState.revenueCatIsPro);
    console.log("final isPro", computedIsPro);

    publishFeatureAccess({
      userId: activeUserId,
      subscription: null,
      isPro: computedIsPro,
      revenueCatLoaded: featureAccessState.revenueCatLoaded,
      revenueCatIsPro: featureAccessState.revenueCatIsPro,
      loading: false,
      loadedAt: new Date().toISOString(),
      source,
      error: error.message,
    });
    return featureAccessState;
  }

  const subscriptions = (data || []) as UserSubscription[];
  const subscription =
    subscriptions.find(hasSchedovaProAccess) || subscriptions[0] || null;
  const adminLifetimeAccess = hasAdminLifetimeSchedovaProAccess(subscription);
  const revenueCatStyleAccess =
    hasRevenueCatStyleSchedovaProAccess(subscription);
  const computedIsPro = getEffectiveProAccess(
    subscription,
    featureAccessState.revenueCatLoaded,
    featureAccessState.revenueCatIsPro,
  );

  console.log("current auth user id", authUserId);
  console.log("current auth email", authEmail);
  console.log("subscription object used", subscription);
  console.log("subscription row loaded from Supabase", subscription);
  console.log("adminLifetimeAccess", adminLifetimeAccess);
  console.log("revenueCatStyleAccess", revenueCatStyleAccess);
  console.log("revenuecat result", featureAccessState.revenueCatIsPro);
  console.log("final isPro", computedIsPro);

  publishFeatureAccess({
    userId: activeUserId,
    subscription,
    isPro: computedIsPro,
    revenueCatLoaded: featureAccessState.revenueCatLoaded,
    revenueCatIsPro: featureAccessState.revenueCatIsPro,
    loading: false,
    loadedAt: new Date().toISOString(),
    source,
    error: null,
  });

  return featureAccessState;
}

export function isPro() {
  return ENABLE_PRO && featureAccessState.isPro;
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
    case "smsAutomation":
    case "smartReminders":
    case "waitlist":
    case "noShowTracker":
    case "depositTracking":
    case "photoGallery":
    case "serviceFormulas":
    case "customBusinessHours":
      return isPro();
    default:
      return false;
  }
}
