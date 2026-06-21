import Constants from "expo-constants";
import { Platform } from "react-native";
import type { CustomerInfo, PurchasesPackage } from "react-native-purchases";

import { supabase } from "./supabase";

export const MESSAGE_CREDITS_EMPTY_COPY =
  "You've used your included messages. Buy a message pack to keep sending reminders and client updates.";

export const MESSAGE_PACK_CREDITS: Record<string, number> = {
  message_pack_100: 100,
  message_pack_250: 250,
  message_pack_500: 500,
};

const EXPECTED_MESSAGE_PACK_IDS = Object.keys(MESSAGE_PACK_CREDITS);
type MessagePackId = keyof typeof MESSAGE_PACK_CREDITS;
const REVENUECAT_ANDROID_API_KEY =
  process.env.EXPO_PUBLIC_REVENUECAT_ANDROID_API_KEY ||
  "goog_XvtXUmgyBINZuvwhTvTzefmPClJ";
const REVENUECAT_DEFAULT_OFFERING_ID = "default";

type PurchasesModule = typeof import("react-native-purchases");

export type AndroidMessagePack = {
  id: string;
  packageIdentifier: string;
  productIdentifier: string;
  credits: number;
  title: string;
  priceString: string;
  revenueCatPackage: PurchasesPackage;
};

export type MessageCreditPurchaseResult = {
  creditsAdded: number;
  creditsRemaining: number;
  purchaseCreated: boolean;
};

export type AndroidMessagePackDebug = {
  defaultOfferingLoaded: boolean;
  packageIdentifiers: string[];
  storeProductIdentifiers: string[];
  foundMessagePacks: Record<MessagePackId, boolean>;
  fetchError: string | null;
  platform: string;
  appOwnership: string;
  supported: boolean;
  supportReason: string | null;
  currentOfferingIdentifier: string | null;
  offeringIdentifiers: string[];
};

let purchasesModulePromise: Promise<PurchasesModule> | null = null;
let revenueCatConfigured = false;
let configuredAppUserId: string | null = null;

function isExpoGo() {
  return Constants.appOwnership === "expo";
}

export function getAndroidMessagePackSupportStatus() {
  if (Platform.OS !== "android") {
    return {
      supported: false,
      reason: "Message packs are available on Android only.",
      platform: Platform.OS,
      appOwnership: Constants.appOwnership || "unknown",
    };
  }

  if (isExpoGo()) {
    return {
      supported: false,
      reason:
        "Google Play Billing products cannot load in Expo Go. Use an Android development build or Google Play internal testing build.",
      platform: Platform.OS,
      appOwnership: Constants.appOwnership || "unknown",
    };
  }

  return {
    supported: true,
    reason: null,
    platform: Platform.OS,
    appOwnership: Constants.appOwnership || "unknown",
  };
}

export function isAndroidMessagePacksSupported() {
  return getAndroidMessagePackSupportStatus().supported;
}

export function shouldShowAndroidMessagePackArea() {
  return Platform.OS === "android";
}

export function createAndroidMessagePackDebug(
  overrides: Partial<AndroidMessagePackDebug> = {},
): AndroidMessagePackDebug {
  const support = getAndroidMessagePackSupportStatus();

  return {
    defaultOfferingLoaded: false,
    packageIdentifiers: [],
    storeProductIdentifiers: [],
    foundMessagePacks: {
      message_pack_100: false,
      message_pack_250: false,
      message_pack_500: false,
    },
    fetchError: null,
    platform: String(support.platform || Platform.OS),
    appOwnership: String(support.appOwnership || "unknown"),
    supported: support.supported,
    supportReason: support.reason,
    currentOfferingIdentifier: null,
    offeringIdentifiers: [],
    ...overrides,
  };
}

function normalizeIdentifier(value: unknown) {
  return String(value || "")
    .trim()
    .toLowerCase();
}

