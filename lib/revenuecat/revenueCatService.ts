import Constants from "expo-constants";
import { Platform } from "react-native";
import type {
  CustomerInfo,
  PRODUCT_CATEGORY,
  PurchasesOffering,
  PurchasesPackage,
  PurchasesStoreProduct,
} from "react-native-purchases";

import {
  getRevenueCatApiKey,
  getRevenueCatApiKeyPrefix,
  REVENUECAT_ENTITLEMENT_ID,
  REVENUECAT_OFFERING_ID,
  REVENUECAT_PRODUCT_IDS,
} from "./constants";

type PurchasesModule = typeof import("react-native-purchases");
type PurchasesUiModule = typeof import("react-native-purchases-ui");
type PurchasesOfferings = Awaited<
  ReturnType<PurchasesModule["default"]["getOfferings"]>
>;
type CustomerInfoListener = (customerInfo: CustomerInfo) => void;
type RevenueCatErrorRecord = {
  code?: unknown;
  message?: unknown;
  readableErrorCode?: unknown;
  underlyingErrorMessage?: unknown;
  userCancelled?: unknown;
  userInfo?: {
    readableErrorCode?: unknown;
  };
};

export type RevenueCatErrorDetails = {
  code: unknown | null;
  message: string;
  underlyingErrorMessage: string | null;
  readableErrorCode: string | null;
  userCancelled: boolean | null;
};

export type RevenueCatDebugSnapshot = {
  appUserID: string | null;
  originalAppUserID: string | null;
  isAnonymous: boolean | null;
  schedovaProActive: boolean;
  activeEntitlementIdentifiers: string[];
  entitlementDetails: Array<{
    identifier: string;
    isActive: boolean;
    productIdentifier: string | null;
    expirationDate: string | null;
    latestPurchaseDate: string | null;
    willRenew: boolean | null;
    store: string | null;
  }>;
  currentOfferingIdentifier: string | null;
  sdkKeyPrefix: string | null;
  packages: Array<{
    identifier: string;
    productId: string;
  }>;
  fetchedAt: string;
  lastError: RevenueCatErrorDetails | null;
};

export type RevenueCatSupportState = {
  supported: boolean;
  platform: string;
  appOwnership: string | null;
  reason: "expo_go" | "unsupported_platform" | null;
};

export type RevenueCatConfigurationState = {
  configured: boolean;
  configuredAppUserId: string | null;
  lastError: RevenueCatErrorDetails | null;
};

let configured = false;
let configuredAppUserId: string | null = null;
let purchasesModulePromise: Promise<PurchasesModule> | null = null;
let purchasesUiModulePromise: Promise<PurchasesUiModule> | null = null;
let lastRevenueCatErrorDetails: RevenueCatErrorDetails | null = null;
const REVENUECAT_OPERATION_TIMEOUT_MS = 20_000;
const REVENUECAT_UI_TIMEOUT_MS = 35_000;
const REVENUECAT_OFFERING_CACHE_MS = 60_000;
const SUBSCRIPTION_OPTIONS_UNAVAILABLE_CODE =
  "subscription_options_unavailable";
const EXPECTED_REVENUECAT_PRODUCT_IDS: string[] =
  Object.values(REVENUECAT_PRODUCT_IDS);
let cachedCurrentOffering: PurchasesOffering | null = null;
let cachedOfferingFetchedAt = 0;
let offeringFetchPromise: Promise<PurchasesOffering | null> | null = null;

function getActiveRevenueCatEntitlements(
  customerInfo: CustomerInfo | null | undefined,
) {
  return customerInfo?.entitlements?.active ?? {};
}

function getAllRevenueCatEntitlements(
  customerInfo: CustomerInfo | null | undefined,
) {
  return customerInfo?.entitlements?.all ?? {};
}

function getRevenueCatOfferingMap(
  offerings: PurchasesOfferings | null | undefined,
) {
  return offerings?.all ?? {};
}

function getRevenueCatAvailablePackages(
  offering: PurchasesOffering | null | undefined,
) {
  return Array.isArray(offering?.availablePackages)
    ? offering.availablePackages
    : [];
}

function getRevenueCatNonSubscriptionTransactions(
  customerInfo: CustomerInfo | null | undefined,
) {
  return Array.isArray(customerInfo?.nonSubscriptionTransactions)
    ? customerInfo.nonSubscriptionTransactions
    : [];
}

function isExpoGo() {
  return Constants.appOwnership === "expo";
}

export function getRevenueCatSupportState(): RevenueCatSupportState {
  const platformSupported = Platform.OS === "ios" || Platform.OS === "android";
  const appOwnership = Constants.appOwnership ?? null;

  if (!platformSupported) {
    return {
      supported: false,
      platform: Platform.OS,
      appOwnership,
      reason: "unsupported_platform",
    };
  }

  if (isExpoGo()) {
    return {
      supported: false,
      platform: Platform.OS,
      appOwnership,
      reason: "expo_go",
    };
  }

  return {
    supported: true,
    platform: Platform.OS,
    appOwnership,
    reason: null,
  };
}

