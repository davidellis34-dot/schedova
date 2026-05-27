import { useEffect, useSyncExternalStore } from "react";

import { supabase } from "./supabase";

export const FREE_TIER_LIMITS = {
  clients: 25,
  services: 5,
  appointmentsPerMonth: 30,
  messageTemplates: 3,
  clientHistoryItems: 3,
} as const;

export const PRO_FEATURE_PREVIEWS = [
  "Automatic SMS reminders and confirmations",
  "Smart rebooking and follow-up reminders",
  "Revenue dashboard / business insights",
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

type UserSubscription = {
  status?: string | null;
  plan?: string | null;
  current_period_end?: string | null;
  entitlement?: string | null;
  entitlement_source?: string | null;
  entitlement_expires_at?: string | null;
};

type FeatureAccessState = {
  userId: string | null;
  subscription: UserSubscription | null;
  isPro: boolean;
  loading: boolean;
  loadedAt: string | null;
  source: string;
  error: string | null;
};

const initialState: FeatureAccessState = {
  userId: null,
  subscription: null,
  isPro: false,
  loading: false,
  loadedAt: null,
  source: "initial",
  error: null,
};

let featureAccessState = initialState;
let refreshGeneration = 0;
let lastHookRefreshAt = 0;
const listeners = new Set<() => void>();

function normalize(value: string | null | undefined) {
  return String(value || "")
    .trim()
    .toLowerCase();
}

function isOpenOrFuture(value: string | null | undefined) {
  if (!value) return true;

  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) && timestamp > Date.now();
}

function hasActiveProSubscription(subscription: UserSubscription | null) {
  if (!subscription) return false;

  const entitlementPro =
    normalize(subscription.entitlement) === "pro" &&
    isOpenOrFuture(subscription.entitlement_expires_at);

  const paidPlanActive =
    normalize(subscription.status) === "active" &&
    ["pro", "paid"].includes(normalize(subscription.plan)) &&
    isOpenOrFuture(subscription.current_period_end);

  return entitlementPro || paidPlanActive;
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

  const { data, error } = await supabase
    .from("user_subscriptions")
    .select(
      "status, plan, current_period_end, entitlement, entitlement_source, entitlement_expires_at",
    )
    .eq("user_id", activeUserId);

  if (generation !== refreshGeneration) return featureAccessState;

  if (error) {
    publishFeatureAccess({
      userId: activeUserId,
      subscription: null,
      isPro: false,
      loading: false,
      loadedAt: new Date().toISOString(),
      source,
      error: error.message,
    });
    return featureAccessState;
  }

  const subscriptions = (data || []) as UserSubscription[];
  const subscription =
    subscriptions.find(hasActiveProSubscription) || subscriptions[0] || null;

  publishFeatureAccess({
    userId: activeUserId,
    subscription,
    isPro: subscriptions.some(hasActiveProSubscription),
    loading: false,
    loadedAt: new Date().toISOString(),
    source,
    error: null,
  });

  return featureAccessState;
}

export function isPro() {
  return featureAccessState.isPro;
}

export function canUseFeature(feature: FeatureKey) {
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
