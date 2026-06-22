import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const MESSAGE_PACK_CREDITS: Record<string, number> = {
  message_pack_100: 100,
  message_pack_250: 250,
  message_pack_500: 500,
};

const EXPECTED_MESSAGE_PACK_IDS = Object.keys(MESSAGE_PACK_CREDITS);

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
    },
  });
}

function normalize(value: unknown) {
  return String(value || "")
    .trim()
    .toLowerCase();
}

function identifierMatchesMessagePack(identifier: unknown, messagePackId: string) {
  const normalized = normalize(identifier);
  const expected = normalize(messagePackId);

  if (!normalized || !expected) return false;

  return (
    normalized === expected ||
    normalized.endsWith(`.${expected}`) ||
    normalized.endsWith(`:${expected}`)
  );
}

function getCreditsForPurchase({
  productIdentifier,
  packageIdentifier,
}: {
  productIdentifier: string;
  packageIdentifier: string;
}) {
  for (const messagePackId of EXPECTED_MESSAGE_PACK_IDS) {
    if (
      identifierMatchesMessagePack(productIdentifier, messagePackId) ||
      identifierMatchesMessagePack(packageIdentifier, messagePackId)
    ) {
      return MESSAGE_PACK_CREDITS[messagePackId];
    }
  }

  return 0;
}

function getMatchingNonSubscriptionTransaction(
  customerInfo: Record<string, unknown> | null,
  productIdentifier: string,
) {
  const transactions = Array.isArray(customerInfo?.nonSubscriptionTransactions)
    ? customerInfo.nonSubscriptionTransactions
    : [];

  return (
    transactions
      .filter((transaction): transaction is Record<string, unknown> => {
        return (
          typeof transaction === "object" &&
          transaction !== null &&
          normalize(transaction.productIdentifier) ===
            normalize(productIdentifier)
        );
      })
      .sort((a, b) => {
        const aTime = new Date(String(a.purchaseDate || "")).getTime();
        const bTime = new Date(String(b.purchaseDate || "")).getTime();

        return (Number.isFinite(bTime) ? bTime : 0) -
          (Number.isFinite(aTime) ? aTime : 0);
      })[0] || null
  );
}

Deno.serve(async (req: Request) => {
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
    console.error("credit-message-pack missing Supabase env");
    return jsonResponse(
      { ok: false, code: "server_config", error: "Server is not configured." },
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
    error: userError,
  } = await userClient.auth.getUser();

  if (userError || !user) {
    console.error("credit-message-pack auth failure", userError);
    return jsonResponse({ ok: false, code: "unauthorized" }, 401);
  }

  const body = await req.json().catch(() => ({}));
  const platform = normalize(body.platform);
  const productIdentifier = String(body.product_identifier || "").trim();
  const packageIdentifier = String(body.package_identifier || "").trim();
  const customerInfo =
    typeof body.customer_info === "object" && body.customer_info !== null
      ? (body.customer_info as Record<string, unknown>)
      : null;
  const matchingTransaction = getMatchingNonSubscriptionTransaction(
    customerInfo,
    productIdentifier,
  );
  const transactionId = String(
    body.transaction_id ||
      matchingTransaction?.transactionIdentifier ||
      matchingTransaction?.purchaseToken ||
      "",
  ).trim();
  const purchaseDate = String(
    body.purchase_date || matchingTransaction?.purchaseDate || "",
  ).trim();
  const credits = getCreditsForPurchase({
    productIdentifier,
    packageIdentifier,
  });

  if (!["android", "ios"].includes(platform)) {
    return jsonResponse(
      {
        ok: false,
        code: "unsupported_platform",
        error: "Message packs are only available on iOS and Android.",
      },
      400,
    );
  }

  if (!productIdentifier || !packageIdentifier || credits <= 0) {
    console.error("credit-message-pack unknown message pack", {
      userId: user.id,
      platform,
      productIdentifier,
      packageIdentifier,
      expectedMessagePackIds: EXPECTED_MESSAGE_PACK_IDS,
    });

    return jsonResponse(
      { ok: false, code: "unknown_message_pack" },
      400,
    );
  }

  if (!transactionId) {
    return jsonResponse(
      { ok: false, code: "missing_transaction_id" },
      400,
    );
  }

  const customerInfoProductIds = Array.isArray(
      customerInfo?.allPurchasedProductIdentifiers,
    )
    ? customerInfo.allPurchasedProductIdentifiers.map(normalize)
    : [];
  const hasCustomerInfoProductMatch =
    customerInfoProductIds.includes(normalize(productIdentifier)) ||
    Boolean(matchingTransaction);

  if (!hasCustomerInfoProductMatch) {
    console.error("credit-message-pack purchase not present in customer info", {
      userId: user.id,
      platform,
      productIdentifier,
      packageIdentifier,
      customerInfoProductIds,
    });

    return jsonResponse(
      { ok: false, code: "purchase_not_found" },
      400,
    );
  }

  const providerResponse = {
    revenuecat_product_identifier: productIdentifier,
    revenuecat_package_identifier: packageIdentifier,
    revenuecat_transaction_id: transactionId,
    purchase_date: purchaseDate || null,
    original_app_user_id: typeof customerInfo?.originalAppUserId === "string"
      ? customerInfo.originalAppUserId
      : null,
    request_date: typeof customerInfo?.requestDate === "string"
      ? customerInfo.requestDate
      : null,
  };

  const { data, error } = await serviceClient.rpc(
    "credit_message_pack_purchase",
    {
      p_user_id: user.id,
      p_revenuecat_transaction_id: transactionId,
      p_product_identifier: productIdentifier,
      p_package_identifier: packageIdentifier,
      p_platform: platform,
      p_credits: credits,
      p_provider_response: providerResponse,
    },
  );

  if (error) {
    console.error("credit-message-pack rpc failed", {
      userId: user.id,
      platform,
      productIdentifier,
      packageIdentifier,
      error,
    });

    return jsonResponse(
      { ok: false, code: "credit_failed", error: error.message },
      500,
    );
  }

  const result = Array.isArray(data) ? data[0] : data;

  return jsonResponse({
    ok: true,
    creditsAdded: credits,
    creditsRemaining: Number(result?.credits_remaining ?? 0),
    purchaseCreated: Boolean(result?.purchase_created),
  });
});
