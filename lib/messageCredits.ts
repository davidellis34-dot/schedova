import type { CustomerInfo, PurchasesStoreProduct } from "react-native-purchases";

import {
  getMessagePackCredits,
  getMessagePackLabel,
  isMessagePackProductId,
  MESSAGE_PACK_PRODUCT_IDS,
} from "./messageCreditProducts";
import {
  getRevenueCatSupportState,
  getRevenueCatErrorDetails,
  getStoreProducts,
  isRevenueCatSupported,
  purchaseStoreProduct,
  syncRevenueCatPurchases,
} from "./revenuecat/revenueCatService";
import { emitSmsBalanceUpdated } from "./smsBalanceEvents";
import { supabase } from "./supabase";

type FunctionErrorShape = {
  context?: Response;
};

export type MessageCreditBalance = {
  balance: number;
  totalPurchased: number;
  totalUsed: number;
  updatedAt: string | null;
  lastPurchaseAt: string | null;
  lastUsedAt: string | null;
};

export type MessagePackProductSummary = {
  productId: string;
  credits: number;
  label: string;
  title: string;
  description: string;
  priceString: string;
  product: PurchasesStoreProduct;
};

export type MessagePackPurchaseSyncResult = {
  balance: MessageCreditBalance;
  appliedCount: number;
  duplicateCount: number;
  blockedCount: number;
  addedCredits: number;
  results: Array<Record<string, unknown>>;
};

const EMPTY_BALANCE: MessageCreditBalance = {
  balance: 0,
  totalPurchased: 0,
  totalUsed: 0,
  updatedAt: null,
  lastPurchaseAt: null,
  lastUsedAt: null,
};
const MESSAGE_CREDITS_TIMEOUT_MS = 20_000;

function createRevenueCatUnsupportedMessage() {
  const supportState = getRevenueCatSupportState();

  if (supportState.reason === "expo_go") {
    return "Message pack purchases are not available in Expo Go. Open the installed app or development build instead.";
  }

  if (supportState.reason === "unsupported_platform") {
    return "Message pack purchases are not available on this device.";
  }

  return "Message pack purchases are not available in this runtime.";
}

function normalizeBalanceRow(
  row:
    | {
        balance?: number | null;
        total_purchased?: number | null;
        total_used?: number | null;
        updated_at?: string | null;
        last_purchase_at?: string | null;
        last_used_at?: string | null;
      }
    | null
    | undefined,
): MessageCreditBalance {
  return {
    balance: Number(row?.balance) || 0,
    totalPurchased: Number(row?.total_purchased) || 0,
    totalUsed: Number(row?.total_used) || 0,
    updatedAt: row?.updated_at ?? null,
    lastPurchaseAt: row?.last_purchase_at ?? null,
    lastUsedAt: row?.last_used_at ?? null,
  };
}

function normalizeProductSummary(
  product: PurchasesStoreProduct,
): MessagePackProductSummary {
  const productId = String(product.identifier || "");
  const credits = getMessagePackCredits(productId);

  return {
    productId,
    credits,
    label: getMessagePackLabel(productId),
    title: product.title || getMessagePackLabel(productId),
    description: product.description || getMessagePackLabel(productId),
    priceString: product.priceString || "",
    product,
  };
}

function createMessageCreditsTimeoutError(operation: string) {
  return new Error(
    `${operation} did not finish within ${MESSAGE_CREDITS_TIMEOUT_MS / 1000} seconds.`,
  );
}

async function withMessageCreditsTimeout<T>(
  operation: string,
  promise: PromiseLike<T>,
) {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;

  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => {
          reject(createMessageCreditsTimeoutError(operation));
        }, MESSAGE_CREDITS_TIMEOUT_MS);
      }),
    ]);
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
}

async function readFunctionErrorDetails(error: unknown) {
  const context =
    error && typeof error === "object" && "context" in error
      ? ((error as FunctionErrorShape).context ?? null)
      : null;

  if (!context) return null;

  try {
    return await context.clone().json();
  } catch {
    try {
      return await context.clone().text();
    } catch {
      return null;
    }
  }
}

async function readCurrentUserId() {
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error) {
    throw error;
  }

  return user?.id ?? null;
}

function getMessagePackTransactions(customerInfo: CustomerInfo | null | undefined) {
  const transactions = customerInfo?.nonSubscriptionTransactions ?? [];

  return transactions
    .filter((transaction) => isMessagePackProductId(transaction.productIdentifier))
    .map((transaction) => ({
      productIdentifier: transaction.productIdentifier,
      transactionIdentifier: transaction.transactionIdentifier,
      purchaseToken: transaction.purchaseToken ?? null,
      purchaseDate: transaction.purchaseDate ?? null,
    }));
}

