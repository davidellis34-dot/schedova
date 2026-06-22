import { Platform } from "react-native";
import type { CustomerInfo, PurchasesPackage } from "react-native-purchases";

import {
  configureRevenueCat,
  getAvailablePackages,
  getRevenueCatErrorDetails,
  isRevenueCatSupported,
  purchasePackage,
} from "./revenuecat/revenueCatService";
import { supabase } from "./supabase";

export const MESSAGE_CREDITS_EMPTY_COPY =
  "You've used your included messages. Buy a message pack to keep sending reminders and client updates.";

export const MESSAGE_PACK_CREDITS: Record<string, number> = {
  message_pack_100: 100,
  message_pack_250: 250,
  message_pack_500: 500,
};

export const EXPECTED_MESSAGE_PACK_IDS = Object.keys(MESSAGE_PACK_CREDITS);

export type MessagePackOption = {
  id: string;
  packageIdentifier: string;
  productIdentifier: string;
  credits: number;
  title: string;
  priceString: string;
  revenueCatPackage: PurchasesPackage;
};

export type MessagePackFetchDebug = {
  defaultOfferingLoaded: boolean;
  packageCount: number;
  packageIdentifiers: string[];
  storeProductIdentifiers: string[];
  foundMessagePacks: Record<string, boolean>;
  platform: string;
  revenueCatSupported: boolean;
  fetchError: string | null;
};

export type MessagePackFetchResult = {
  packs: MessagePackOption[];
  debug: MessagePackFetchDebug;
};

export type MessageCreditPurchaseResult = {
  cancelled: boolean;
  creditsAdded: number;
  creditsRemaining: number;
  purchaseCreated: boolean;
};

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