export function isRevenueCatSupported() {
  return getRevenueCatSupportState().supported;
}

function logRevenueCatRuntime(apiKey?: string) {
  console.log("[RevenueCat] Configuring RevenueCat");
  console.log("[RevenueCat] Platform:", Platform.OS);
  console.log("[RevenueCat] App ownership:", Constants.appOwnership);
  console.log("[RevenueCat] __DEV__:", __DEV__);
  console.log("[RevenueCat] API key present:", Boolean(apiKey));
  console.log(
    "[RevenueCat] API key type:",
    apiKey?.startsWith("test_") ? "test" : apiKey ? "platform" : "missing",
  );
  console.log("[RevenueCat] Using entitlement:", REVENUECAT_ENTITLEMENT_ID);
  console.log("[RevenueCat] Expected offering:", REVENUECAT_OFFERING_ID);
  console.log(
    "[RevenueCat] Expected product IDs:",
    EXPECTED_REVENUECAT_PRODUCT_IDS,
  );

  if (apiKey) {
    console.log("[RevenueCat] SDK key prefix:", apiKey.slice(0, 5));
  }
}

function summarizePackage(pkg: PurchasesPackage) {
  return {
    identifier: pkg.identifier,
    packageType: String(pkg.packageType ?? ""),
    productId: pkg.product.identifier,
    title: pkg.product.title,
    priceString: pkg.product.priceString,
  };
}

function summarizeStoreProduct(product: PurchasesStoreProduct) {
  return {
    identifier: product.identifier,
    title: product.title,
    priceString: product.priceString,
    productCategory: product.productCategory,
    productType: product.productType,
  };
}

function summarizeOffering(offering: PurchasesOffering | null | undefined) {
  if (!offering) return null;

  const packages = getRevenueCatAvailablePackages(offering);

  return {
    identifier: offering.identifier,
    packageCount: packages.length,
    packages: packages.map(summarizePackage),
  };
}

function summarizeOfferings(offerings: PurchasesOfferings) {
  return Object.values(getRevenueCatOfferingMap(offerings))
    .map(summarizeOffering)
    .filter(Boolean);
}

function logProductIdDiagnostics(selectedOffering: PurchasesOffering | null) {
  const loadedProductIds = getRevenueCatAvailablePackages(selectedOffering).map(
    (pkg) => pkg.product.identifier,
  );
  const matchedExpectedProductIds = loadedProductIds.filter((productId) =>
    EXPECTED_REVENUECAT_PRODUCT_IDS.includes(productId),
  );
  const unexpectedProductIds = loadedProductIds.filter(
    (productId) => !EXPECTED_REVENUECAT_PRODUCT_IDS.includes(productId),
  );

  console.log("[RevenueCat] Product ID diagnostics:", {
    expectedProductIds: EXPECTED_REVENUECAT_PRODUCT_IDS,
    loadedProductIds,
    matchedExpectedProductIds,
    unexpectedProductIds,
    hasExpectedProductIdMatch: matchedExpectedProductIds.length > 0,
  });
}

function logOfferings(offerings: PurchasesOfferings) {
  const currentPackages = getRevenueCatAvailablePackages(offerings.current);

  console.log("[RevenueCat] Offerings loaded:", true);
  console.log(
    "[RevenueCat] Offering identifiers:",
    Object.keys(getRevenueCatOfferingMap(offerings)),
  );
  console.log(
    "[RevenueCat] Current offering identifier:",
    offerings.current?.identifier ?? null,
  );
  console.log("[RevenueCat] Current packages count:", currentPackages.length);
  console.log(
    "[RevenueCat] Current packages:",
    currentPackages.map(summarizePackage),
  );
  console.log(
    "[RevenueCat] All offerings summary:",
    summarizeOfferings(offerings),
  );
}

function getErrorRecord(error: unknown) {
  return typeof error === "object" && error !== null
    ? (error as RevenueCatErrorRecord)
    : null;
}

export function getRevenueCatErrorDetails(
  error: unknown,
): RevenueCatErrorDetails {
  const record = getErrorRecord(error);
  const errorMessage = error instanceof Error ? error.message : null;

  return {
    code: record?.code ?? null,
    message:
      typeof record?.message === "string"
        ? record.message
        : (errorMessage ?? String(error || "")),
    underlyingErrorMessage:
      typeof record?.underlyingErrorMessage === "string"
        ? record.underlyingErrorMessage
        : null,
    readableErrorCode:
      typeof record?.userInfo?.readableErrorCode === "string"
        ? record.userInfo.readableErrorCode
        : typeof record?.readableErrorCode === "string"
          ? record.readableErrorCode
          : null,
    userCancelled:
      typeof record?.userCancelled === "boolean" ? record.userCancelled : null,
  };
}

export function logRevenueCatError(label: string, error: unknown) {
  lastRevenueCatErrorDetails = getRevenueCatErrorDetails(error);
  console.error(`[RevenueCat] ${label}:`, lastRevenueCatErrorDetails);
}

