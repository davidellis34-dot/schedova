import type { CustomerInfo } from "react-native-purchases";

import {
  hasAdminLifetimeSchedovaProAccess,
  hasSchedovaProAccess,
  type UserSubscription,
} from "../subscriptionAccess";
import { supabase } from "../supabase";
import {
  REVENUECAT_ENTITLEMENT_ID,
  REVENUECAT_PRODUCT_IDS,
} from "./constants";
import { getSchedovaProEntitlement } from "./revenueCatService";

export type SubscriptionSyncSummary = {
  direction: "revenuecat_to_supabase";
  userId: string;
  status: "active" | "inactive";
  entitlement: string;
  entitlementSource: "revenuecat";
  syncedAt: string;
  skipped?: false;
  error?: string | null;
};

export type SubscriptionSyncSkipSummary = {
  direction: "revenuecat_to_supabase";
  userId: string | null;
  status: "skipped";
  reason: string;
  syncedAt: string;
  skipped: true;
  error?: string | null;
};

export type LastSubscriptionSyncSummary =
  | SubscriptionSyncSummary
  | SubscriptionSyncSkipSummary
  | null;

let lastSubscriptionSyncSummary: LastSubscriptionSyncSummary = null;

function derivePlan(productIdentifier: string | null | undefined) {
  const productId = String(productIdentifier || "").toLowerCase();

  if (productId.includes("lifetime")) return "lifetime";
  if (productId.includes("yearly") || productId.includes("annual")) {
    return "yearly";
  }
  if (productId.includes("monthly")) return "monthly";

  if (productId === REVENUECAT_PRODUCT_IDS.yearly) return "yearly";
  if (productId === REVENUECAT_PRODUCT_IDS.monthly) return "monthly";

  return productIdentifier ? "pro" : "free";
}

function isOpenOrFuture(value: string | null | undefined) {
  if (!value) return true;

  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) && timestamp > Date.now();
}

function getSchedovaProEntitlementRecord(
  customerInfo: CustomerInfo | null | undefined,
) {
  return customerInfo?.entitlements?.all?.[REVENUECAT_ENTITLEMENT_ID] || null;
}

function hasExplicitInactiveRevenueCatEntitlement(
  customerInfo: CustomerInfo | null | undefined,
) {
  const entitlement = getSchedovaProEntitlementRecord(customerInfo);

  if (!entitlement || entitlement.isActive) return false;

  const expirationExpired = !isOpenOrFuture(entitlement.expirationDate);
  const revokedOrCancelled = Boolean(entitlement.unsubscribeDetectedAt);
  const billingFailure = Boolean(entitlement.billingIssueDetectedAt);

  return expirationExpired || revokedOrCancelled || billingFailure;
}

export function getLastSubscriptionSyncSummary() {
  return lastSubscriptionSyncSummary;
}

