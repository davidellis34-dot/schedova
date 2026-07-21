export type PeriodUnitLike =
  | "DAY"
  | "WEEK"
  | "MONTH"
  | "YEAR"
  | string;

export type PeriodLike =
  | {
      unit: PeriodUnitLike;
      value: number;
    }
  | string
  | null
  | undefined;

export type FreePhaseLike = {
  billingPeriod?: PeriodLike;
} | null;

export type SubscriptionOptionLike = {
  billingPeriod?: PeriodLike;
  freePhase?: FreePhaseLike;
  fullPricePhase?: {
    billingPeriod?: PeriodLike;
  } | null;
} | null;

export type IntroPriceLike = {
  cycles?: number | null;
  period?: string | null;
  periodNumberOfUnits?: number | null;
  periodUnit?: string | null;
  price?: number | null;
  priceString?: string | null;
} | null;

export type StoreProductLike = {
  defaultOption?: SubscriptionOptionLike;
  identifier?: string | null;
  introPrice?: IntroPriceLike;
  priceString?: string | null;
  subscriptionPeriod?: string | null;
} | null;

export type PackageLike = {
  identifier?: string | null;
  packageType?: string | null;
  product: StoreProductLike;
} | null;

export type RevenueCatEligibilityStatus =
  | "eligible"
  | "ineligible"
  | "unknown"
  | "unavailable"
  | null;

export type TrialEligibility =
  | "eligible"
  | "ineligible"
  | "unknown"
  | "unavailable";

export type PurchaseFlowOutcome =
  | "success"
  | "cancelled"
  | "pending_refresh"
  | "failure";

export type MonthlyPlanCopy = {
  autoRenewNotice: string;
  ctaLabel: string;
  priceLine: string;
  renewalPriceLine: string;
  trialEligibility: TrialEligibility;
  trialDurationLabel: string | null;
};

function normalizeText(value: string | null | undefined) {
  return String(value || "").trim().toLowerCase();
}

function singularize(unit: string) {
  const cleanUnit = normalizeText(unit);
  if (cleanUnit.endsWith("s")) {
    return cleanUnit.slice(0, -1);
  }
  return cleanUnit;
}

function formatUnitLabel(unit: string, value: number) {
  const singularUnit = singularize(unit) || "period";
  return value === 1 ? singularUnit : `${singularUnit}s`;
}

function formatPeriodValue(value: number, unit: string) {
  if (!Number.isFinite(value) || value <= 0) return null;
  return `${value} ${formatUnitLabel(unit, value)}`;
}

function parseIsoPeriod(period: string) {
  const match = /^P(?:(\d+)D|(\d+)W|(\d+)M|(\d+)Y)$/i.exec(period.trim());
  if (!match) return null;

  if (match[1]) return { unit: "DAY", value: Number(match[1]) };
  if (match[2]) return { unit: "WEEK", value: Number(match[2]) };
  if (match[3]) return { unit: "MONTH", value: Number(match[3]) };
  if (match[4]) return { unit: "YEAR", value: Number(match[4]) };

  return null;
}

export function formatRecurringPeriodLabel(period: PeriodLike) {
  if (!period) return null;

  if (typeof period === "string") {
    const parsed = parseIsoPeriod(period);
    return parsed ? formatPeriodValue(parsed.value, parsed.unit) : null;
  }

  return formatPeriodValue(Number(period.value), String(period.unit || ""));
}

export function formatRecurringPeriodSuffix(period: PeriodLike) {
  const label = formatRecurringPeriodLabel(period);
  if (!label) return "";

  const singular = singularize(label.split(" ").slice(1).join(" "));
  return singular ? ` / ${singular}` : "";
}

function getPackageTypeLabel(pkg: PackageLike) {
  const packageType = normalizeText(pkg?.packageType);
  const productId = normalizeText(pkg?.product?.identifier);

  if (packageType.includes("lifetime") || productId.includes("lifetime")) {
    return "lifetime";
  }
  if (
    packageType.includes("annual") ||
    packageType.includes("year") ||
    productId.includes("annual") ||
    productId.includes("year")
  ) {
    return "yearly";
  }
  if (
    packageType.includes("month") ||
    productId.includes("month") ||
    productId.includes("monthly")
  ) {
    return "monthly";
  }

  return "other";
}

export function isMonthlyPackage(pkg: PackageLike) {
  return getPackageTypeLabel(pkg) === "monthly";
}

export function isYearlyPackage(pkg: PackageLike) {
  return getPackageTypeLabel(pkg) === "yearly";
}

export function isLifetimePackage(pkg: PackageLike) {
  return getPackageTypeLabel(pkg) === "lifetime";
}

export function getProductBillingPeriod(product: StoreProductLike) {
  return (
    product?.defaultOption?.billingPeriod ||
    product?.defaultOption?.fullPricePhase?.billingPeriod ||
    product?.subscriptionPeriod ||
    null
  );
}