export function getLastRevenueCatErrorDetails() {
  return lastRevenueCatErrorDetails;
}

export function clearLastRevenueCatErrorDetails() {
  lastRevenueCatErrorDetails = null;
}

export function getRevenueCatConfigurationState(): RevenueCatConfigurationState {
  return {
    configured,
    configuredAppUserId,
    lastError: lastRevenueCatErrorDetails,
  };
}

export function isRevenueCatUnknownBackendError(error: unknown) {
  const details = getRevenueCatErrorDetails(error);
  const searchableDetails = [
    details.code,
    details.message,
    details.readableErrorCode,
    details.underlyingErrorMessage,
  ]
    .map((value) => String(value || "").toLowerCase())
    .join(" ");

  return (
    searchableDetails.includes("unknown_backend_error") ||
    searchableDetails.includes("unknownbackenderror") ||
    searchableDetails.includes("unknown backend error") ||
    searchableDetails.includes("backend code: n/a")
  );
}

export function isSubscriptionOptionsUnavailableError(error: unknown) {
  const details = getRevenueCatErrorDetails(error);
  const searchableDetails = [
    details.code,
    details.message,
    details.readableErrorCode,
    details.underlyingErrorMessage,
  ]
    .map((value) => String(value || "").toLowerCase())
    .join(" ");

  return (
    searchableDetails.includes(SUBSCRIPTION_OPTIONS_UNAVAILABLE_CODE) ||
    searchableDetails.includes("subscription options unavailable") ||
    searchableDetails.includes("no_current_offering") ||
    searchableDetails.includes("packages_empty")
  );
}

function createSubscriptionOptionsUnavailableError(reason: string) {
  const error = new Error(SUBSCRIPTION_OPTIONS_UNAVAILABLE_CODE) as Error &
    RevenueCatErrorRecord;

  error.code = SUBSCRIPTION_OPTIONS_UNAVAILABLE_CODE;
  error.readableErrorCode = "SUBSCRIPTION_OPTIONS_UNAVAILABLE";
  error.underlyingErrorMessage = reason;
  error.userInfo = {
    readableErrorCode: "SUBSCRIPTION_OPTIONS_UNAVAILABLE",
  };

  return error;
}

function createRevenueCatUiTimeoutError(operation: string) {
  const error = new Error(
    `${operation} did not finish within ${REVENUECAT_UI_TIMEOUT_MS / 1000} seconds.`,
  ) as Error & RevenueCatErrorRecord;

  error.code = "timeout";
  error.readableErrorCode = "REVENUECAT_UI_TIMEOUT";
  error.underlyingErrorMessage =
    "RevenueCat UI did not resolve before the app timeout.";

  return error;
}

function createRevenueCatOperationTimeoutError(
  operation: string,
  timeoutMs: number,
) {
  const error = new Error(
    `${operation} did not finish within ${timeoutMs / 1000} seconds.`,
  ) as Error & RevenueCatErrorRecord;

  error.code = "timeout";
  error.readableErrorCode = "REVENUECAT_OPERATION_TIMEOUT";
  error.underlyingErrorMessage =
    "RevenueCat or Google Play did not respond before the app timeout.";

  return error;
}

async function withRevenueCatUiTimeout<T>(
  operation: string,
  promise: Promise<T>,
) {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;

  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => {
          reject(createRevenueCatUiTimeoutError(operation));
        }, REVENUECAT_UI_TIMEOUT_MS);
      }),
    ]);
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
}

