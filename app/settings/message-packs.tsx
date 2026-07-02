import Constants from "expo-constants";
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useRef, useState } from "react";
import { Alert, Platform, Pressable, Text, View } from "react-native";

import { AppScreen } from "../../components/layout/AppScreen";
import { isSchedovaInternalDebugMode } from "../../lib/debugMode";
import {
  checkMessagePackPurchases,
  formatMessageCreditCount,
  loadMessagePackProducts,
  loadMessageCreditBalance,
  purchaseMessagePack,
  type MessageCreditBalance,
  type MessagePackProductSummary,
} from "../../lib/messageCredits";
import { MESSAGE_PACK_PRODUCT_IDS } from "../../lib/messageCreditProducts";
import {
  getLastRevenueCatErrorDetails,
  getRevenueCatConfigurationState,
  getRevenueCatSupportState,
} from "../../lib/revenuecat/revenueCatService";
import { useSubscription } from "../../lib/revenuecat/SubscriptionProvider";
import { useAppTheme } from "../../lib/useAppTheme";

const EMPTY_BALANCE: MessageCreditBalance = {
  balance: 0,
  totalPurchased: 0,
  totalUsed: 0,
  updatedAt: null,
  lastPurchaseAt: null,
  lastUsedAt: null,
};

const EMPTY_PRODUCTS_MESSAGE =
  "Message packs are not available on this device yet. Please try again.";
const PRODUCT_LOAD_ERROR_MESSAGE =
  "Message packs could not be loaded right now. Please try again.";
const PURCHASE_CHECK_ERROR_MESSAGE =
  "Message pack purchases could not be checked right now. Please try again.";
const STORE_PURCHASE_UNAVAILABLE_MESSAGE =
  "Message pack purchases are not available in Expo Go. Open the installed app or development build instead.";

function getAppVersionLabel() {
  const version = Constants.expoConfig?.version ?? "unknown";
  const nativeBuild =
    Platform.OS === "android"
      ? String(
          Constants.platform?.android?.versionCode ??
            Constants.expoConfig?.android?.versionCode ??
            "unknown",
        )
      : String(
          Constants.platform?.ios?.buildNumber ??
            Constants.expoConfig?.ios?.buildNumber ??
            "unknown",
        );

  return `${version} (${nativeBuild})`;
}

function getBuildProfileLabel() {
  const envProfile = process.env.EXPO_PUBLIC_EAS_BUILD_PROFILE;

  if (typeof envProfile === "string" && envProfile.trim().length > 0) {
    return envProfile.trim();
  }

  return Constants.executionEnvironment ?? "unknown";
}

function getBuildChannelLabel() {
  const manifestExtra =
    (Constants.manifest2?.extra as Record<string, unknown> | undefined) ??
    null;
  const configExtra =
    (Constants.expoConfig?.extra as Record<string, unknown> | undefined) ?? null;

  if (manifestExtra && typeof manifestExtra.channel === "string") {
    return manifestExtra.channel;
  }

  if (configExtra && typeof configExtra.channel === "string") {
    return configExtra.channel;
  }

  return "unknown";
}

function getFriendlyMessage(error: unknown, fallback: string) {
  const message = error instanceof Error ? error.message.trim() : "";
  const normalizedMessage = message.toLowerCase();

  if (normalizedMessage.includes("sign in")) {
    return "Please sign in again.";
  }

  if (normalizedMessage.includes("expo go")) {
    return STORE_PURCHASE_UNAVAILABLE_MESSAGE;
  }

  if (normalizedMessage.includes("android only")) {
    return "Message packs are not available on this device yet. Please try again.";
  }

  return fallback;
}