function normalizeSyncResponse(
  data:
    | {
        balance?: number | null;
        totalPurchased?: number | null;
        totalUsed?: number | null;
        updatedAt?: string | null;
        lastPurchaseAt?: string | null;
        lastUsedAt?: string | null;
        appliedCount?: number | null;
        duplicateCount?: number | null;
        blockedCount?: number | null;
        addedCredits?: number | null;
        results?: Array<Record<string, unknown>> | null;
      }
    | null
    | undefined,
): MessagePackPurchaseSyncResult {
  return {
    balance: {
      balance: Number(data?.balance) || 0,
      totalPurchased: Number(data?.totalPurchased) || 0,
      totalUsed: Number(data?.totalUsed) || 0,
      updatedAt: data?.updatedAt ?? null,
      lastPurchaseAt: data?.lastPurchaseAt ?? null,
      lastUsedAt: data?.lastUsedAt ?? null,
    },
    appliedCount: Number(data?.appliedCount) || 0,
    duplicateCount: Number(data?.duplicateCount) || 0,
    blockedCount: Number(data?.blockedCount) || 0,
    addedCredits: Number(data?.addedCredits) || 0,
    results: Array.isArray(data?.results) ? data.results : [],
  };
}

export function formatMessageCreditCount(count: number) {
  const safeCount = Math.max(0, Number(count) || 0);
  return `${safeCount} SMS credit${safeCount === 1 ? "" : "s"}`;
}

export async function loadMessageCreditBalance(
  userId?: string | null,
): Promise<MessageCreditBalance> {
  const activeUserId = userId ?? (await readCurrentUserId());

  if (!activeUserId) {
    return EMPTY_BALANCE;
  }

  const result = await withMessageCreditsTimeout(
    "Message credit balance load",
    supabase
      .from("message_credit_balances")
      .select(
        "balance, total_purchased, total_used, updated_at, last_purchase_at, last_used_at",
      )
      .eq("user_id", activeUserId)
      .maybeSingle()
      .then((response) => response),
  );

  if (result.error) {
    console.log("[Message credits] balance load failed", {
      userId: activeUserId,
      code: result.error.code ?? null,
      message: result.error.message,
      details: result.error.details ?? null,
      hint: result.error.hint ?? null,
    });
    throw result.error;
  }

  return normalizeBalanceRow(result.data);
}

export async function loadMessagePackProducts() {
  if (!isRevenueCatSupported()) {
    return [] as MessagePackProductSummary[];
  }

  const products = await getStoreProducts(MESSAGE_PACK_PRODUCT_IDS);

  return products
    .map(normalizeProductSummary)
    .filter((product) => product.credits > 0)
    .sort((left, right) => left.credits - right.credits);
}

export async function syncMessagePackPurchasesFromCustomerInfo(
  customerInfo: CustomerInfo | null | undefined,
  userId?: string | null,
): Promise<MessagePackPurchaseSyncResult> {
  const activeUserId = userId ?? (await readCurrentUserId());

  if (!activeUserId) {
    throw new Error("Not signed in");
  }

  const transactions = getMessagePackTransactions(customerInfo);

  const { data, error } = await withMessageCreditsTimeout(
    "Message pack purchase sync",
    supabase.functions.invoke("sync-message-pack-purchases", {
      body: {
        appUserId: activeUserId,
        originalAppUserId: customerInfo?.originalAppUserId ?? null,
        transactions,
      },
    }),
  );

  if (error) {
    const details = await readFunctionErrorDetails(error);
    console.log("[Message credits] purchase sync failed", {
      userId: activeUserId,
      error: getRevenueCatErrorDetails(error),
      details,
    });
    throw new Error(
      typeof details === "object" &&
        details &&
        "error" in details &&
        typeof (details as { error?: unknown }).error === "string"
        ? (details as { error: string }).error
        : "Message pack purchases could not be synced.",
    );
  }

  const normalizedResponse = normalizeSyncResponse(
    typeof data === "object" && data ? (data as Record<string, unknown>) : null,
  );

  emitSmsBalanceUpdated();

  return normalizedResponse;
}

export async function checkMessagePackPurchases(userId?: string | null) {
  if (!isRevenueCatSupported()) {
    throw new Error(createRevenueCatUnsupportedMessage());
  }

  return withMessageCreditsTimeout(
    "Message pack purchase check",
    (async () => {
      const customerInfo = await syncRevenueCatPurchases(userId ?? null);
      return syncMessagePackPurchasesFromCustomerInfo(
        customerInfo,
        userId ?? null,
      );
    })(),
  );
}

export async function purchaseMessagePack(
  product: PurchasesStoreProduct,
  userId?: string | null,
) {
  if (!isRevenueCatSupported()) {
    throw new Error(createRevenueCatUnsupportedMessage());
  }

  const activeUserId = userId ?? (await readCurrentUserId());

  if (!activeUserId) {
    throw new Error("Not signed in");
  }

  const purchaseResult = await purchaseStoreProduct(product);

  if (purchaseResult.cancelled) {
    return {
      cancelled: true,
      syncResult: null,
    };
  }

  const syncResult = await syncMessagePackPurchasesFromCustomerInfo(
    purchaseResult.customerInfo,
    activeUserId,
  );

  return {
    cancelled: false,
    productIdentifier: purchaseResult.productIdentifier,
    syncResult,
  };
}

export async function loadAndroidMessagePackProducts() {
  return loadMessagePackProducts();
}

export async function purchaseAndroidMessagePack(
  product: PurchasesStoreProduct,
  userId?: string | null,
) {
  return purchaseMessagePack(product, userId);
}