async function withRevenueCatOperationTimeout<T>(
  operation: string,
  promise: Promise<T>,
  timeoutMs = REVENUECAT_OPERATION_TIMEOUT_MS,
) {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;

  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => {
          reject(createRevenueCatOperationTimeoutError(operation, timeoutMs));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
}

async function getPurchasesModule() {
  if (!isRevenueCatSupported()) {
    throw new Error(
      "Purchases require an iOS or Android development build or release build.",
    );
  }

  if (!purchasesModulePromise) {
    purchasesModulePromise = import("react-native-purchases");
  }

  return purchasesModulePromise;
}

async function getRevenueCatUiModule() {
  if (!isRevenueCatSupported()) {
    throw new Error(
      "RevenueCat UI features require an iOS or Android development build or release build.",
    );
  }

  if (!purchasesUiModulePromise) {
    purchasesUiModulePromise = import("react-native-purchases-ui");
  }

  return purchasesUiModulePromise;
}

export async function configureRevenueCat(appUserID?: string | null) {
  if (!isRevenueCatSupported()) {
    console.log("[RevenueCat] RevenueCat is not supported in this runtime", {
      appOwnership: Constants.appOwnership,
      platform: Platform.OS,
    });
    return;
  }

  const PurchasesModule = await getPurchasesModule();
  const Purchases = PurchasesModule.default;
  const nextAppUserId = appUserID || null;

  if (__DEV__) {
    console.log("[RevenueCat] configure called", {
      configured,
      appUserID: nextAppUserId,
      configuredAppUserId,
    });
  }

  if (configured) {
    if (nextAppUserId && nextAppUserId !== configuredAppUserId) {
      const currentAppUserID = await Purchases.getAppUserID().catch(
        () => configuredAppUserId,
      );

      if (currentAppUserID !== nextAppUserId) {
        if (__DEV__) {
          console.log(
            "[RevenueCat] logIn called with appUserID",
            nextAppUserId,
          );
        }
        await Purchases.logIn(nextAppUserId);
      }

      configuredAppUserId = nextAppUserId;
    }

    return;
  }

  await Purchases.setLogLevel(
    __DEV__ ? PurchasesModule.LOG_LEVEL.DEBUG : PurchasesModule.LOG_LEVEL.WARN,
  );

  let apiKey: string;

  try {
    apiKey = getRevenueCatApiKey();
  } catch (error) {
    console.log("[RevenueCat] API key unavailable", {
      platform: Platform.OS,
      appOwnership: Constants.appOwnership,
      apiKeyPresent: false,
    });
    logRevenueCatError("RevenueCat API key unavailable", error);
    throw error;
  }

  logRevenueCatRuntime(apiKey);

  Purchases.configure({
    apiKey,
    appUserID: nextAppUserId,
  });

  configured = true;
  configuredAppUserId = nextAppUserId;

  console.log("[RevenueCat] RevenueCat configured", {
    platform: Platform.OS,
    appOwnership: Constants.appOwnership,
    appUserIDPresent: Boolean(nextAppUserId),
    apiKeyPresent: true,
    sdkKeyPrefix: apiKey.slice(0, 5),
  });
}

export async function logInRevenueCatUser(appUserID: string) {
  if (!isRevenueCatSupported()) return null;

  if (__DEV__) {
    console.log("[RevenueCat] logIn called with appUserID", appUserID);
  }

  await configureRevenueCat(appUserID);

  const Purchases = (await getPurchasesModule()).default;
  const currentAppUserID = await Purchases.getAppUserID().catch(() => null);
  const currentIsAnonymous = await Purchases.isAnonymous().catch(() => null);

  if (__DEV__) {
    console.log("[RevenueCat] current identity before logIn", {
      appUserID: currentAppUserID,
      isAnonymous: currentIsAnonymous,
      expectedAppUserID: appUserID,
    });
  }

  if (currentAppUserID === appUserID) {
    configuredAppUserId = appUserID;
    const customerInfo = await Purchases.getCustomerInfo();
    const [resultAppUserID, isAnonymous] = await Promise.all([
      Purchases.getAppUserID().catch(() => null),
      Purchases.isAnonymous().catch(() => null),
    ]);

    if (__DEV__) {
      console.log(
        "[RevenueCat] RevenueCat logIn result appUserID",
        resultAppUserID,
      );
      console.log("[RevenueCat] RevenueCat anonymous after login", isAnonymous);
      console.log("[RevenueCat] customerInfo fetched", {
        appUserID,
        isAnonymous,
        activeEntitlements: Object.keys(
          getActiveRevenueCatEntitlements(customerInfo),
        ),
      });
    }

    return customerInfo;
  }

  const result = await Purchases.logIn(appUserID);
  configuredAppUserId = appUserID;
  const [resultAppUserID, isAnonymous] = await Promise.all([
    Purchases.getAppUserID().catch(() => null),
    Purchases.isAnonymous().catch(() => null),
  ]);

  if (__DEV__) {
    console.log(
      "[RevenueCat] RevenueCat logIn result appUserID",
      resultAppUserID,
    );
    console.log("[RevenueCat] RevenueCat anonymous after login", isAnonymous);
      console.log("[RevenueCat] customerInfo fetched", {
        appUserID,
        isAnonymous,
        activeEntitlements: Object.keys(
          getActiveRevenueCatEntitlements(result.customerInfo),
        ),
      });
  }

  return result.customerInfo;
}

export async function logOutRevenueCatUser() {
  if (!isRevenueCatSupported()) return null;

  if (__DEV__) {
    console.log("[RevenueCat] RevenueCat logOut called");
  }

  await configureRevenueCat();

  const Purchases = (await getPurchasesModule()).default;
  configuredAppUserId = null;

  try {
    return await Purchases.logOut();
  } catch (error) {
    if (__DEV__) {
      console.log("RevenueCat logout skipped:", error);
    }

    return Purchases.getCustomerInfo().catch(() => null);
  }
}

export async function getCustomerInfo(
  appUserID?: string | null,
): Promise<CustomerInfo | null> {
  if (!isRevenueCatSupported()) return null;

  await configureRevenueCat(appUserID);

  const Purchases = (await getPurchasesModule()).default;

  try {
    const [currentAppUserID, isAnonymous, customerInfo] =
      await withRevenueCatOperationTimeout(
        "RevenueCat customer info refresh",
        Promise.all([
          Purchases.getAppUserID().catch(() => null),
          Purchases.isAnonymous().catch(() => null),
          Purchases.getCustomerInfo(),
        ]),
      );

    if (__DEV__) {
      console.log("[RevenueCat] customerInfo fetched", {
        appUserID: appUserID ?? null,
        currentAppUserID,
        isAnonymous,
        activeEntitlements: Object.keys(
          getActiveRevenueCatEntitlements(customerInfo),
        ),
      });
    }

    return customerInfo;
  } catch (error) {
    console.log("[RevenueCat] customerInfo failure", {
      appUserID: appUserID ?? null,
      error: getRevenueCatErrorDetails(error),
    });
    logRevenueCatError("Customer info refresh failed", error);
    throw error;
  }
}

export async function getRevenueCatIdentity(appUserID?: string | null) {
  if (!isRevenueCatSupported()) {
    return {
      appUserID: null,
      isAnonymous: null,
      configuredAppUserId,
    };
  }

  await configureRevenueCat(appUserID);

  const Purchases = (await getPurchasesModule()).default;
  const [currentAppUserID, isAnonymous] = await Promise.all([
    Purchases.getAppUserID().catch(() => null),
    Purchases.isAnonymous().catch(() => null),
  ]);

  return {
    appUserID: currentAppUserID,
    isAnonymous,
    configuredAppUserId,
  };
}

export function getSchedovaProEntitlement(
  customerInfo: CustomerInfo | null | undefined,
) {
  return (
    getActiveRevenueCatEntitlements(customerInfo)[REVENUECAT_ENTITLEMENT_ID] ||
    null
  );
}

export function hasSchedovaPro(customerInfo: CustomerInfo | null | undefined) {
  return Boolean(getSchedovaProEntitlement(customerInfo));
}

export function getActiveRevenueCatEntitlementIds(
  customerInfo: CustomerInfo | null | undefined,
) {
  return Object.keys(getActiveRevenueCatEntitlements(customerInfo));
}

export async function checkSchedovaPro() {
  const customerInfo = await getCustomerInfo();
  return hasSchedovaPro(customerInfo);
}

function hasFreshOfferingCache() {
  return Boolean(
    cachedCurrentOffering &&
    Date.now() - cachedOfferingFetchedAt < REVENUECAT_OFFERING_CACHE_MS,
  );
}

export async function getCurrentOffering({
  forceRefresh = false,
}: {
  forceRefresh?: boolean;
} = {}): Promise<PurchasesOffering | null> {
  if (!isRevenueCatSupported()) return null;

  if (!forceRefresh && hasFreshOfferingCache()) {
    if (__DEV__) {
      console.log(
        "[RevenueCat] Using cached offering:",
        cachedCurrentOffering?.identifier,
      );
    }

    return cachedCurrentOffering;
  }

  if (!forceRefresh && offeringFetchPromise) {
    if (__DEV__) {
      console.log("[RevenueCat] Reusing in-flight offering fetch");
    }

    return offeringFetchPromise;
  }

  offeringFetchPromise = (async () => {
    await configureRevenueCat();

    const offeringStartedAt = Date.now();
    const Purchases = (await getPurchasesModule()).default;
    const offerings = await withRevenueCatOperationTimeout(
      "RevenueCat offerings load",
      Purchases.getOfferings(),
    ).catch((error) => {
      console.log("[RevenueCat] getOfferings error", {
        platform: Platform.OS,
        expectedOffering: REVENUECAT_OFFERING_ID,
        error: getRevenueCatErrorDetails(error),
      });
      logRevenueCatError("getOfferings failed", error);
      throw error;
    });
    logOfferings(offerings);
    const offeringMap = getRevenueCatOfferingMap(offerings);

    const offering =
      offerings.current ??
      offeringMap[REVENUECAT_OFFERING_ID] ??
      Object.values(offeringMap).find(
        (availableOffering) =>
          getRevenueCatAvailablePackages(availableOffering).length > 0,
      ) ??
      null;

    if (!offerings.current) {
      console.log("[RevenueCat] Current offering is null", {
        expectedOffering: REVENUECAT_OFFERING_ID,
        selectedOfferingIdentifier: offering?.identifier ?? null,
        availableOfferings: summarizeOfferings(offerings),
      });
    }

    if (!offering) {
      console.log("[RevenueCat] Offerings/packages unavailable", {
        reason: "no_current_or_default_offering",
        expectedOffering: REVENUECAT_OFFERING_ID,
        availableOfferings: summarizeOfferings(offerings),
      });
    } else if (getRevenueCatAvailablePackages(offering).length === 0) {
      console.log("[RevenueCat] Offerings/packages unavailable", {
        reason: "packages_empty",
        selectedOffering: summarizeOffering(offering),
      });
    }

    logProductIdDiagnostics(offering);

    if (offering) {
      cachedCurrentOffering = offering;
      cachedOfferingFetchedAt = Date.now();
    }

    if (__DEV__) {
      console.log(
        "[RevenueCat] Offering loaded in ms:",
        Date.now() - offeringStartedAt,
      );
    }

    return offering;
  })();

  try {
    return await offeringFetchPromise;
  } finally {
    offeringFetchPromise = null;
  }
}

export async function prefetchRevenueCatOfferings() {
  return getCurrentOffering();
}

export async function getAvailablePackages(): Promise<PurchasesPackage[]> {
  const offering = await getCurrentOffering();
  return getRevenueCatAvailablePackages(offering);
}

export async function getStoreProducts(
  productIdentifiers: string[],
  productCategory: PRODUCT_CATEGORY | null = null,
): Promise<PurchasesStoreProduct[]> {
  if (!isRevenueCatSupported()) return [];

  const nextIdentifiers = productIdentifiers
    .map((identifier) => String(identifier || "").trim())
    .filter(Boolean);

  if (nextIdentifiers.length === 0) {
    return [];
  }

  await configureRevenueCat();

  const PurchasesModule = await getPurchasesModule();
  const Purchases = PurchasesModule.default;

  const resolvedCategory =
    productCategory ?? PurchasesModule.PRODUCT_CATEGORY.NON_SUBSCRIPTION;

  const products = await withRevenueCatOperationTimeout(
    "RevenueCat store product load",
    Purchases.getProducts(nextIdentifiers, resolvedCategory),
  ).catch((error) => {
    console.log("[RevenueCat] getProducts error", {
      platform: Platform.OS,
      productIdentifiers: nextIdentifiers,
      productCategory: resolvedCategory,
      error: getRevenueCatErrorDetails(error),
    });
    logRevenueCatError("getProducts failed", error);
    throw error;
  });

  console.log("[RevenueCat] Store products loaded", {
    productIdentifiers: nextIdentifiers,
    productCategory: resolvedCategory,
    products: products.map(summarizeStoreProduct),
  });

  return products;
}

export async function logRevenueCatDebugStatus(
  customerInfo?: CustomerInfo | null,
) {
  if (!__DEV__ || !isRevenueCatSupported()) return;

  try {
    console.log(
      "[RevenueCat] Debug status:",
      await getRevenueCatDebugSnapshot(customerInfo),
    );
  } catch (error) {
    logRevenueCatError("Debug status failed", error);
  }
}

export async function getRevenueCatDebugSnapshot(
  customerInfo?: CustomerInfo | null,
  expectedAppUserID?: string | null,
): Promise<RevenueCatDebugSnapshot> {
  if (!isRevenueCatSupported()) {
    return {
      appUserID: null,
      originalAppUserID: null,
      isAnonymous: null,
      schedovaProActive: false,
      activeEntitlementIdentifiers: [],
      entitlementDetails: [],
      currentOfferingIdentifier: null,
      sdkKeyPrefix: null,
      packages: [],
      fetchedAt: new Date().toISOString(),
      lastError: lastRevenueCatErrorDetails,
    };
  }

  await configureRevenueCat(expectedAppUserID ?? null);

  const Purchases = (await getPurchasesModule()).default;
  const [currentAppUserID, isAnonymous] = await Promise.all([
    Purchases.getAppUserID().catch(() => null),
    Purchases.isAnonymous().catch(() => null),
  ]);
  const info = customerInfo ?? (await Purchases.getCustomerInfo());
  const entitlementDetails = Object.entries(
    getAllRevenueCatEntitlements(info),
  ).map(
    ([identifier, entitlement]) => ({
      identifier,
      isActive: Boolean(entitlement.isActive),
      productIdentifier: entitlement.productIdentifier ?? null,
      expirationDate: entitlement.expirationDate ?? null,
      latestPurchaseDate: entitlement.latestPurchaseDate ?? null,
      willRenew:
        typeof entitlement.willRenew === "boolean"
          ? entitlement.willRenew
          : null,
      store: entitlement.store ? String(entitlement.store) : null,
    }),
  );
  const offerings = await Purchases.getOfferings().catch((error) => {
    logRevenueCatError("Debug offerings fetch failed", error);
    return null;
  });
  const currentPackages = getRevenueCatAvailablePackages(offerings?.current);

  return {
    appUserID: currentAppUserID,
    originalAppUserID: info?.originalAppUserId ?? null,
    isAnonymous,
    schedovaProActive: hasSchedovaPro(info),
    activeEntitlementIdentifiers: getActiveRevenueCatEntitlementIds(info),
    entitlementDetails,
    currentOfferingIdentifier: offerings?.current?.identifier ?? null,
    sdkKeyPrefix: getRevenueCatApiKeyPrefix(),
    packages: currentPackages.map((pkg) => ({
      identifier: pkg.identifier,
      productId: pkg.product.identifier,
    })),
    fetchedAt: new Date().toISOString(),
    lastError: lastRevenueCatErrorDetails,
  };
}

// Test Store can hold stale purchases for a test customer. If it gets into a
// bad state, reset/delete the customer purchases in RevenueCat Customers or
// test with a new Supabase user ID.

async function getReadyOffering() {
  const offering = await getCurrentOffering();

  if (!offering) {
    console.log("[RevenueCat] Offerings/packages unavailable", {
      reason: "no_ready_offering",
      expectedOffering: REVENUECAT_OFFERING_ID,
    });
    throw createSubscriptionOptionsUnavailableError("no_ready_offering");
  }

  if (getRevenueCatAvailablePackages(offering).length === 0) {
    console.log("[RevenueCat] Offerings/packages unavailable", {
      reason: "packages_empty",
      selectedOffering: summarizeOffering(offering),
    });
    throw createSubscriptionOptionsUnavailableError("packages_empty");
  }

  return offering;
}

export async function purchasePackage(pkg: PurchasesPackage | null | undefined) {
  if (!isRevenueCatSupported()) {
    throw new Error("purchases_unsupported");
  }

  if (!pkg) {
    console.log("[RevenueCat] purchase blocked; package missing");
    throw createSubscriptionOptionsUnavailableError("missing_package");
  }

  console.log("[RevenueCat] purchase start", {
    packageIdentifier: pkg.identifier,
    packageType: String(pkg.packageType ?? ""),
    productIdentifier: pkg.product.identifier,
  });

  await configureRevenueCat();

  const Purchases = (await getPurchasesModule()).default;

  try {
    const { customerInfo, productIdentifier } =
      await Purchases.purchasePackage(pkg);

    const isPro = hasSchedovaPro(customerInfo);

    console.log("[RevenueCat] purchase success", {
      packageIdentifier: pkg.identifier,
      productIdentifier,
      entitlement: REVENUECAT_ENTITLEMENT_ID,
      active: isPro,
    });

    return {
      customerInfo,
      productIdentifier,
      isPro,
      cancelled: false,
    };
  } catch (error: any) {
    if (error?.userCancelled) {
      console.log("[RevenueCat] purchase cancelled", {
        packageIdentifier: pkg.identifier,
        productIdentifier: pkg.product.identifier,
      });

      return {
        customerInfo: null,
        productIdentifier: null,
        isPro: false,
        cancelled: true,
      };
    }

    console.log("[RevenueCat] purchase failure", {
      packageIdentifier: pkg.identifier,
      productIdentifier: pkg.product.identifier,
      error: getRevenueCatErrorDetails(error),
    });
    logRevenueCatError("Purchase failed", error);
    throw error;
  }
}

export async function purchaseStoreProduct(
  product: PurchasesStoreProduct | null | undefined,
) {
  if (!isRevenueCatSupported()) {
    throw new Error("purchases_unsupported");
  }

  if (!product) {
    console.log("[RevenueCat] purchase blocked; store product missing");
    throw createSubscriptionOptionsUnavailableError("missing_store_product");
  }

  console.log("[RevenueCat] store product purchase start", {
    productIdentifier: product.identifier,
    productCategory: product.productCategory,
    productType: product.productType,
  });

  await configureRevenueCat();

  const Purchases = (await getPurchasesModule()).default;

  try {
    const { customerInfo, productIdentifier } =
      await Purchases.purchaseStoreProduct(product);

    console.log("[RevenueCat] store product purchase success", {
      requestedProductIdentifier: product.identifier,
      productIdentifier,
      nonSubscriptionTransactionCount:
        getRevenueCatNonSubscriptionTransactions(customerInfo).length,
    });

    return {
      customerInfo,
      productIdentifier,
      cancelled: false,
    };
  } catch (error: any) {
    if (error?.userCancelled) {
      console.log("[RevenueCat] store product purchase cancelled", {
        productIdentifier: product.identifier,
      });

      return {
        customerInfo: null,
        productIdentifier: null,
        cancelled: true,
      };
    }

    console.log("[RevenueCat] store product purchase failure", {
      productIdentifier: product.identifier,
      error: getRevenueCatErrorDetails(error),
    });
    logRevenueCatError("Store product purchase failed", error);
    throw error;
  }
}

export async function restorePurchases(appUserID?: string | null) {
  if (!isRevenueCatSupported()) return null;

  if (__DEV__) {
    console.log("[RevenueCat] restore started", {
      appUserID: appUserID ?? null,
    });
  }

  await configureRevenueCat(appUserID);

  const Purchases = (await getPurchasesModule()).default;

  try {
    const restoreResult = await withRevenueCatOperationTimeout(
      "RevenueCat restore purchases",
      (async () => {
        const currentAppUserID = await Purchases.getAppUserID().catch(
          () => null,
        );

        if (appUserID && currentAppUserID !== appUserID) {
          if (__DEV__) {
            console.log("[RevenueCat] restore logIn appUserID", appUserID);
          }

          await Purchases.logIn(appUserID);
          configuredAppUserId = appUserID;
        }

        const customerInfo = await Purchases.restorePurchases();
        const [restoredAppUserID, isAnonymous] = await Promise.all([
          Purchases.getAppUserID().catch(() => null),
          Purchases.isAnonymous().catch(() => null),
        ]);

        return {
          customerInfo,
          restoredAppUserID,
          isAnonymous,
        };
      })(),
    );

    if (__DEV__) {
      console.log("[RevenueCat] restore completed", {
        appUserID: restoreResult.restoredAppUserID,
        isAnonymous: restoreResult.isAnonymous,
        activeEntitlements: getActiveRevenueCatEntitlementIds(
          restoreResult.customerInfo,
        ),
        isPro: hasSchedovaPro(restoreResult.customerInfo),
      });
    }

    return {
      customerInfo: restoreResult.customerInfo,
      isPro: hasSchedovaPro(restoreResult.customerInfo),
    };
  } catch (error) {
    console.log("[RevenueCat] restore failure", {
      appUserID: appUserID ?? null,
      error: getRevenueCatErrorDetails(error),
    });
    logRevenueCatError("Restore purchases failed", error);
    throw error;
  }
}

export async function syncRevenueCatPurchases(
  appUserID?: string | null,
): Promise<CustomerInfo | null> {
  if (!isRevenueCatSupported()) return null;

  await configureRevenueCat(appUserID);

  const Purchases = (await getPurchasesModule()).default;

  console.log("[RevenueCat] syncPurchases start", {
    appUserID: appUserID ?? null,
  });

  try {
    const customerInfo = await withRevenueCatOperationTimeout(
      "RevenueCat purchase sync",
      (async () => {
        await Purchases.syncPurchases();
        return Purchases.getCustomerInfo();
      })(),
    );

    console.log("[RevenueCat] syncPurchases complete", {
      appUserID: appUserID ?? null,
      nonSubscriptionTransactionCount:
        getRevenueCatNonSubscriptionTransactions(customerInfo).length,
      allPurchasedProductIdentifiers:
        customerInfo.allPurchasedProductIdentifiers,
    });

    return customerInfo;
  } catch (error) {
    console.log("[RevenueCat] syncPurchases failure", {
      appUserID: appUserID ?? null,
      error: getRevenueCatErrorDetails(error),
    });
    logRevenueCatError("syncPurchases failed", error);
    throw error;
  }
}

export async function presentSchedovaPaywall() {
  if (!isRevenueCatSupported()) return false;

  try {
    await configureRevenueCat();

    const RevenueCatUiModule = await getRevenueCatUiModule();
    const offering = await getReadyOffering();

    console.log("[RevenueCat] Opening Schedova Pro paywall", {
      offeringIdentifier: offering.identifier,
      productIdentifiers: getRevenueCatAvailablePackages(offering).map(
        (pkg) => pkg.product.identifier,
      ),
    });

    const result = await withRevenueCatUiTimeout(
      "RevenueCat paywall",
      RevenueCatUiModule.default.presentPaywall({
        offering,
        displayCloseButton: true,
      }),
    );

    console.log("[RevenueCat] Paywall finished", {
      offeringIdentifier: offering.identifier,
      result,
    });

    return result;
  } catch (error) {
    console.log("[RevenueCat] Paywall failed", {
      entitlement: REVENUECAT_ENTITLEMENT_ID,
      error: getRevenueCatErrorDetails(error),
    });
    logRevenueCatError("Paywall failed", error);
    throw error;
  }
}

export async function presentSchedovaPaywallIfNeeded() {
  if (!isRevenueCatSupported()) return false;

  try {
    await configureRevenueCat();

    const RevenueCatUiModule = await getRevenueCatUiModule();
    const offering = await getReadyOffering();

    console.log("[RevenueCat] Opening Schedova Pro paywall if needed", {
      entitlement: REVENUECAT_ENTITLEMENT_ID,
      offeringIdentifier: offering.identifier,
      productIdentifiers: getRevenueCatAvailablePackages(offering).map(
        (pkg) => pkg.product.identifier,
      ),
    });

    const result = await withRevenueCatUiTimeout(
      "RevenueCat paywall if needed",
      RevenueCatUiModule.default.presentPaywallIfNeeded({
        requiredEntitlementIdentifier: REVENUECAT_ENTITLEMENT_ID,
        offering,
        displayCloseButton: true,
      }),
    );

    console.log("[RevenueCat] Paywall-if-needed finished", {
      entitlement: REVENUECAT_ENTITLEMENT_ID,
      offeringIdentifier: offering.identifier,
      result,
    });

    return result;
  } catch (error) {
    console.log("[RevenueCat] Paywall-if-needed failed", {
      entitlement: REVENUECAT_ENTITLEMENT_ID,
      error: getRevenueCatErrorDetails(error),
    });
    logRevenueCatError("Paywall-if-needed failed", error);
    throw error;
  }
}

export async function presentCustomerCenter() {
  if (!isRevenueCatSupported()) return;

  try {
    await configureRevenueCat();

    const RevenueCatUiModule = await getRevenueCatUiModule();
    await withRevenueCatUiTimeout(
      "RevenueCat Customer Center",
      RevenueCatUiModule.default.presentCustomerCenter(),
    );
  } catch (error) {
    logRevenueCatError("Customer Center error", error);
    throw error;
  }
}

export async function addCustomerInfoUpdateListener(
  listener: CustomerInfoListener,
) {
  if (!isRevenueCatSupported()) return () => {};

  await configureRevenueCat();

  const Purchases = (await getPurchasesModule()).default;
  Purchases.addCustomerInfoUpdateListener(listener);

  return () => {
    Purchases.removeCustomerInfoUpdateListener(listener);
  };
}