function identifierMatchesMessagePack(identifier: unknown, messagePackId: string) {
  const normalized = normalizeIdentifier(identifier);
  const expected = normalizeIdentifier(messagePackId);

  if (!normalized || !expected) return false;

  return (
    normalized === expected ||
    normalized.endsWith(`.${expected}`) ||
    normalized.endsWith(`:${expected}`)
  );
}

function getMessagePackIdForIdentifiers(
  packageIdentifier: string | null | undefined,
  productIdentifier: string | null | undefined,
) {
  for (const messagePackId of EXPECTED_MESSAGE_PACK_IDS) {
    if (
      identifierMatchesMessagePack(packageIdentifier, messagePackId) ||
      identifierMatchesMessagePack(productIdentifier, messagePackId)
    ) {
      return messagePackId;
    }
  }

  return null;
}

function getMessagePackCreditsForIdentifiers(
  packageIdentifier: string | null | undefined,
  productIdentifier: string | null | undefined,
) {
  const messagePackId = getMessagePackIdForIdentifiers(
    packageIdentifier,
    productIdentifier,
  );

  if (messagePackId) return MESSAGE_PACK_CREDITS[messagePackId];

  return 0;
}

function getPackageDebugInfo(pkg: PurchasesPackage) {
  return {
    packageIdentifier: pkg.identifier,
    packageType: String(pkg.packageType),
    offeringIdentifier: pkg.offeringIdentifier,
    storeProductIdentifier: pkg.product.identifier,
    storeProductTitle: pkg.product.title,
    storeProductDescription: pkg.product.description,
    price: pkg.product.price,
    priceString: pkg.product.priceString,
    currencyCode: pkg.product.currencyCode,
    productType: String(pkg.product.productType),
    productCategory: String(pkg.product.productCategory),
    subscriptionPeriod: pkg.product.subscriptionPeriod,
    matchedMessagePackId: getMessagePackIdForIdentifiers(
      pkg.identifier,
      pkg.product.identifier,
    ),
  };
}

function logRevenueCatPackages(label: string, packages: PurchasesPackage[]) {
  if (!__DEV__) return;

  console.log(
    label,
    packages.map((pkg) => getPackageDebugInfo(pkg)),
  );
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message;

  if (error && typeof error === "object" && "message" in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string" && message.trim()) return message;
  }

  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

async function getPurchasesModule() {
  const support = getAndroidMessagePackSupportStatus();

  if (!support.supported) {
    if (__DEV__) {
      console.log("Android message packs unsupported", support);
    }

    throw new Error(support.reason || "Android message packs are unavailable.");
  }

  if (!purchasesModulePromise) {
    purchasesModulePromise = import("react-native-purchases");
  }

  return purchasesModulePromise;
}

async function configureAndroidRevenueCat(appUserId: string) {
  const PurchasesModule = await getPurchasesModule();
  const Purchases = PurchasesModule.default;

  if (revenueCatConfigured) {
    if (appUserId !== configuredAppUserId) {
      await Purchases.logIn(appUserId);
      configuredAppUserId = appUserId;
    }

    return Purchases;
  }

  await Purchases.setLogLevel(
    __DEV__ ? PurchasesModule.LOG_LEVEL.DEBUG : PurchasesModule.LOG_LEVEL.WARN,
  );

  Purchases.configure({
    apiKey: REVENUECAT_ANDROID_API_KEY,
    appUserID: appUserId,
  });

  revenueCatConfigured = true;
  configuredAppUserId = appUserId;

  return Purchases;
}

async function getSignedInUserId() {
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user?.id) {
    throw new Error("Please sign in again.");
  }

  return user.id;
}

export async function fetchMessageCredits() {
  const userId = await getSignedInUserId();
  const { data, error } = await supabase
    .from("user_message_credits")
    .select("credits_remaining")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return Number(data?.credits_remaining || 0);
}

