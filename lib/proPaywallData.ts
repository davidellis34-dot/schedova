import type { CustomerInfo, PurchasesOffering, PurchasesPackage } from "react-native-purchases";

import { REVENUECAT_PRODUCT_IDS } from "./revenuecat/constants";
import {
  checkTrialOrIntroductoryPriceEligibility,
  prefetchRevenueCatOfferings,
  type RevenueCatTrialEligibility,
} from "./revenuecat/revenueCatService";
import {
  buildMonthlyPlanCopy,
  hasProductTrialOffer,
  isLifetimePackage,
  isMonthlyPackage,
  isYearlyPackage,
  resolveTrialEligibility,
  type MonthlyPlanCopy,
} from "./proPaywallUtils";

export type ProPaywallSnapshot = {
  availablePackages: PurchasesPackage[];
  lifetimePackage: PurchasesPackage | null;
  monthlyPackage: PurchasesPackage | null;
  monthlyPlanCopy: MonthlyPlanCopy;
  offering: PurchasesOffering | null;
  yearlyPackage: PurchasesPackage | null;
};

function findPackage(
  packages: PurchasesPackage[],
  matcher: (pkg: PurchasesPackage) => boolean,
) {
  return packages.find(matcher) || null;
}

function getKnownSubscriptionProductIds(packages: PurchasesPackage[]) {
  return packages.map((pkg) => String(pkg.product.identifier || "").trim()).filter(Boolean);
}

function hasPriorSubscriptionHistory(
  customerInfo: CustomerInfo | null | undefined,
  productIdentifiers: string[],
) {
  const purchasedIds = new Set(
    (customerInfo?.allPurchasedProductIdentifiers || [])
      .map((identifier) => String(identifier || "").trim())
      .filter(Boolean),
  );

  return productIdentifiers.some((productId) => purchasedIds.has(productId));
}

export async function loadProPaywallSnapshot(
  customerInfo?: CustomerInfo | null,
): Promise<ProPaywallSnapshot> {
  const offering = await prefetchRevenueCatOfferings();
  const availablePackages = offering?.availablePackages || [];
  const monthlyPackage =
    offering?.monthly ||
    findPackage(availablePackages, (pkg) => isMonthlyPackage(pkg)) ||
    null;
  const yearlyPackage =
    offering?.annual ||
    findPackage(availablePackages, (pkg) => isYearlyPackage(pkg)) ||
    null;
  const lifetimePackage =
    offering?.lifetime ||
    findPackage(availablePackages, (pkg) => isLifetimePackage(pkg)) ||
    null;
  const monthlyProductId = String(monthlyPackage?.product.identifier || "").trim();
  const subscriptionProductIds = getKnownSubscriptionProductIds(
    [monthlyPackage, yearlyPackage, lifetimePackage].filter(Boolean) as PurchasesPackage[],
  );
  const fallbackSubscriptionProductIds = [
    ...subscriptionProductIds,
    REVENUECAT_PRODUCT_IDS.monthly,
    REVENUECAT_PRODUCT_IDS.yearly,
  ].filter(Boolean);
  const trialEligibilityMap = monthlyProductId
    ? await checkTrialOrIntroductoryPriceEligibility([monthlyProductId])
    : {};
  const hasMonthlyTrialOffer = hasProductTrialOffer(monthlyPackage?.product || null);
  const previousSubscriptionHistory = hasPriorSubscriptionHistory(
    customerInfo,
    fallbackSubscriptionProductIds,
  );
  const monthlyTrialEligibility = resolveTrialEligibility({
    hasPriorSubscriptionHistory: previousSubscriptionHistory,
    hasTrialOffer: hasMonthlyTrialOffer,
    heuristicEligibility: hasMonthlyTrialOffer
      ? !previousSubscriptionHistory
      : null,
    revenueCatEligibilityStatus: monthlyProductId
      ? (trialEligibilityMap[monthlyProductId] as RevenueCatTrialEligibility | undefined) ||
        "unknown"
      : "unavailable",
  });

  return {
    availablePackages,
    lifetimePackage,
    monthlyPackage,
    monthlyPlanCopy: buildMonthlyPlanCopy({
      product: monthlyPackage?.product || null,
      trialEligibility: monthlyTrialEligibility,
    }),
    offering: offering || null,
    yearlyPackage,
  };
}