export async function syncRevenueCatSubscriptionToSupabase({
  userId,
  customerInfo,
  allowInactive = false,
}: {
  userId: string | null | undefined;
  customerInfo: CustomerInfo | null | undefined;
  allowInactive?: boolean;
}) {
  if (!userId || !customerInfo) {
    lastSubscriptionSyncSummary = {
      direction: "revenuecat_to_supabase",
      userId: userId ?? null,
      status: "skipped",
      reason: "missing_user_or_customer_info",
      syncedAt: new Date().toISOString(),
      skipped: true,
      error: null,
    };
    return;
  }

  const entitlement = getSchedovaProEntitlement(customerInfo);
  const entitlementRecord = getSchedovaProEntitlementRecord(customerInfo);
  const productIdentifier =
    entitlement?.productIdentifier || entitlementRecord?.productIdentifier || null;
  const expirationDate =
    entitlement?.expirationDate || entitlementRecord?.expirationDate || null;
  const active = Boolean(entitlement);
  const explicitInactiveRevenueCatEntitlement =
    hasExplicitInactiveRevenueCatEntitlement(customerInfo);
  const { data: existingRowData, error: existingRowError } = await supabase
    .from("user_subscriptions")
    .select(
      "status, plan, current_period_end, entitlement, entitlement_source, entitlement_expires_at, updated_at",
    )
    .eq("user_id", userId)
    .maybeSingle();
  const existingSubscription =
    (existingRowData as (UserSubscription & { updated_at?: string | null }) | null) ??
    null;

  console.log("subscription row before RevenueCat sync", existingSubscription);
  console.log("RevenueCat customer info entitlement result", {
    entitlement: REVENUECAT_ENTITLEMENT_ID,
    active,
    explicitInactiveRevenueCatEntitlement,
    productIdentifier,
    expirationDate,
    willRenew: entitlementRecord?.willRenew ?? null,
    unsubscribeDetectedAt: entitlementRecord?.unsubscribeDetectedAt ?? null,
    billingIssueDetectedAt: entitlementRecord?.billingIssueDetectedAt ?? null,
  });

  if (existingRowError && __DEV__) {
    console.log(
      "[RevenueCat] Existing user_subscriptions lookup failed before sync",
      existingRowError.message,
    );
  }

  const existingAdminLifetimeProtectionActive =
    hasAdminLifetimeSchedovaProAccess(existingSubscription);

  console.log(
    "admin lifetime protection skipped downgrade",
    existingAdminLifetimeProtectionActive,
  );

  if (existingAdminLifetimeProtectionActive) {
    const computedIsPro = hasSchedovaProAccess(existingSubscription);

    console.log("subscription row after sync", existingSubscription);
    console.log("computed isPro", computedIsPro);

    lastSubscriptionSyncSummary = {
      direction: "revenuecat_to_supabase",
      userId,
      status: "skipped",
      reason: "preserved_admin_lifetime_schedova_pro",
      syncedAt: new Date().toISOString(),
      skipped: true,
      error: null,
    };
    return;
  }

  if (!active && !allowInactive) {
    const computedIsPro = hasSchedovaProAccess(existingSubscription);

    console.log("subscription row after sync", existingSubscription);
    console.log("computed isPro", computedIsPro);

    lastSubscriptionSyncSummary = {
      direction: "revenuecat_to_supabase",
      userId,
      status: "skipped",
      reason: "inactive_sync_not_confirmed",
      syncedAt: new Date().toISOString(),
      skipped: true,
      error: null,
    };

    if (__DEV__) {
      console.log(
        "[RevenueCat] Supabase inactive sync skipped until RevenueCat confirms inactive for current user",
      );
    }

    return;
  }

  const preserveExistingActiveSchedovaPro =
    !active &&
    hasSchedovaProAccess(existingSubscription) &&
    !explicitInactiveRevenueCatEntitlement;

  if (preserveExistingActiveSchedovaPro) {
    console.log("subscription row after sync", existingSubscription);
    console.log("computed isPro", true);

    if (__DEV__) {
      console.log(
        "[RevenueCat] Preserved existing active schedova_pro subscription; inactive RevenueCat result was not explicit enough to downgrade",
        {
          userId,
          entitlement: REVENUECAT_ENTITLEMENT_ID,
          expirationDate,
        },
      );
    }

    lastSubscriptionSyncSummary = {
      direction: "revenuecat_to_supabase",
      userId,
      status: "skipped",
      reason: "preserved_existing_active_schedova_pro",
      syncedAt: new Date().toISOString(),
      skipped: true,
      error: null,
    };
    return;
  }

  const syncedAt = new Date().toISOString();
  const payloadBeforeGuard = {
    user_id: userId,
    status: active ? "active" : "inactive",
    plan: active ? derivePlan(productIdentifier) : "free",
    current_period_end: expirationDate,
    entitlement: REVENUECAT_ENTITLEMENT_ID,
    entitlement_source: "revenuecat",
    entitlement_expires_at: expirationDate,
    updated_at: syncedAt,
  };
  const subscriptionPayload = payloadBeforeGuard;

  console.log("subscription write requested", {
    userId,
  });
  console.log("payload before guard", payloadBeforeGuard);
  console.log("final payload written", subscriptionPayload);

  let { error } = await supabase
    .from("user_subscriptions")
    .upsert(subscriptionPayload, { onConflict: "user_id" });

  if (error?.code === "23505") {
    const fallback = await supabase
      .from("user_subscriptions")
      .update(subscriptionPayload)
      .eq("user_id", userId);

    error = fallback.error;
  }

  const { data: syncedRowData, error: syncedRowError } = await supabase
    .from("user_subscriptions")
    .select(
      "status, plan, current_period_end, entitlement, entitlement_source, entitlement_expires_at, updated_at",
    )
    .eq("user_id", userId)
    .maybeSingle();
  const syncedSubscription =
    (syncedRowData as (UserSubscription & { updated_at?: string | null }) | null) ??
    null;
  const computedIsPro = hasSchedovaProAccess(syncedSubscription);

  console.log("row after write", syncedSubscription);
  console.log("subscription row after sync", syncedSubscription);
  console.log("computed isPro", computedIsPro);

  if (syncedRowError && __DEV__) {
    console.log(
      "[RevenueCat] user_subscriptions lookup failed after sync",
      syncedRowError.message,
    );
  }

  lastSubscriptionSyncSummary = {
    direction: "revenuecat_to_supabase",
    userId,
    status: subscriptionPayload.status === "active" ? "active" : "inactive",
    entitlement: subscriptionPayload.entitlement || REVENUECAT_ENTITLEMENT_ID,
    entitlementSource: "revenuecat",
    syncedAt,
    skipped: false,
    error: error?.message ?? null,
  };

  if (error && __DEV__) {
    console.log("RevenueCat Supabase sync failed:", error.message);
  }
}