export function getMessagePackIdForIdentifiers(
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

export function getMessagePackCreditsForIdentifiers(
  packageIdentifier: string | null | undefined,
  productIdentifier: string | null | undefined,
) {
  const messagePackId = getMessagePackIdForIdentifiers(
    packageIdentifier,
    productIdentifier,
  );

  return messagePackId ? MESSAGE_PACK_CREDITS[messagePackId] : 0;
}

function summarizePackage(pkg: PurchasesPackage) {
  const messagePackId = getMessagePackIdForIdentifiers(
    pkg.identifier,
    pkg.product.identifier,
  );

  return {
    packageIdentifier: pkg.identifier,
    packageType: String(pkg.packageType ?? ""),
    storeProductIdentifier: pkg.product.identifier,
    storeProductTitle: pkg.product.title,
    priceString: pkg.product.priceString,
    matchedMessagePackId: messagePackId,
  };
}

function buildDebug(
  packages: PurchasesPackage[],
  fetchError: string | null,
): MessagePackFetchDebug {
  const packageIdentifiers = packages.map((pkg) => pkg.identifier);
  const storeProductIdentifiers = packages.map((pkg) => pkg.product.identifier);

  return {
    defaultOfferingLoaded: packages.length > 0,
    packageCount: packages.length,
    packageIdentifiers,
    storeProductIdentifiers,
    foundMessagePacks: Object.fromEntries(
      EXPECTED_MESSAGE_PACK_IDS.map((packId) => [
        packId,
        packages.some((pkg) =>
          Boolean(
            getMessagePackIdForIdentifiers(
              pkg.identifier,
              pkg.product.identifier,
            ) === packId,
          ),
        ),
      ]),
    ),
    platform: Platform.OS,
    revenueCatSupported: isRevenueCatSupported(),
    fetchError,
  };
}

function toMessagePackOption(pkg: PurchasesPackage) {
  const credits = getMessagePackCreditsForIdentifiers(
    pkg.identifier,
    pkg.product.identifier,
  );
  const messagePackId = getMessagePackIdForIdentifiers(
    pkg.identifier,
    pkg.product.identifier,
  );

  if (!messagePackId || credits <= 0) return null;

  return {
    id: messagePackId,
    packageIdentifier: pkg.identifier,
    productIdentifier: pkg.product.identifier,
    credits,
    title: `${credits} messages`,
    priceString: pkg.product.priceString || "Price unavailable",
    revenueCatPackage: pkg,
  } satisfies MessagePackOption;
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

export async function fetchMessageCreditBalance() {
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

export async function fetchMessagePackOptions(): Promise<MessagePackFetchResult> {
  if (!isRevenueCatSupported()) {
    const debug = buildDebug([], "RevenueCat purchases are unavailable here.");

    if (__DEV__) {
      console.log("[MessageCredits] RevenueCat unsupported", debug);
    }

    return { packs: [], debug };
  }

  const userId = await getSignedInUserId();

  try {
    await configureRevenueCat(userId);

    const packages = await getAvailablePackages({ forceRefresh: true });
    const packs = packages
      .map(toMessagePackOption)
      .filter((pack): pack is MessagePackOption => Boolean(pack))
      .sort((a, b) => a.credits - b.credits);
    const debug = buildDebug(packages, null);

    console.log("[MessageCredits] RevenueCat packages returned", {
      packages: packages.map(summarizePackage),
      expectedMessagePackIds: EXPECTED_MESSAGE_PACK_IDS,
      matchedMessagePacks: packs.map((pack) => ({
        id: pack.id,
        packageIdentifier: pack.packageIdentifier,
        productIdentifier: pack.productIdentifier,
        credits: pack.credits,
        priceString: pack.priceString,
      })),
      debug,
    });

    return { packs, debug };
  } catch (error) {
    const details = getRevenueCatErrorDetails(error);
    const debug = buildDebug([], details.message);

    console.log("[MessageCredits] RevenueCat message pack fetch failed", {
      error: details,
      debug,
    });

    return { packs: [], debug };
  }
}

function getLatestMatchingTransaction(
  customerInfo: CustomerInfo,
  productIdentifier: string,
) {
  const transactions = Array.isArray(
    (customerInfo as any).nonSubscriptionTransactions,
  )
    ? (customerInfo as any).nonSubscriptionTransactions
    : [];

  return (
    transactions
      .filter((transaction: any) => {
        return (
          normalizeIdentifier(transaction?.productIdentifier) ===
          normalizeIdentifier(productIdentifier)
        );
      })
      .sort((a: any, b: any) => {
        const aTime = new Date(String(a?.purchaseDate || "")).getTime();
        const bTime = new Date(String(b?.purchaseDate || "")).getTime();

        return (Number.isFinite(bTime) ? bTime : 0) -
          (Number.isFinite(aTime) ? aTime : 0);
      })[0] || null
  );
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

export async function purchaseMessagePack(
  pack: MessagePackOption,
): Promise<MessageCreditPurchaseResult> {
  const purchase = await purchasePackage(pack.revenueCatPackage);

  if (purchase.cancelled || !purchase.customerInfo) {
    return {
      cancelled: true,
      creditsAdded: 0,
      creditsRemaining: 0,
      purchaseCreated: false,
    };
  }

  const customerInfo = purchase.customerInfo;
  const productIdentifier = purchase.productIdentifier || pack.productIdentifier;
  const { transaction, transactionId } = buildTransactionId({
    customerInfo,
    productIdentifier,
  });

  console.log("[MessageCredits] Crediting purchased message pack", {
    messagePackId: pack.id,
    packageIdentifier: pack.packageIdentifier,
    productIdentifier,
    credits: pack.credits,
    transactionId,
    platform: Platform.OS,
  });

  const { data, error } = await supabase.functions.invoke(
    "credit-message-pack",
    {
      body: {
        platform: Platform.OS,
        product_identifier: productIdentifier,
        package_identifier: pack.packageIdentifier,
        transaction_id: transactionId,
        purchase_date: transaction?.purchaseDate || null,
        customer_info: {
          allPurchasedProductIdentifiers:
            customerInfo.allPurchasedProductIdentifiers,
          nonSubscriptionTransactions:
            (customerInfo as any).nonSubscriptionTransactions || [],
          originalAppUserId: customerInfo.originalAppUserId,
          requestDate: customerInfo.requestDate,
        },
      },
    },
  );

  if (error) {
    console.log("[MessageCredits] credit-message-pack failed", {
      messagePackId: pack.id,
      packageIdentifier: pack.packageIdentifier,
      productIdentifier,
      transactionId,
      error,
    });

    throw new Error(error.message || "Unable to add message credits.");
  }

  return {
    cancelled: false,
    creditsAdded: Number(data?.creditsAdded || pack.credits),
    creditsRemaining: Number(data?.creditsRemaining || 0),
    purchaseCreated: Boolean(data?.purchaseCreated),
  };
}