export async function fetchAndroidMessagePackOfferings() {
  const support = getAndroidMessagePackSupportStatus();
  let debug = createAndroidMessagePackDebug();

  if (!support.supported) {
    if (__DEV__) {
      console.log("Skipping RevenueCat message pack fetch", support);
    }

    return {
      packs: [] satisfies AndroidMessagePack[],
      debug,
    };
  }

  try {
    const userId = await getSignedInUserId();
    const Purchases = await configureAndroidRevenueCat(userId);
    const offerings = await Purchases.getOfferings();
    const defaultOffering = offerings.all[REVENUECAT_DEFAULT_OFFERING_ID];

    debug = {
      ...debug,
      currentOfferingIdentifier: offerings.current?.identifier || null,
      offeringIdentifiers: Object.keys(offerings.all || {}),
    };

    if (!defaultOffering) {
      const fetchError = "RevenueCat default offering missing.";

      if (__DEV__) {
        console.log("RevenueCat default offering missing", {
          currentOfferingIdentifier: offerings.current?.identifier || null,
          allOfferingIdentifiers: Object.keys(offerings.all || {}),
        });
      }

      return {
        packs: [] satisfies AndroidMessagePack[],
        debug: {
          ...debug,
          fetchError,
        },
      };
    }

    const availablePackages = defaultOffering.availablePackages || [];
    const packageIdentifiers = availablePackages.map((pkg) => pkg.identifier);
    const storeProductIdentifiers = availablePackages.map(
      (pkg) => pkg.product.identifier,
    );

    debug = {
      ...debug,
      defaultOfferingLoaded: true,
      packageIdentifiers,
      storeProductIdentifiers,
    };

    logRevenueCatPackages(
      "RevenueCat default offering packages",
      availablePackages,
    );

    if (availablePackages.length === 0 && __DEV__) {
      console.log("RevenueCat default offering returned no packages", {
        offeringIdentifier: defaultOffering.identifier,
        expectedMessagePackIds: EXPECTED_MESSAGE_PACK_IDS,
      });
    }

    const packs = availablePackages
      .map((pkg) => {
        const matchedMessagePackId = getMessagePackIdForIdentifiers(
          pkg.identifier,
          pkg.product.identifier,
        );
        const credits = getMessagePackCreditsForIdentifiers(
          pkg.identifier,
          pkg.product.identifier,
        );

        if (!matchedMessagePackId && __DEV__) {
          console.log("RevenueCat package is not a message pack", {
            packageIdentifier: pkg.identifier,
            storeProductIdentifier: pkg.product.identifier,
            packageType: String(pkg.packageType),
            productType: String(pkg.product.productType),
          });
        }

        if (credits <= 0) return null;

        return {
          id: matchedMessagePackId || pkg.identifier,
          packageIdentifier: pkg.identifier,
          productIdentifier: pkg.product.identifier,
          credits,
          title: `${credits} message credits`,
          priceString: pkg.product.priceString || "Price unavailable",
          revenueCatPackage: pkg,
        } satisfies AndroidMessagePack;
      })
      .filter((pkg): pkg is AndroidMessagePack => Boolean(pkg))
      .sort((a, b) => a.credits - b.credits);

    const returnedPackIds = new Set(packs.map((pack) => pack.id));
    const missingPackIds = EXPECTED_MESSAGE_PACK_IDS.filter(
      (packId) => !returnedPackIds.has(packId),
    );
    const foundMessagePacks = {
      message_pack_100: returnedPackIds.has("message_pack_100"),
      message_pack_250: returnedPackIds.has("message_pack_250"),
      message_pack_500: returnedPackIds.has("message_pack_500"),
    };

    debug = {
      ...debug,
      foundMessagePacks,
    };

    if (__DEV__) {
      console.log("RevenueCat Android message packs matched", {
        expectedMessagePackIds: EXPECTED_MESSAGE_PACK_IDS,
        returnedPackIds: packs.map((pack) => pack.id),
        missingPackIds,
        packageIdentifiers: packs.map((pack) => pack.packageIdentifier),
        storeProductIdentifiers: packs.map((pack) => pack.productIdentifier),
      });

      if (missingPackIds.length > 0) {
        console.log("RevenueCat missing expected message packs", {
          missingPackIds,
          hint:
            "Confirm the products are active in Google Play, attached to the RevenueCat default offering, and available to this Android build/test account.",
        });
      }
    }

    return { packs, debug };
  } catch (error) {
    const fetchError = getErrorMessage(error);

    console.log("RevenueCat message pack fetch error", {
      fetchError,
      support,
      error,
    });

    return {
      packs: [] satisfies AndroidMessagePack[],
      debug: {
        ...debug,
        fetchError,
      },
    };
  }
}