export default function MessagePacksScreen() {
  const router = useRouter();
  const { colors } = useAppTheme();
  const { authReady, userId, isPro, revenueCatSupported } = useSubscription();
  const [balance, setBalance] = useState<MessageCreditBalance>(EMPTY_BALANCE);
  const [products, setProducts] = useState<MessagePackProductSummary[]>([]);
  const [loadingBalance, setLoadingBalance] = useState(true);
  const [loadingProducts, setLoadingProducts] = useState(
    Platform.OS === "ios" || Platform.OS === "android",
  );
  const [refreshingPurchases, setRefreshingPurchases] = useState(false);
  const [activeProductId, setActiveProductId] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState("");
  const [balanceLoadMessage, setBalanceLoadMessage] = useState("");
  const [productLoadState, setProductLoadState] = useState<
    "idle" | "loading" | "ready" | "empty" | "error"
  >("idle");
  const [productLoadMessage, setProductLoadMessage] = useState("");
  const revenueCatSupport = getRevenueCatSupportState();
  const revenueCatPlatform = revenueCatSupport.platform;
  const revenueCatAppOwnership = revenueCatSupport.appOwnership;
  const revenueCatSupportReason = revenueCatSupport.reason;
  const screenActiveRef = useRef(true);

  const refreshBalance = useCallback(
    async (showAlertOnFailure = false) => {
      if (!authReady) {
        if (screenActiveRef.current) {
          setBalance(EMPTY_BALANCE);
          setLoadingBalance(true);
          setBalanceLoadMessage("");
        }
        return false;
      }

      if (screenActiveRef.current) {
        setLoadingBalance(true);
        setBalanceLoadMessage("");
      }

      try {
        const nextBalance = await loadMessageCreditBalance(userId);

        if (screenActiveRef.current) {
          setBalance(nextBalance);
        }

        return true;
      } catch (error) {
        console.error("[Message credits] balance refresh failed", error);

        if (screenActiveRef.current) {
          setBalanceLoadMessage(
            "Message credits could not be loaded right now.",
          );
        }

        if (showAlertOnFailure) {
          Alert.alert(
            "Message packs",
            "Message credits could not be loaded right now. Please try again.",
          );
        }

        return false;
      } finally {
        if (screenActiveRef.current) {
          setLoadingBalance(false);
        }
      }
    },
    [authReady, userId],
  );

  const refreshProducts = useCallback(async () => {
    if (screenActiveRef.current) {
      setLoadingProducts(true);
      setProductLoadState("loading");
      setProductLoadMessage("");
    }

    if (!revenueCatSupported) {
      if (screenActiveRef.current) {
        setProducts([]);
        setProductLoadState("empty");
        setProductLoadMessage(
          revenueCatSupportReason === "expo_go"
            ? STORE_PURCHASE_UNAVAILABLE_MESSAGE
            : EMPTY_PRODUCTS_MESSAGE,
        );
      }

      console.log("[Message credits] product load skipped", {
        platform: Platform.OS,
        revenueCatSupported,
        supportState: {
          platform: revenueCatPlatform,
          appOwnership: revenueCatAppOwnership,
          reason: revenueCatSupportReason,
        },
      });

      return [] as MessagePackProductSummary[];
    }

    const revenueCatConfiguration = getRevenueCatConfigurationState();

    try {
      if (isSchedovaInternalDebugMode()) {
        console.log("Schedova 1.1.3 message pack runtime", {
          appVersion: getAppVersionLabel(),
          buildProfile: getBuildProfileLabel(),
          buildChannel: getBuildChannelLabel(),
          platform: revenueCatPlatform,
          appOwnership: revenueCatAppOwnership,
          revenueCatSupported,
          revenueCatConfigured: revenueCatConfiguration.configured,
          fetchMode: "direct_getProducts",
          productCategory: "NON_SUBSCRIPTION",
          usesOfferings: false,
          requestedProductIds: MESSAGE_PACK_PRODUCT_IDS,
        });
      }

      const nextProducts = await loadMessagePackProducts();

      console.log("[Message credits] product load completed", {
        count: nextProducts.length,
        productIds: nextProducts.map((product) => product.productId),
      });

      if (!screenActiveRef.current) {
        return nextProducts;
      }

      setProducts(nextProducts);

      if (nextProducts.length === 0) {
        setProductLoadState("empty");
        setProductLoadMessage(EMPTY_PRODUCTS_MESSAGE);
      } else {
        setProductLoadState("ready");
        setProductLoadMessage("");
      }

      return nextProducts;
    } catch (error) {
      console.error("[Message credits] product load failed", error);
      console.log("[Message credits] product load failure details", {
        platform: Platform.OS,
        requestedProductIds: MESSAGE_PACK_PRODUCT_IDS,
        supportState: {
          platform: revenueCatPlatform,
          appOwnership: revenueCatAppOwnership,
          reason: revenueCatSupportReason,
        },
        revenueCatConfigured: revenueCatConfiguration.configured,
        revenueCatError: getLastRevenueCatErrorDetails(),
      });

      if (screenActiveRef.current) {
        setProducts([]);
        setProductLoadState("error");
        setProductLoadMessage(
          getFriendlyMessage(error, PRODUCT_LOAD_ERROR_MESSAGE),
        );
      }

      return [] as MessagePackProductSummary[];
    } finally {
      if (screenActiveRef.current) {
        setLoadingProducts(false);
      }
    }
  }, [
    revenueCatAppOwnership,
    revenueCatPlatform,
    revenueCatSupportReason,
    revenueCatSupported,
  ]);

  useFocusEffect(
    useCallback(() => {
      screenActiveRef.current = true;
      void refreshBalance(false);
      void refreshProducts();

      return () => {
        screenActiveRef.current = false;
      };
    }, [refreshBalance, refreshProducts]),
  );

  async function handleCheckPurchases() {
    if (!authReady) {
      Alert.alert("Message packs", "Your account is still loading. Please try again.");
      return;
    }

    if (!userId) {
      Alert.alert("Message packs", "Please sign in again.");
      return;
    }

    if (!purchasesAvailableOnThisDevice) {
      console.log("[Message credits] check purchases blocked", revenueCatSupport);
      Alert.alert(
        "Message packs",
        revenueCatSupport.reason === "expo_go"
          ? STORE_PURCHASE_UNAVAILABLE_MESSAGE
          : EMPTY_PRODUCTS_MESSAGE,
      );
      return;
    }

    if (screenActiveRef.current) {
      setRefreshingPurchases(true);
      setStatusMessage("");
    }

    try {
      const syncResult = await checkMessagePackPurchases(userId);

      if (!screenActiveRef.current) {
        return;
      }

      setBalance(syncResult.balance);

      if (syncResult.addedCredits > 0) {
        setStatusMessage(
          `${formatMessageCreditCount(syncResult.addedCredits)} added to your account.`,
        );
      } else if (syncResult.duplicateCount > 0) {
        setStatusMessage("Your message pack purchases are already applied.");
      } else {
        setStatusMessage("No new message pack purchases were found.");
      }
    } catch (error) {
      console.error("[Message credits] purchase check failed", error);
      console.log("[Message credits] purchase check failure details", {
        userId,
        revenueCatError: getLastRevenueCatErrorDetails(),
      });

      if (screenActiveRef.current) {
        setStatusMessage(
          getFriendlyMessage(error, PURCHASE_CHECK_ERROR_MESSAGE),
        );
      }
    } finally {
      if (screenActiveRef.current) {
        setRefreshingPurchases(false);
      }
    }
  }

  async function handleRefreshBalance() {
    if (screenActiveRef.current) {
      setStatusMessage("");
    }

    const refreshed = await refreshBalance(true);

    if (refreshed && screenActiveRef.current) {
      setStatusMessage("Message credit balance refreshed.");
    }
  }

  async function handleRetryProducts() {
    if (screenActiveRef.current) {
      setStatusMessage("");
    }

    await refreshProducts();
  }

  async function handleBuy(product: MessagePackProductSummary) {
    if (!authReady) {
      Alert.alert("Message packs", "Your account is still loading. Please try again.");
      return;
    }

    if (!userId) {
      Alert.alert("Message packs", "Please sign in again.");
      return;
    }

    if (!purchasesAvailableOnThisDevice) {
      console.log("[Message credits] purchase blocked", revenueCatSupport);
      Alert.alert(
        "Message packs",
        revenueCatSupport.reason === "expo_go"
          ? STORE_PURCHASE_UNAVAILABLE_MESSAGE
          : EMPTY_PRODUCTS_MESSAGE,
      );
      return;
    }

    if (screenActiveRef.current) {
      setActiveProductId(product.productId);
      setStatusMessage("");
    }

    try {
      const purchaseResult = await purchaseMessagePack(
        product.product,
        userId,
      );

      if (!screenActiveRef.current) {
        return;
      }

      if (purchaseResult.cancelled) {
        setStatusMessage("Purchase canceled.");
        return;
      }

      if (purchaseResult.syncResult) {
        setBalance(purchaseResult.syncResult.balance);
        setStatusMessage(
          purchaseResult.syncResult.addedCredits > 0
            ? `${formatMessageCreditCount(purchaseResult.syncResult.addedCredits)} added to your account.`
            : "Purchase is already synced to your account.",
        );
      } else {
        const refreshed = await refreshBalance(true);
        setStatusMessage(
          refreshed
            ? "Purchase complete."
            : "Purchase complete. Balance refresh is still catching up.",
        );
      }
    } catch (error) {
      console.error("[Message credits] purchase failed", error);
      Alert.alert(
        "Message packs",
        getFriendlyMessage(
          error,
          "This message pack could not be purchased right now. Please try again.",
        ),
      );
    } finally {
      if (screenActiveRef.current) {
        setActiveProductId(null);
      }
    }
  }

  const purchasesAvailableOnThisDevice =
    revenueCatSupported;
  const purchaseBusy = Boolean(activeProductId);
  const actionBusy = refreshingPurchases || purchaseBusy;
  const showProductSection = Platform.OS === "ios" || Platform.OS === "android";
  const showDebugPanel =
    showProductSection && isSchedovaInternalDebugMode();
  const revenueCatConfiguration = getRevenueCatConfigurationState();
  const latestRevenueCatError = getLastRevenueCatErrorDetails();
  const latestRevenueCatErrorMessage =
    latestRevenueCatError?.underlyingErrorMessage ??
    latestRevenueCatError?.message ??
    (productLoadMessage || "none");
  const balanceReady = !loadingBalance && !balanceLoadMessage;
  const balanceHeadline = loadingBalance
    ? "Loading..."
    : balanceLoadMessage
      ? "--"
      : String(balance.balance);
  const totalPurchasedLabel = balanceReady
    ? formatMessageCreditCount(balance.totalPurchased)
    : "--";
  const totalUsedLabel = balanceReady
    ? formatMessageCreditCount(balance.totalUsed)
    : "--";
  const purchasedPackBalanceLabel = balanceReady
    ? formatMessageCreditCount(balance.balance)
    : "--";
  const monthlyIncludedLabel = balanceReady ? "None" : "--";

  return (
    <AppScreen scroll backgroundColor={colors.background}>
      <Pressable
        onPress={() => router.back()}
        style={{
          alignSelf: "flex-start",
          paddingVertical: 6,
          paddingRight: 12,
          marginBottom: 10,
        }}
      >
        <Text style={{ color: colors.mutedText, fontWeight: "900" }}>Back</Text>
      </Pressable>

      <Text
        style={{
          color: colors.text,
          fontSize: 30,
          fontWeight: "bold",
          marginBottom: 10,
        }}
      >
        Message Packs
      </Text>

      <Text
        style={{ color: colors.mutedText, marginBottom: 20, lineHeight: 21 }}
      >
        Buy one-time SMS credit packs for appointment texting.
      </Text>

      <View
        style={{
          backgroundColor: colors.card,
          borderWidth: 1,
          borderColor: colors.border,
          borderRadius: 18,
          padding: 18,
          marginBottom: 16,
        }}
      >
        <Text
          style={{
            color: colors.mutedText,
            fontSize: 13,
            fontWeight: "800",
            letterSpacing: 0.3,
            marginBottom: 8,
          }}
        >
          CURRENT MESSAGE CREDITS
        </Text>
        <Text
          style={{
            color: colors.text,
            fontSize: 34,
            fontWeight: "900",
            marginBottom: 4,
          }}
        >
          {balanceHeadline}
        </Text>
        <Text style={{ color: colors.mutedText, lineHeight: 20 }}>
          Purchased: {totalPurchasedLabel}. Used: {totalUsedLabel}.
        </Text>
        <Text style={{ color: colors.mutedText, lineHeight: 20, marginTop: 4 }}>
          Included monthly: {monthlyIncludedLabel}. Purchased pack balance:{" "}
          {purchasedPackBalanceLabel}.
        </Text>
        {balanceLoadMessage ? (
          <Text
            style={{
              color: colors.mutedText,
              lineHeight: 20,
              marginTop: 8,
            }}
          >
            {balanceLoadMessage}
          </Text>
        ) : null}
      </View>

      {!isPro ? (
        <View
          style={{
            backgroundColor: colors.card,
            borderWidth: 1,
            borderColor: colors.border,
            borderRadius: 16,
            padding: 16,
            marginBottom: 16,
          }}
        >
          <Text style={{ color: colors.text, fontWeight: "900", fontSize: 16 }}>
            Schedova Pro still controls SMS automation
          </Text>
          <Text
            style={{ color: colors.mutedText, marginTop: 8, lineHeight: 20 }}
          >
            Message packs cover SMS credits. Schedova Pro is still required to
            use appointment SMS automation in this build.
          </Text>
        </View>
      ) : null}

      <View
        style={{
          flexDirection: "row",
          gap: 10,
          marginBottom: 16,
        }}
      >
        <Pressable
          disabled={
            refreshingPurchases ||
            activeProductId !== null ||
            !purchasesAvailableOnThisDevice
          }
          onPress={handleCheckPurchases}
          style={{
            flex: 1,
            backgroundColor:
              refreshingPurchases ||
              activeProductId !== null ||
              !purchasesAvailableOnThisDevice
                ? colors.mutedText
                : colors.primary,
            borderRadius: 14,
            paddingVertical: 14,
            alignItems: "center",
          }}
        >
          <Text style={{ color: "#FFFFFF", fontWeight: "900" }}>
            {!purchasesAvailableOnThisDevice
              ? "Unavailable"
              : refreshingPurchases
                ? "Checking..."
                : "Check Purchases"}
          </Text>
        </Pressable>

        <Pressable
          disabled={actionBusy}
          onPress={() => void handleRefreshBalance()}
          style={{
            flex: 1,
            borderWidth: 1,
            borderColor: colors.border,
            backgroundColor: actionBusy ? colors.background : colors.card,
            borderRadius: 14,
            paddingVertical: 14,
            alignItems: "center",
          }}
        >
          <Text style={{ color: colors.text, fontWeight: "900" }}>
            Refresh Balance
          </Text>
        </Pressable>
      </View>

      {!purchasesAvailableOnThisDevice ? (
        <View
          style={{
            backgroundColor: colors.card,
            borderWidth: 1,
            borderColor: colors.border,
            borderRadius: 16,
            padding: 16,
            marginBottom: 16,
          }}
        >
          <Text style={{ color: colors.text, fontWeight: "900", fontSize: 16 }}>
            Message pack purchases unavailable
          </Text>
          <Text
            style={{ color: colors.mutedText, marginTop: 8, lineHeight: 20 }}
          >
            {revenueCatSupport.reason === "expo_go"
              ? STORE_PURCHASE_UNAVAILABLE_MESSAGE
              : "Message packs are not available on this device yet. Please try again."}
          </Text>
        </View>
      ) : null}

      {showProductSection ? (
        <View
          style={{
            backgroundColor: colors.card,
            borderWidth: 1,
            borderColor: colors.border,
            borderRadius: 18,
            padding: 18,
            marginBottom: 18,
          }}
        >
          <Text
            style={{
              color: colors.text,
              fontSize: 18,
              fontWeight: "900",
              marginBottom: 14,
            }}
          >
            Available Message Packs
          </Text>

          {showDebugPanel ? (
            <View
              style={{
                borderWidth: 1,
                borderColor: colors.border,
                borderRadius: 12,
                padding: 12,
                marginBottom: 14,
                backgroundColor: colors.background,
              }}
            >
              <Text
                style={{
                  color: colors.text,
                  fontSize: 14,
                  fontWeight: "900",
                  marginBottom: 6,
                }}
              >
                Schedova 1.1.3 message pack runtime
              </Text>
              <Text style={{ color: colors.mutedText, lineHeight: 19 }}>
                appVersion={getAppVersionLabel()} buildProfile=
                {getBuildProfileLabel()} channel={getBuildChannelLabel()}
              </Text>
              <Text
                style={{
                  color: colors.mutedText,
                  lineHeight: 19,
                  marginTop: 6,
                }}
              >
                platform={revenueCatSupport.platform} executionEnvironment=
                {Constants.executionEnvironment} appOwnership=
                {revenueCatSupport.appOwnership ?? "null"}
              </Text>
              <Text
                style={{
                  color: colors.mutedText,
                  lineHeight: 19,
                  marginTop: 6,
                }}
              >
                supported={String(revenueCatSupported)} revenueCatConfigured=
                {revenueCatConfiguration.configured ? "yes" : "no"} loadState=
                {productLoadState} count={products.length}
              </Text>
              <Text
                style={{
                  color: colors.mutedText,
                  lineHeight: 19,
                  marginTop: 6,
                }}
              >
                fetchMode=direct_getProducts productCategory=NON_SUBSCRIPTION
                offeringsUsed=false
              </Text>
              <Text
                style={{
                  color: colors.mutedText,
                  lineHeight: 19,
                  marginTop: 6,
                }}
              >
                creditPolicy=telnyx_success_deducts_one
                lifetimeProCreditBypass=disabled
              </Text>
              <Text
                style={{
                  color: colors.mutedText,
                  lineHeight: 19,
                  marginTop: 6,
                }}
              >
                requested IDs: {MESSAGE_PACK_PRODUCT_IDS.join(", ")}
              </Text>
              <Text
                style={{
                  color: colors.mutedText,
                  lineHeight: 19,
                  marginTop: 6,
                }}
              >
                latest error: {latestRevenueCatErrorMessage}
              </Text>
            </View>
          ) : null}

          {!purchasesAvailableOnThisDevice ? (
            <Text style={{ color: colors.mutedText, lineHeight: 20 }}>
              {revenueCatSupport.reason === "expo_go"
                ? STORE_PURCHASE_UNAVAILABLE_MESSAGE
                : EMPTY_PRODUCTS_MESSAGE}
            </Text>
          ) : loadingProducts || productLoadState === "loading" ? (
            <Text style={{ color: colors.mutedText, lineHeight: 20 }}>
              Loading message packs...
            </Text>
          ) : productLoadState === "error" ? (
            <>
              <Text style={{ color: colors.mutedText, lineHeight: 20 }}>
                {productLoadMessage || PRODUCT_LOAD_ERROR_MESSAGE}
              </Text>
              <Pressable
                disabled={loadingProducts || purchaseBusy}
                onPress={() => void handleRetryProducts()}
                style={{
                  marginTop: 12,
                  alignSelf: "flex-start",
                  borderWidth: 1,
                  borderColor: colors.border,
                  borderRadius: 12,
                  paddingHorizontal: 16,
                  paddingVertical: 10,
                  backgroundColor:
                    loadingProducts || purchaseBusy
                      ? colors.background
                      : colors.card,
                }}
              >
                <Text style={{ color: colors.text, fontWeight: "900" }}>
                  Retry
                </Text>
              </Pressable>
            </>
          ) : products.length === 0 ? (
            <>
              <Text style={{ color: colors.mutedText, lineHeight: 20 }}>
                {productLoadMessage || EMPTY_PRODUCTS_MESSAGE}
              </Text>
              <Pressable
                disabled={loadingProducts || purchaseBusy}
                onPress={() => void handleRetryProducts()}
                style={{
                  marginTop: 12,
                  alignSelf: "flex-start",
                  borderWidth: 1,
                  borderColor: colors.border,
                  borderRadius: 12,
                  paddingHorizontal: 16,
                  paddingVertical: 10,
                  backgroundColor:
                    loadingProducts || purchaseBusy
                      ? colors.background
                      : colors.card,
                }}
              >
                <Text style={{ color: colors.text, fontWeight: "900" }}>
                  Retry
                </Text>
              </Pressable>
            </>
          ) : (
            products.map((product, index) => {
              const purchasingThisProduct = activeProductId === product.productId;

              return (
                <View
                  key={product.productId}
                  style={{
                    borderWidth: 1,
                    borderColor: colors.border,
                    borderRadius: 16,
                    padding: 16,
                    marginBottom: index === products.length - 1 ? 0 : 12,
                  }}
                >
                  <View
                    style={{
                      flexDirection: "row",
                      justifyContent: "space-between",
                      gap: 12,
                      marginBottom: 8,
                    }}
                  >
                    <View style={{ flex: 1 }}>
                      <Text
                        style={{
                          color: colors.text,
                          fontSize: 18,
                          fontWeight: "900",
                        }}
                      >
                        {product.label}
                      </Text>
                      <Text
                        style={{
                          color: colors.mutedText,
                          marginTop: 4,
                          lineHeight: 20,
                        }}
                      >
                        One-time purchase.
                      </Text>
                    </View>

                    <Text
                      style={{
                        color: colors.text,
                        fontSize: 20,
                        fontWeight: "900",
                      }}
                    >
                      {product.priceString}
                    </Text>
                  </View>

                  <Pressable
                    disabled={actionBusy}
                    onPress={() => void handleBuy(product)}
                    style={{
                      backgroundColor:
                        actionBusy ? colors.mutedText : colors.primary,
                      borderRadius: 12,
                      paddingVertical: 13,
                      alignItems: "center",
                    }}
                  >
                    <Text style={{ color: "#FFFFFF", fontWeight: "900" }}>
                      {purchasingThisProduct
                        ? "Purchasing..."
                        : `Buy ${product.credits} credits`}
                    </Text>
                  </Pressable>
                </View>
              );
            })
          )}
        </View>
      ) : null}

      {statusMessage ? (
        <Text
          accessibilityLiveRegion="polite"
          style={{
            color: colors.mutedText,
            fontSize: 13,
            fontWeight: "700",
            lineHeight: 18,
            marginTop: 4,
            textAlign: "center",
          }}
        >
          {statusMessage}
        </Text>
      ) : null}
    </AppScreen>
  );
}
