export type UserSubscription = {
  status?: string | null;
  plan?: string | null;
  current_period_end?: string | null;
  currentPeriodEnd?: string | null;
  entitlement?: string | null;
  entitlement_source?: string | null;
  entitlementSource?: string | null;
  entitlement_expires_at?: string | null;
  entitlementExpiresAt?: string | null;
};

function normalize(value: string | null | undefined) {
  return String(value || "")
    .trim()
    .toLowerCase();
}

function getEntitlementSource(subscription: UserSubscription) {
  return subscription.entitlement_source ?? subscription.entitlementSource ?? null;
}

function getEntitlementExpiresAt(subscription: UserSubscription) {
  return (
    subscription.entitlement_expires_at ??
    subscription.entitlementExpiresAt ??
    null
  );
}

export function isOpenOrFuture(value: string | null | undefined) {
  if (!value) return true;

  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) && timestamp > Date.now();
}

export function hasAdminLifetimeSchedovaProAccess(
  subscription: UserSubscription | null | undefined,
) {
  if (!subscription) return false;

  return (
    normalize(subscription.status) === "active" &&
    normalize(subscription.plan) === "lifetime" &&
    normalize(subscription.entitlement) === "schedova_pro" &&
    ["admin", "manual"].includes(normalize(getEntitlementSource(subscription))) &&
    !getEntitlementExpiresAt(subscription)
  );
}

export function hasRevenueCatStyleSchedovaProAccess(
  subscription: UserSubscription | null | undefined,
) {
  if (!subscription) return false;

  return (
    normalize(subscription.status) === "active" &&
    normalize(subscription.entitlement) === "schedova_pro" &&
    isOpenOrFuture(getEntitlementExpiresAt(subscription))
  );
}

export function hasSchedovaProAccess(
  subscription: UserSubscription | null | undefined,
) {
  return (
    hasAdminLifetimeSchedovaProAccess(subscription) ||
    hasRevenueCatStyleSchedovaProAccess(subscription)
  );
}

export function getSchedovaProFriendlyStatus(
  subscription: UserSubscription | null | undefined,
) {
  if (hasAdminLifetimeSchedovaProAccess(subscription)) {
    return "Lifetime access";
  }

  if (hasRevenueCatStyleSchedovaProAccess(subscription)) {
    return "Subscription active";
  }

  return "No subscription";
}
