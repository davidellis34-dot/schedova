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

let purchasesModulePromise: Promise<PurchasesModule> | null = null;
let revenueCatConfigured = false;
let configuredAppUserId: string | null = null;

function isExpoGo() {
  return Constants.appOwnership === "expo";
}

export function isAndroidMessagePacksSupported() {
  return Platform.OS === "android" && !isExpoGo();
}

function getMessagePackCreditsForIdentifiers(
  packageIdentifier: string | null | undefined,
  productIdentifier: string | null | undefined,
) {
  const identifiers = [packageIdentifier, productIdentifier]
    .map((value) =>
      String(value || "")
        .trim()
        .toLowerCase(),
    )
    .filter(Boolean);

  for (const identifier of identifiers) {
    if (MESSAGE_PACK_CREDITS[identifier]) {
      return MESSAGE_PACK_CREDITS[identifier];
    }
  }

  return 0;
}

async function getPurchasesModule() {
  if (!isAndroidMessagePacksSupported()) {
    throw new Error("Android message packs require an Android build.");
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

export async function fetchAndroidMessagePacks() {
  if (!isAndroidMessagePacksSupported()) {
    return [] satisfies AndroidMessagePack[];
  }

  const userId = await getSignedInUserId();
  const Purchases = await configureAndroidRevenueCat(userId);
  const offerings = await Purchases.getOfferings();
  const defaultOffering = offerings.all[REVENUECAT_DEFAULT_OFFERING_ID];

  if (!defaultOffering) {
    throw new Error("Message packs are not available yet.");
  }

  return defaultOffering.availablePackages
    .map((pkg) => {
      const credits = getMessagePackCreditsForIdentifiers(
        pkg.identifier,
        pkg.product.identifier,
      );

      if (credits <= 0) return null;

      return {
        id: pkg.identifier,
        packageIdentifier: pkg.identifier,
        productIdentifier: pkg.product.identifier,
        credits,
        title: `${credits} message credits`,
        priceString: pkg.product.priceString,
        revenueCatPackage: pkg,
      } satisfies AndroidMessagePack;
    })
    .filter((pkg): pkg is AndroidMessagePack => Boolean(pkg))
    .sort((a, b) => a.credits - b.credits);
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
  if (!isAndroidMessagePacksSupported()) {
    throw new Error("Message packs are available on Android only.");
  }

  const userId = await getSignedInUserId();
  const Purchases = await configureAndroidRevenueCat(userId);
  const purchase = await Purchases.purchasePackage(pack.revenueCatPackage);
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
    throw new Error(error.message || "Unable to add message credits.");
  }

  return {
    creditsAdded: Number(data?.creditsAdded || pack.credits),
    creditsRemaining: Number(data?.creditsRemaining || 0),
    purchaseCreated: Boolean(data?.purchaseCreated),
  };
}
