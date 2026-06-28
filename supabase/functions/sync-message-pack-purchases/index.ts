import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

import { isMessagePackProductId } from "../../../lib/messageCreditProducts.ts";
import { claimMessagePackPurchase } from "../_shared/messageCredits.ts";

type JsonObject = Record<string, unknown>;

type PurchaseTransactionInput = {
  productIdentifier?: unknown;
  transactionIdentifier?: unknown;
  purchaseToken?: unknown;
  purchaseDate?: unknown;
};

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
    },
  });
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message || error.name || "Unknown error";

  if (error && typeof error === "object" && "message" in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string" && message.trim()) return message;
  }

  return String(error || "Unknown error");
}

function asTrimmedString(value: unknown) {
  return String(value || "").trim();
}

function isIsoDateTime(value: string) {
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return jsonResponse({ ok: false, error: "Method not allowed" }, 405);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!supabaseUrl || !supabaseAnonKey || !serviceRoleKey) {
    return jsonResponse(
      {
        ok: false,
        error: "Supabase environment is missing for message pack sync.",
      },
      500,
    );
  }

  const authHeader = req.headers.get("Authorization") || "";
  const userClient = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const serviceClient = createClient(supabaseUrl, serviceRoleKey);

  const {
    data: { user },
    error: authError,
  } = await userClient.auth.getUser();

  if (authError || !user) {
    return jsonResponse(
      {
        ok: false,
        error: "Unauthorized",
        details: authError ? getErrorMessage(authError) : null,
      },
      401,
    );
  }

  let requestBody: JsonObject = {};

  try {
    const parsed = await req.json();
    requestBody =
      parsed && typeof parsed === "object" ? (parsed as JsonObject) : {};
  } catch (error) {
    return jsonResponse(
      {
        ok: false,
        error: "Invalid request body",
        details: getErrorMessage(error),
      },
      400,
    );
  }

  const appUserId = asTrimmedString(requestBody.appUserId);
  const originalAppUserId = asTrimmedString(requestBody.originalAppUserId);

  if (appUserId && appUserId !== user.id) {
    console.error("[Message credits] app user mismatch", {
      authUserId: user.id,
      revenueCatAppUserId: appUserId,
    });
    return jsonResponse(
      {
        ok: false,
        error: "RevenueCat user does not match the signed-in user.",
      },
      400,
    );
  }

  const rawTransactions = Array.isArray(requestBody.transactions)
    ? (requestBody.transactions as PurchaseTransactionInput[])
    : [];

  const transactions = rawTransactions
    .map((transaction) => {
      const productIdentifier = asTrimmedString(transaction.productIdentifier);
      const transactionIdentifier = asTrimmedString(
        transaction.transactionIdentifier,
      );
      const purchaseToken = asTrimmedString(transaction.purchaseToken) || null;
      const purchaseDate = asTrimmedString(transaction.purchaseDate) || null;

      if (!isMessagePackProductId(productIdentifier)) return null;
      if (!transactionIdentifier) return null;

      return {
        productIdentifier,
        transactionIdentifier,
        purchaseToken,
        purchaseDate:
          purchaseDate && isIsoDateTime(purchaseDate) ? purchaseDate : null,
      };
    })
    .filter(Boolean) as Array<{
    productIdentifier: string;
    transactionIdentifier: string;
    purchaseToken: string | null;
    purchaseDate: string | null;
  }>;

  let appliedCount = 0;
  let duplicateCount = 0;
  let blockedCount = 0;
  let addedCredits = 0;
  const results: Array<Record<string, unknown>> = [];

  for (const transaction of transactions) {
    const claimResult = await claimMessagePackPurchase(serviceClient, {
      userId: user.id,
      productId: transaction.productIdentifier,
      transactionId: transaction.transactionIdentifier,
      purchaseToken: transaction.purchaseToken,
      purchasedAt: transaction.purchaseDate,
      appUserId: appUserId || user.id,
      originalAppUserId: originalAppUserId || null,
      store: "PLAY_STORE",
      rawTransaction: transaction,
    });

    if (claimResult.error) {
      console.error("[Message credits] claim failed", {
        userId: user.id,
        transaction,
        error: claimResult.error,
      });
      return jsonResponse(
        {
          ok: false,
          error: "Message pack purchase could not be credited.",
          details: getErrorMessage(claimResult.error),
        },
        500,
      );
    }

    const result = claimResult.data;
    results.push(result);

    if (result.ok && result.applied) {
      appliedCount += 1;
      addedCredits += Number(result.creditsAdded) || 0;
      continue;
    }

    if (result.reason === "already_processed") {
      duplicateCount += 1;
      continue;
    }

    blockedCount += 1;
  }

  const { data: balanceRow, error: balanceError } = await serviceClient
    .from("message_credit_balances")
    .select(
      "balance, total_purchased, total_used, updated_at, last_purchase_at, last_used_at",
    )
    .eq("user_id", user.id)
    .maybeSingle();

  if (balanceError) {
    console.error("[Message credits] balance lookup failed after sync", {
      userId: user.id,
      error: balanceError,
    });
    return jsonResponse(
      {
        ok: false,
        error: "Message credit balance could not be loaded.",
        details: getErrorMessage(balanceError),
      },
      500,
    );
  }

  return jsonResponse({
    ok: true,
    appliedCount,
    duplicateCount,
    blockedCount,
    addedCredits,
    balance: Number(balanceRow?.balance) || 0,
    totalPurchased: Number(balanceRow?.total_purchased) || 0,
    totalUsed: Number(balanceRow?.total_used) || 0,
    updatedAt: balanceRow?.updated_at ?? null,
    lastPurchaseAt: balanceRow?.last_purchase_at ?? null,
    lastUsedAt: balanceRow?.last_used_at ?? null,
    results,
  });
});