export function getProductTrialDurationLabel(product: StoreProductLike) {
  const freePhasePeriod = product?.defaultOption?.freePhase?.billingPeriod;
  const freePhaseLabel = formatRecurringPeriodLabel(freePhasePeriod);

  if (freePhaseLabel) {
    return freePhaseLabel;
  }

  const introPrice = product?.introPrice;
  if (!introPrice) return null;

  const introIsFree = Number(introPrice.price || 0) <= 0;
  if (!introIsFree) return null;

  const introPeriod =
    introPrice.period ||
    (introPrice.periodUnit && introPrice.periodNumberOfUnits
      ? `P${introPrice.periodNumberOfUnits}${String(introPrice.periodUnit).slice(0, 1)}`
      : null);
  const parsed = introPeriod ? parseIsoPeriod(introPeriod) : null;

  if (!parsed) return null;

  const cycles = Number(introPrice.cycles || 1);
  const totalValue = parsed.value * (Number.isFinite(cycles) && cycles > 0 ? cycles : 1);
  return formatPeriodValue(totalValue, parsed.unit);
}

export function hasProductTrialOffer(product: StoreProductLike) {
  return Boolean(getProductTrialDurationLabel(product));
}

export function getLocalizedRecurringPrice(product: StoreProductLike) {
  const price = String(product?.priceString || "").trim();
  if (!price) return null;

  return `${price}${formatRecurringPeriodSuffix(getProductBillingPeriod(product))}`;
}

export function resolveTrialEligibility(options: {
  hasPriorSubscriptionHistory?: boolean;
  hasTrialOffer: boolean;
  heuristicEligibility?: boolean | null;
  revenueCatEligibilityStatus?: RevenueCatEligibilityStatus;
}) {
  if (!options.hasTrialOffer) {
    return "unavailable" satisfies TrialEligibility;
  }

  if (options.revenueCatEligibilityStatus === "eligible") {
    return "eligible" satisfies TrialEligibility;
  }

  if (options.revenueCatEligibilityStatus === "ineligible") {
    return "ineligible" satisfies TrialEligibility;
  }

  if (options.revenueCatEligibilityStatus === "unavailable") {
    return "unavailable" satisfies TrialEligibility;
  }

  if (options.heuristicEligibility === true) {
    return "eligible" satisfies TrialEligibility;
  }

  if (options.heuristicEligibility === false) {
    return "ineligible" satisfies TrialEligibility;
  }

  if (options.hasPriorSubscriptionHistory) {
    return "ineligible" satisfies TrialEligibility;
  }

  return "unknown" satisfies TrialEligibility;
}

function toTrialCtaDuration(label: string | null) {
  if (!label) return "Free Trial";

  const [valueText, unitText = ""] = label.split(" ");
  const value = Number(valueText);
  const singularUnit = singularize(unitText);

  if (!Number.isFinite(value) || !singularUnit) {
    return "Free Trial";
  }

  return `${value}-${singularUnit.charAt(0).toUpperCase()}${singularUnit.slice(1)}`;
}

export function buildMonthlyPlanCopy(options: {
  product: StoreProductLike;
  trialEligibility: TrialEligibility;
}) {
  const product = options.product;
  const trialDurationLabel = getProductTrialDurationLabel(product);
  const renewalPriceLine = getLocalizedRecurringPrice(product);

  if (!renewalPriceLine) {
    return {
      autoRenewNotice:
        "The App Store or Google Play will show the final renewal terms before checkout.",
      ctaLabel: "View Pro Plans",
      priceLine:
        "Monthly pricing will load from the App Store or Google Play before checkout.",
      renewalPriceLine: "",
      trialDurationLabel,
      trialEligibility: options.trialEligibility,
    } satisfies MonthlyPlanCopy;
  }

  if (
    options.trialEligibility === "eligible" &&
    trialDurationLabel
  ) {
    return {
      autoRenewNotice:
        "Payment starts automatically after the trial unless canceled first.",
      ctaLabel: `Start ${toTrialCtaDuration(trialDurationLabel)} Free Trial`,
      priceLine: `Free for ${trialDurationLabel}, then ${renewalPriceLine}. Cancel anytime.`,
      renewalPriceLine,
      trialDurationLabel,
      trialEligibility: options.trialEligibility,
    } satisfies MonthlyPlanCopy;
  }

  return {
    autoRenewNotice:
      "Payment starts right away and renews automatically unless canceled.",
    ctaLabel: "Subscribe Monthly",
    priceLine: `${renewalPriceLine}. Cancel anytime.`,
    renewalPriceLine,
    trialDurationLabel,
    trialEligibility: options.trialEligibility,
  } satisfies MonthlyPlanCopy;
}

export function resolvePurchaseFlowOutcome(options: {
  purchaseCancelled?: boolean;
  purchaseCompleted?: boolean;
  refreshDelayed?: boolean;
}) {
  if (options.purchaseCancelled) {
    return "cancelled" satisfies PurchaseFlowOutcome;
  }

  if (options.purchaseCompleted) {
    return "success" satisfies PurchaseFlowOutcome;
  }

  if (options.refreshDelayed) {
    return "pending_refresh" satisfies PurchaseFlowOutcome;
  }

  return "failure" satisfies PurchaseFlowOutcome;
}