export async function fetchAndroidMessagePacks() {
  const { packs } = await fetchAndroidMessagePackOfferings();
  return packs;
}

function getLatestMatchingTransaction(
  customerInfo: CustomerInfo,
  productIdentifier: string,
) {
  return (customerInfo.nonSubscriptionTransactions || [])
    .filter((transaction) => transaction.productIdentifier === productIdentifier)
    .sort((a, b) => {
      const aTime = new Date(a.purchaseDate || "").getTime();
      const bTime = new Date(b.purchaseDate || "").getTime();

      return (Number.isFinite(bTime) ? bTime : 0) -
        (Number.isFinite(aTime) ? aTime : 0);
    })[0] || null;
}

function buildTransactionId({
  customerInfo,
  productIdentifier,
}: {
  customerInfo: CustomerInfo;
  productIdentifier: string;
}) {
  const transaction = getLatestMatchingTransaction(
    customerInfo,
    productIdentifier,
  );
  const transactionId =
    transaction?.transactionIdentifier ||
    transaction?.purchaseToken ||
    `${productIdentifier}:${transaction?.purchaseDate || customerInfo.requestDate}`;

  return {
    transaction,
    transactionId,
  };
}

export async function purchaseAndroidMessagePack(
  pack: AndroidMessagePack,
): Promise<MessageCreditPurchaseResult> {
  const support = getAndroidMessagePackSupportStatus();

  if (!support.supported) {
    throw new Error(support.reason || "Message packs are unavailable.");
  }

  const userId = await getSignedInUserId();
  const Purchases = await configureAndroidRevenueCat(userId);
  let purchase;

  try {
    if (__DEV__) {
      console.log("Starting RevenueCat message pack purchase", {
        messagePackId: pack.id,
        packageIdentifier: pack.packageIdentifier,
        storeProductIdentifier: pack.productIdentifier,
        credits: pack.credits,
        priceString: pack.priceString,
      });
    }

    purchase = await Purchases.purchasePackage(pack.revenueCatPackage);
  } catch (error) {
    console.log("RevenueCat message pack purchase error", {
      messagePackId: pack.id,
      packageIdentifier: pack.packageIdentifier,
      storeProductIdentifier: pack.productIdentifier,
      error,
    });

    throw error;
  }

  const customerInfo = purchase.customerInfo;
  const productIdentifier = purchase.productIdentifier || pack.productIdentifier;
  const { transaction, transactionId } = buildTransactionId({
    customerInfo,
    productIdentifier,
  });

  const { data, error } = await supabase.functions.invoke(
    "credit-message-pack",
    {
      body: {
        platform: "android",
        product_identifier: productIdentifier,
        package_identifier: pack.packageIdentifier,
        transaction_id: transactionId,
        purchase_date: transaction?.purchaseDate || null,
        customer_info: {
          allPurchasedProductIdentifiers:
            customerInfo.allPurchasedProductIdentifiers,
          nonSubscriptionTransactions:
            customerInfo.nonSubscriptionTransactions,
          originalAppUserId: customerInfo.originalAppUserId,
          requestDate: customerInfo.requestDate,
        },
      },
    },
  );

  if (error) {
    console.log("Message pack credit function error", {
      messagePackId: pack.id,
      packageIdentifier: pack.packageIdentifier,
      productIdentifier,
      transactionId,
      error,
    });

    throw new Error(error.message || "Unable to add message credits.");
  }

  return {
    creditsAdded: Number(data?.creditsAdded || pack.credits),
    creditsRemaining: Number(data?.creditsRemaining || 0),
    purchaseCreated: Boolean(data?.purchaseCreated),
  };
}
