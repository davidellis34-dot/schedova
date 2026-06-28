import { Ionicons } from "@expo/vector-icons";
import { router, useFocusEffect } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  Linking,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Text,
  View,
} from "react-native";
import type { CustomerInfo, PurchasesPackage } from "react-native-purchases";
import { AppScreen } from "../components/layout/AppScreen";
import { getLastAuthDiagnosticEvent } from "../lib/authDiagnostics";
import { copyTextToClipboard } from "../lib/clipboard";
import { isSchedovaInternalDebugMode } from "../lib/debugMode";
import { useFeatureAccess } from "../lib/featureAccess";
import { PRIVACY_POLICY_URL, TERMS_OF_USE_URL } from "../lib/legalLinks";
import { ENABLE_PRO } from "../lib/proFeatureFlag";
import { REVENUECAT_ENTITLEMENT_ID } from "../lib/revenuecat/constants";
import { useSubscription } from "../lib/revenuecat/SubscriptionProvider";
import { getLastSubscriptionSyncSummary } from "../lib/revenuecat/subscriptionSync";
import {
  getSchedovaProFriendlyStatus,
  hasAdminLifetimeSchedovaProAccess,
} from "../lib/subscriptionAccess";
import {
  getActiveRevenueCatEntitlementIds,
  getRevenueCatErrorDetails,
  getRevenueCatDebugSnapshot,
  getSchedovaProEntitlement,
  logRevenueCatError,
  prefetchRevenueCatOfferings,
  type RevenueCatDebugSnapshot,
} from "../lib/revenuecat/revenueCatService";
import { supabase } from "../lib/supabase";
import { useAppTheme } from "../lib/useAppTheme";

const APPLE_SUBSCRIPTION_URL = "https://apps.apple.com/account/subscriptions";
const APPLE_REFUND_URL = "https://reportaproblem.apple.com/";
const GOOGLE_PLAY_SUBSCRIPTION_URL =
  "https://play.google.com/store/account/subscriptions";
const GOOGLE_PLAY_REFUND_URL =
  "https://support.google.com/googleplay/workflow/9813244";
const SUBSCRIPTION_PREFETCH_FRESHNESS_MS = 60_000;
const PRO_PRIMARY_COLOR = "#0F766E";
const PRO_SECONDARY_COLOR = "#134E4A";
const PRO_SECONDARY_BORDER = "#14B8A6";
const REVENUECAT_DIAGNOSTICS_ENABLED = isSchedovaInternalDebugMode();
const PRO_PURCHASE_REFRESH_TIMEOUT_MS = 12_000;
const PRO_PURCHASE_PREFETCH_TIMEOUT_MS = 12_000;
const PRO_PURCHASE_DELAYED_MESSAGE =
  "Purchase complete. Your Pro access may take a moment to update.";
const PRO_PREVIEW_LOCKED_MESSAGE =
  "Schedova Pro is currently in preview. Subscriptions will be available after launch.";

type ProFeature = {
  title: string;
  description: string;
  icon: keyof typeof Ionicons.glyphMap;
};

type SubscriptionPackageSummary = {
  packageIdentifier: string;
  productIdentifier: string;
  title: string;
  duration: string;
  price: string;
};

type SubscriptionPackageStatus = "checking" | "available" | "unavailable";

type DebugColors = ReturnType<typeof useAppTheme>["colors"];
type SupabaseSubscriptionDebug = {
  status: string | null;
  entitlement: string | null;
  entitlement_source: string | null;
  plan: string | null;
  updated_at: string | null;
};
type AuthDiagnosticDebug = ReturnType<typeof getLastAuthDiagnosticEvent>;

const PRO_FEATURES: ProFeature[] = [
  {
    title: "SMS appointment texts",
    description:
      "Send appointment messages when SMS is enabled and clients opt in.",
    icon: "chatbubble-ellipses-outline",
  },
  {
    title: "Reports and business insights",
    description: "Track revenue, bookings, and business trends.",
    icon: "bar-chart-outline",
  },
  {
    title: "Client history",
    description: "See richer appointment history and client context.",
    icon: "person-circle-outline",
  },
  {
    title: "Blocked time",
    description: "Protect focus time and personal appointments.",
    icon: "remove-circle-outline",
  },
  {
    title: "Vacation blocks",
    description: "Mark days away so they stay off your schedule.",
    icon: "calendar-clear-outline",
  },
  {
    title: "Custom business hours",
    description: "Fine-tune availability around the way you work.",
    icon: "time-outline",
  },
  {
    title: "More booking tools as Pro grows",
    description: "New advanced tools will continue landing in Pro.",
    icon: "sparkles-outline",
  },
];

function formatDate(value: string | null | undefined) {
  if (!value) return null;

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) return null;

  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

async function openUrl(url: string) {
  try {
    await Linking.openURL(url);
  } catch {
    Alert.alert("Unable to open link", "Please try again.");
  }
}

async function openSubscriptionHelpUrl(url: string) {
  try {
    await Linking.openURL(url);
  } catch {
    Alert.alert(
      "Subscription help",
      "Unable to open subscription help. Please try again.",
    );
  }
}

function formatDebugList(values: string[]) {
  return values.length ? values.join(", ") : "None";
}

function hasProEntitlement(customerInfo: CustomerInfo | null | undefined) {
  return Boolean(getSchedovaProEntitlement(customerInfo));
}

function formatSubscriptionDuration(pkg: PurchasesPackage) {
  const period = String(pkg.product.subscriptionPeriod || "").toUpperCase();

  if (period === "P1M") return "Monthly subscription";
  if (period === "P1Y") return "Yearly subscription";
  if (period === "P1W") return "Weekly subscription";
  if (period === "P3M") return "3-month subscription";
  if (period === "P6M") return "6-month subscription";

  const packageType = String(pkg.packageType || "").toUpperCase();
  const productId = String(pkg.product.identifier || "").toLowerCase();

  if (packageType.includes("ANNUAL") || productId.includes("year")) {
    return "Yearly subscription";
  }

  if (packageType.includes("MONTH") || productId.includes("month")) {
    return "Monthly subscription";
  }

  return "Subscription";
}

function getSubscriptionTitle(pkg: PurchasesPackage) {
  const title = String(pkg.product.title || "").trim();
  const productId = String(pkg.product.identifier || "").toLowerCase();

  if (title) return title;
  if (productId.includes("year")) return "Schedova Pro Yearly";
  if (productId.includes("month")) return "Schedova Pro Monthly";

  return "Schedova Pro";
}

function summarizeSubscriptionPackage(
  pkg: PurchasesPackage,
): SubscriptionPackageSummary {
  return {
    packageIdentifier: pkg.identifier,
    productIdentifier: pkg.product.identifier,
    title: getSubscriptionTitle(pkg),
    duration: formatSubscriptionDuration(pkg),
    price: pkg.product.priceString || "Price unavailable",
  };
}

function sortSubscriptionPackages(
  packages: SubscriptionPackageSummary[],
): SubscriptionPackageSummary[] {
  return [...packages].sort((a, b) => {
    const aRank = a.productIdentifier.includes("monthly")
      ? 0
      : a.productIdentifier.includes("yearly")
        ? 1
        : 2;
    const bRank = b.productIdentifier.includes("monthly")
      ? 0
      : b.productIdentifier.includes("yearly")
        ? 1
        : 2;

    return aRank - bRank || a.title.localeCompare(b.title);
  });
}

function createProPurchaseTimeoutError(label: string, timeoutMs: number) {
  const error = new Error(
    `${label} did not finish within ${timeoutMs / 1000} seconds.`,
  );
  error.name = "ProPurchaseTimeout";
  return error;
}

async function withProPurchaseTimeout<T>(
  label: string,
  promise: Promise<T>,
  timeoutMs: number,
) {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;

  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => {
          reject(createProPurchaseTimeoutError(label, timeoutMs));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
}

function updateSnapshotIfChanged(
  previous: RevenueCatDebugSnapshot | null,
  nextSnapshot: RevenueCatDebugSnapshot,
) {
  if (JSON.stringify(previous) === JSON.stringify(nextSnapshot)) {
    return previous;
  }

  return nextSnapshot;
}

function DebugRow({
  label,
  value,
  colors,
}: {
  label: string;
  value: string;
  colors: DebugColors;
}) {
  return (
    <View
      style={{
        borderTopWidth: 1,
        borderTopColor: colors.border,
        paddingVertical: 10,
      }}
    >
      <Text
        style={{ color: colors.mutedText, fontSize: 12, fontWeight: "800" }}
      >
        {label}
      </Text>
      <Text
        selectable
        style={{
          color: colors.text,
          fontSize: 13,
          fontWeight: "700",
          lineHeight: 18,
          marginTop: 3,
        }}
      >
        {value}
      </Text>
    </View>
  );
}

function DebugActionButton({
  title,
  onPress,
  disabled,
  colors,
}: {
  title: string;
  onPress: () => void;
  disabled: boolean;
  colors: DebugColors;
}) {
  return (
    <Pressable
      disabled={disabled}
      onPress={onPress}
      style={{
        borderWidth: 1,
        borderColor: colors.border,
        backgroundColor: colors.background,
        borderRadius: 12,
        paddingVertical: 11,
        paddingHorizontal: 12,
        opacity: disabled ? 0.6 : 1,
      }}
    >
      <Text style={{ color: colors.text, fontSize: 13, fontWeight: "900" }}>
        {title}
      </Text>
    </Pressable>
  );
}

function SubscriptionHelpButton({
  title,
  onPress,
  primary,
  colors,
}: {
  title: string;
  onPress: () => void;
  primary?: boolean;
  colors: DebugColors;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={{
        backgroundColor: primary ? PRO_PRIMARY_COLOR : PRO_SECONDARY_COLOR,
        borderColor: primary ? PRO_PRIMARY_COLOR : PRO_SECONDARY_BORDER,
        borderWidth: 1,
        borderRadius: 14,
        paddingVertical: 14,
        paddingHorizontal: 14,
        alignItems: "center",
      }}
    >
      <Text
        style={{
          color: "#FFFFFF",
          fontSize: 15,
          fontWeight: "900",
        }}
      >
        {title}
      </Text>
    </Pressable>
  );
}

function SubscriptionHelpModal({
  visible,
  colors,
  onClose,
  onOpenCustomerCenter,
}: {
  visible: boolean;
  colors: DebugColors;
  onClose: () => void;
  onOpenCustomerCenter: () => void;
}) {
  const storeActions =
    Platform.OS === "android"
      ? [
          {
            title: "Google Play Subscription Help",
            url: GOOGLE_PLAY_SUBSCRIPTION_URL,
          },
          { title: "Google Play Refund Help", url: GOOGLE_PLAY_REFUND_URL },
          { title: "Apple Subscription Help", url: APPLE_SUBSCRIPTION_URL },
          { title: "Apple Refund Support", url: APPLE_REFUND_URL },
        ]
      : [
          { title: "Apple Subscription Help", url: APPLE_SUBSCRIPTION_URL },
          { title: "Apple Refund Support", url: APPLE_REFUND_URL },
          {
            title: "Google Play Subscription Help",
            url: GOOGLE_PLAY_SUBSCRIPTION_URL,
          },
          { title: "Google Play Refund Help", url: GOOGLE_PLAY_REFUND_URL },
        ];

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <Pressable
        onPress={onClose}
        style={{
          flex: 1,
          backgroundColor: "rgba(0,0,0,0.58)",
          justifyContent: "center",
          padding: 22,
        }}
      >
        <Pressable
          onPress={(event) => event.stopPropagation()}
          style={{
            backgroundColor: colors.card,
            borderColor: colors.border,
            borderWidth: 1,
            borderRadius: 18,
            padding: 20,
            gap: 12,
          }}
        >
          <Text style={{ color: colors.text, fontSize: 22, fontWeight: "900" }}>
            Cancel or Refund Help
          </Text>
          <Text
            style={{
              color: colors.mutedText,
              fontSize: 14,
              lineHeight: 21,
            }}
          >
            Subscriptions are managed through the App Store or Google Play. You
            can manage, cancel, or request refund support through your store
            account.
          </Text>

          <SubscriptionHelpButton
            title="Open Customer Center"
            primary
            colors={colors}
            onPress={onOpenCustomerCenter}
          />

          {storeActions.map((action) => (
            <SubscriptionHelpButton
              key={action.title}
              title={action.title}
              colors={colors}
              onPress={() => {
                void openSubscriptionHelpUrl(action.url);
              }}
            />
          ))}

          <Pressable
            onPress={onClose}
            style={{
              paddingVertical: 10,
              alignItems: "center",
            }}
          >
            <Text
              style={{
                color: colors.mutedText,
                fontSize: 15,
                fontWeight: "900",
              }}
            >
              Close
            </Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function RevenueCatDebugPanel({ colors }: { colors: DebugColors }) {
  const {
    customerInfo,
    authReady,
    userId,
    isPro,
    loading,
    lastKnownProForCurrentUser,
    lastCustomerInfoRefreshAt,
    lastRestoreAt,
    customerInfoFetchStatus,
    lastRevenueCatError,
    forceRevenueCatRefresh,
    recoverProForCurrentUser,
    refresh,
    restore,
    showCustomerCenter,
  } = useSubscription();
  const [snapshot, setSnapshot] = useState<RevenueCatDebugSnapshot | null>(
    null,
  );
  const [supabaseEmail, setSupabaseEmail] = useState<string | null>(null);
  const [supabaseSessionExists, setSupabaseSessionExists] = useState<
    boolean | null
  >(null);
  const [supabaseSubscription, setSupabaseSubscription] =
    useState<SupabaseSubscriptionDebug | null>(null);
  const [lastAuthEvent, setLastAuthEvent] = useState<AuthDiagnosticDebug>(
    getLastAuthDiagnosticEvent(),
  );
  const [lastSyncSummary, setLastSyncSummary] = useState(
    getLastSubscriptionSyncSummary(),
  );
  const [panelStatus, setPanelStatus] = useState<"idle" | "loading" | "error">(
    "idle",
  );
  const [showDebugInfoModal, setShowDebugInfoModal] = useState(false);

  const activeError = lastRevenueCatError ?? snapshot?.lastError ?? null;
  const supabaseSubscriptionText = supabaseSubscription
    ? [
        `status=${supabaseSubscription.status ?? "null"}`,
        `entitlement=${supabaseSubscription.entitlement ?? "null"}`,
        `source=${supabaseSubscription.entitlement_source ?? "null"}`,
        `plan=${supabaseSubscription.plan ?? "null"}`,
        `updated=${supabaseSubscription.updated_at ?? "null"}`,
      ].join(" | ")
    : "No subscription row found";
  const lastSyncText = lastSyncSummary
    ? lastSyncSummary.skipped
      ? `skipped: ${lastSyncSummary.reason} at ${lastSyncSummary.syncedAt}`
      : `${lastSyncSummary.status} ${lastSyncSummary.entitlement} from ${lastSyncSummary.entitlementSource} at ${lastSyncSummary.syncedAt}${
          lastSyncSummary.error ? ` (${lastSyncSummary.error})` : ""
        }`
    : "No sync yet";

  const debugInfoText = useMemo(
    () =>
      JSON.stringify(
        {
          supabaseUserId: userId,
          supabaseEmail,
          supabaseSessionExists,
          revenueCatAppUserId:
            snapshot?.appUserID ?? customerInfo?.originalAppUserId ?? null,
          revenueCatOriginalAppUserId:
            snapshot?.originalAppUserID ??
            customerInfo?.originalAppUserId ??
            null,
          revenueCatIsAnonymous: snapshot?.isAnonymous ?? null,
          schedovaProActive: snapshot?.schedovaProActive ?? isPro,
          lastKnownProRecoveryHint: lastKnownProForCurrentUser,
          activeEntitlementIds:
            snapshot?.activeEntitlementIdentifiers ??
            getActiveRevenueCatEntitlementIds(customerInfo),
          entitlementDetails: snapshot?.entitlementDetails ?? [],
          currentOfferingId: snapshot?.currentOfferingIdentifier ?? null,
          sdkKeyPrefix: snapshot?.sdkKeyPrefix ?? null,
          packageIds: snapshot?.packages?.map((pkg) => pkg.identifier) ?? [],
          productIds: snapshot?.packages?.map((pkg) => pkg.productId) ?? [],
          lastCustomerInfoRefreshAt,
          lastRestoreAt,
          customerInfoFetchStatus,
          authReady,
          subscriptionLoading: loading,
          lastRevenueCatError: activeError,
          lastSubscriptionSync: lastSyncSummary,
          supabaseSubscription,
          lastAuthEvent,
        },
        null,
        2,
      ),
    [
      activeError,
      authReady,
      customerInfo,
      customerInfoFetchStatus,
      isPro,
      lastAuthEvent,
      lastCustomerInfoRefreshAt,
      lastKnownProForCurrentUser,
      lastRestoreAt,
      lastSyncSummary,
      loading,
      snapshot,
      supabaseEmail,
      supabaseSessionExists,
      supabaseSubscription,
      userId,
    ],
  );

  const refreshDebugSnapshot = useCallback(async () => {
    if (!REVENUECAT_DIAGNOSTICS_ENABLED) return;

    if (!authReady || !userId) {
      setPanelStatus("idle");
      return;
    }

    setPanelStatus("loading");

    try {
      const info = await refresh();
      const nextSnapshot = await getRevenueCatDebugSnapshot(info, userId);
      const [
        { data: userData },
        { data: sessionData },
        { data: subscriptionData },
      ] = await Promise.all([
        supabase.auth.getUser(),
        supabase.auth.getSession(),
        supabase
          .from("user_subscriptions")
          .select("status, entitlement, entitlement_source, plan, updated_at")
          .eq("user_id", userId)
          .order("updated_at", { ascending: false })
          .limit(1)
          .maybeSingle(),
      ]);

      setSupabaseEmail(userData.user?.email ?? null);
      setSupabaseSessionExists(Boolean(sessionData.session));
      setSupabaseSubscription(
        (subscriptionData as SupabaseSubscriptionDebug | null) ?? null,
      );
      setLastSyncSummary(getLastSubscriptionSyncSummary());
      setLastAuthEvent(getLastAuthDiagnosticEvent());
      setSnapshot((previous) =>
        updateSnapshotIfChanged(previous, nextSnapshot),
      );
      setPanelStatus("idle");
    } catch {
      setPanelStatus("error");
      Alert.alert(
        "RevenueCat debug",
        "Unable to refresh RevenueCat debug information.",
      );
    }
  }, [authReady, refresh, userId]);

  useEffect(() => {
    if (!REVENUECAT_DIAGNOSTICS_ENABLED) return;

    void refreshDebugSnapshot();
  }, [refreshDebugSnapshot]);

  const actionDisabled = panelStatus === "loading";
  const appUserId =
    snapshot?.appUserID ?? customerInfo?.originalAppUserId ?? "Unknown";
  const originalAppUserId =
    snapshot?.originalAppUserID ?? customerInfo?.originalAppUserId ?? "Unknown";
  const activeEntitlementIds =
    snapshot?.activeEntitlementIdentifiers ??
    getActiveRevenueCatEntitlementIds(customerInfo);
  const entitlementDetails = snapshot?.entitlementDetails ?? [];
  const packageIds = snapshot?.packages?.map((pkg) => pkg.identifier) ?? [];
  const productIds = snapshot?.packages?.map((pkg) => pkg.productId) ?? [];

  async function handleCopyDebugInfo() {
    try {
      await copyTextToClipboard(debugInfoText);
      Alert.alert("RevenueCat debug", "Debug info copied.");
    } catch (error) {
      console.log("[RevenueCat] Debug panel info:", debugInfoText);
      console.log("[RevenueCat] Debug info copy failed:", error);
      setShowDebugInfoModal(true);
      Alert.alert(
        "RevenueCat debug",
        "Clipboard is unavailable in this build. The debug info is shown on screen and logged to Metro.",
      );
    }
  }

  return (
    <View
      style={{
        backgroundColor: colors.card,
        borderColor: colors.border,
        borderWidth: 1,
        borderRadius: 18,
        padding: 18,
      }}
    >
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          marginBottom: 8,
        }}
      >
        <Text style={{ color: colors.text, fontSize: 18, fontWeight: "900" }}>
          RevenueCat Debug
        </Text>
        <View
          style={{
            backgroundColor: colors.background,
            borderColor: colors.border,
            borderWidth: 1,
            borderRadius: 999,
            paddingHorizontal: 9,
            paddingVertical: 4,
          }}
        >
          <Text
            style={{ color: colors.mutedText, fontSize: 11, fontWeight: "900" }}
          >
            DEV ONLY
          </Text>
        </View>
      </View>

      <Text style={{ color: colors.mutedText, fontSize: 13, lineHeight: 19 }}>
        Safe diagnostics for Test Store and entitlement checks. No SDK keys or
        credentials are shown.
      </Text>
      <Text
        style={{
          color: colors.mutedText,
          fontSize: 12,
          lineHeight: 18,
          marginTop: 8,
        }}
      >
        If Test Store gets into a weird state, reset/delete the RevenueCat test
        customer purchases or create a fresh Supabase test user.
      </Text>
      <Text
        style={{
          color: colors.mutedText,
          fontSize: 12,
          lineHeight: 18,
          marginTop: 6,
        }}
      >
        After APK updates or reinstalls, use the same Supabase user ID. If the
        original Test Store purchase was made under a previous anonymous
        customer, Restore Purchases may be needed to attach it to this user.
      </Text>
      <Text
        style={{
          color: colors.mutedText,
          fontSize: 12,
          lineHeight: 18,
          marginTop: 6,
        }}
      >
        If a Test Store purchase was made before RevenueCat identity was fixed,
        create a fresh test user and purchase again, or use Restore Purchases.
      </Text>

      <DebugRow
        label="Supabase user ID"
        value={userId ?? "Unknown"}
        colors={colors}
      />
      <DebugRow
        label="Supabase email"
        value={supabaseEmail ?? "Unknown"}
        colors={colors}
      />
      <DebugRow
        label="Supabase session exists"
        value={
          typeof supabaseSessionExists === "boolean"
            ? String(supabaseSessionExists)
            : "Unknown"
        }
        colors={colors}
      />
      <DebugRow
        label="RevenueCat app user ID"
        value={appUserId}
        colors={colors}
      />
      <DebugRow
        label="RevenueCat anonymous"
        value={
          typeof snapshot?.isAnonymous === "boolean"
            ? String(snapshot.isAnonymous)
            : "Unknown"
        }
        colors={colors}
      />
      <DebugRow
        label="RevenueCat original app user ID"
        value={originalAppUserId}
        colors={colors}
      />
      <DebugRow
        label="schedova_pro active"
        value={String(snapshot?.schedovaProActive ?? isPro)}
        colors={colors}
      />
      <DebugRow
        label="Last-known Pro recovery hint"
        value={String(lastKnownProForCurrentUser)}
        colors={colors}
      />
      <DebugRow
        label="Active entitlement IDs"
        value={formatDebugList(activeEntitlementIds)}
        colors={colors}
      />
      <DebugRow
        label="Entitlement details"
        value={
          entitlementDetails.length > 0
            ? JSON.stringify(entitlementDetails)
            : "None"
        }
        colors={colors}
      />
      <DebugRow
        label="Current offering ID"
        value={snapshot?.currentOfferingIdentifier ?? "Unknown"}
        colors={colors}
      />
      <DebugRow
        label="SDK key prefix"
        value={snapshot?.sdkKeyPrefix ?? "Unknown"}
        colors={colors}
      />
      <DebugRow
        label="Available package IDs"
        value={formatDebugList(packageIds)}
        colors={colors}
      />
      <DebugRow
        label="Product IDs"
        value={formatDebugList(productIds)}
        colors={colors}
      />
      <DebugRow
        label="Last customer info refresh"
        value={lastCustomerInfoRefreshAt ?? "Not refreshed yet"}
        colors={colors}
      />
      <DebugRow
        label="Last restore"
        value={lastRestoreAt ?? "No restore this session"}
        colors={colors}
      />
      <DebugRow
        label="Customer info fetch status"
        value={customerInfoFetchStatus}
        colors={colors}
      />
      <DebugRow label="Auth ready" value={String(authReady)} colors={colors} />
      <DebugRow
        label="Subscription loading"
        value={String(loading)}
        colors={colors}
      />
      <DebugRow
        label="Last subscription sync"
        value={lastSyncText}
        colors={colors}
      />
      <DebugRow
        label="Supabase user_subscriptions"
        value={supabaseSubscriptionText}
        colors={colors}
      />
      <DebugRow
        label="Last auth event"
        value={
          lastAuthEvent
            ? `${lastAuthEvent.event} | session=${lastAuthEvent.sessionExists} | user=${lastAuthEvent.userId ?? "null"} | source=${lastAuthEvent.source} | ${lastAuthEvent.at}`
            : "No auth event recorded"
        }
        colors={colors}
      />
      <DebugRow
        label="Last RevenueCat error"
        value={
          activeError
            ? `${activeError.readableErrorCode || activeError.code || "Unknown"}: ${
                activeError.message
              }${
                activeError.underlyingErrorMessage
                  ? ` (${activeError.underlyingErrorMessage})`
                  : ""
              }`
            : "None"
        }
        colors={colors}
      />

      <View
        style={{
          flexDirection: "row",
          flexWrap: "wrap",
          gap: 10,
          marginTop: 12,
        }}
      >
        <DebugActionButton
          title="Refresh Customer Info"
          disabled={actionDisabled}
          colors={colors}
          onPress={() => {
            void refreshDebugSnapshot();
          }}
        />
        <DebugActionButton
          title="Force RevenueCat Refresh"
          disabled={actionDisabled}
          colors={colors}
          onPress={() => {
            void forceRevenueCatRefresh().then(refreshDebugSnapshot);
          }}
        />
        <DebugActionButton
          title="Recover Pro for This User"
          disabled={actionDisabled}
          colors={colors}
          onPress={() => {
            void recoverProForCurrentUser().then(refreshDebugSnapshot);
          }}
        />
        <DebugActionButton
          title="Open Customer Center"
          disabled={actionDisabled}
          colors={colors}
          onPress={() => {
            void showCustomerCenter().then(refreshDebugSnapshot);
          }}
        />
        <DebugActionButton
          title="Restore Purchases"
          disabled={actionDisabled}
          colors={colors}
          onPress={() => {
            void restore().then(refreshDebugSnapshot);
          }}
        />
        <DebugActionButton
          title="Log Debug Info"
          disabled={actionDisabled}
          colors={colors}
          onPress={() => {
            console.log("[RevenueCat] Debug panel info:", debugInfoText);
            Alert.alert("RevenueCat debug", "Debug info logged to Metro.");
          }}
        />
        <DebugActionButton
          title="Show Debug Info"
          disabled={actionDisabled}
          colors={colors}
          onPress={() => {
            console.log("[RevenueCat] Debug panel info:", debugInfoText);
            setShowDebugInfoModal(true);
          }}
        />
        <DebugActionButton
          title="Try Copy Debug Info"
          disabled={actionDisabled}
          colors={colors}
          onPress={() => {
            void handleCopyDebugInfo();
          }}
        />
      </View>

      <Modal
        visible={showDebugInfoModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowDebugInfoModal(false)}
      >
        <Pressable
          onPress={() => setShowDebugInfoModal(false)}
          style={{
            flex: 1,
            backgroundColor: "rgba(0,0,0,0.62)",
            justifyContent: "center",
            padding: 18,
          }}
        >
          <Pressable
            onPress={(event) => event.stopPropagation()}
            style={{
              backgroundColor: colors.card,
              borderColor: colors.border,
              borderWidth: 1,
              borderRadius: 18,
              maxHeight: "82%",
              padding: 16,
            }}
          >
            <Text
              style={{
                color: colors.text,
                fontSize: 18,
                fontWeight: "900",
                marginBottom: 10,
              }}
            >
              RevenueCat Debug Info
            </Text>
            <Text
              style={{
                color: colors.mutedText,
                fontSize: 13,
                lineHeight: 18,
                marginBottom: 12,
              }}
            >
              Clipboard is unavailable in this installed build. Select this text
              or read it from Metro logs.
            </Text>
            <ScrollView
              style={{
                backgroundColor: colors.background,
                borderColor: colors.border,
                borderWidth: 1,
                borderRadius: 12,
                maxHeight: 360,
                padding: 12,
              }}
            >
              <Text
                selectable
                style={{
                  color: colors.text,
                  fontFamily: Platform.select({
                    ios: "Menlo",
                    android: "monospace",
                    default: undefined,
                  }),
                  fontSize: 12,
                  lineHeight: 17,
                }}
              >
                {debugInfoText}
              </Text>
            </ScrollView>
            <Pressable
              onPress={() => setShowDebugInfoModal(false)}
              style={{
                alignItems: "center",
                backgroundColor: PRO_PRIMARY_COLOR,
                borderRadius: 12,
                marginTop: 14,
                paddingVertical: 12,
              }}
            >
              <Text style={{ color: "#FFFFFF", fontWeight: "900" }}>Close</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

function SchedovaProEnabledScreen() {
  const { colors } = useAppTheme();
  const { subscription, userId: featureAccessUserId } = useFeatureAccess();
  const {
    authReady,
    customerInfo,
    isPro,
    loading,
    prefetchSubscriptionData,
    refresh,
    restore,
    showCustomerCenter,
    userId,
  } = useSubscription();
  const entitlement = getSchedovaProEntitlement(customerInfo);
  const hasLifetimeAccess = hasAdminLifetimeSchedovaProAccess(subscription);
  const proUiVisible = true;
  const proStatusLabel = hasLifetimeAccess
    ? "Lifetime access"
    : getSchedovaProFriendlyStatus(subscription);
  const renewalDate = formatDate(
    subscription?.entitlement_expires_at ||
      subscription?.current_period_end ||
      entitlement?.expirationDate,
  );
  const isCheckingSubscription = loading || !authReady;
  const [isOpeningPaywall, setIsOpeningPaywall] = useState(false);
  const [isPrefetchingSubscriptions, setIsPrefetchingSubscriptions] =
    useState(false);
  const [subscriptionPackageStatus, setSubscriptionPackageStatus] =
    useState<SubscriptionPackageStatus>("checking");
  const [subscriptionPackageSummaries, setSubscriptionPackageSummaries] =
    useState<SubscriptionPackageSummary[]>([]);
  const [showSubscriptionHelp, setShowSubscriptionHelp] = useState(false);
  const [purchaseStatusMessage, setPurchaseStatusMessage] = useState("");
  const [isRestoringPurchases, setIsRestoringPurchases] = useState(false);
  const subscriptionPrefetchedAtRef = useRef(0);

  useEffect(() => {
    let cancelled = false;

    void supabase.auth.getUser().then(({ data }) => {
      if (cancelled) return;

      console.log("[ProScreen] ENABLE_PRO", ENABLE_PRO);
      console.log(
        "[ProScreen] current user id",
        data.user?.id ?? userId ?? featureAccessUserId ?? null,
      );
      console.log("[ProScreen] current user email", data.user?.email ?? null);
      console.log("[ProScreen] subscription row", subscription);
      console.log("[ProScreen] adminLifetimeAccess", hasLifetimeAccess);
      console.log("[ProScreen] final isPro", isPro);
      console.log("[ProScreen] pro UI visible", proUiVisible);
    });

    return () => {
      cancelled = true;
    };
  }, [
    featureAccessUserId,
    hasLifetimeAccess,
    isPro,
    proUiVisible,
    subscription,
    userId,
  ]);

  useEffect(() => {
    if (isPro) {
      setPurchaseStatusMessage("");
      setSubscriptionPackageStatus("available");
    }
  }, [isPro]);

  async function refreshCustomerInfoForPurchase(source: string) {
    console.log("[RevenueCat] customer info refresh started", { source });

    try {
      const info = await withProPurchaseTimeout(
        "RevenueCat customer info refresh",
        refresh(),
        PRO_PURCHASE_REFRESH_TIMEOUT_MS,
      );
      const entitlementActive = hasProEntitlement(info);

      console.log("[RevenueCat] entitlement status", {
        source,
        customerInfoLoaded: Boolean(info),
        entitlement: REVENUECAT_ENTITLEMENT_ID,
        active: entitlementActive,
      });

      return { info, entitlementActive, delayed: false };
    } catch (error) {
      console.log("[RevenueCat] customer info refresh error", {
        source,
        error,
      });
      logRevenueCatError("Customer info refresh after purchase failed", error);

      return { info: null, entitlementActive: false, delayed: true };
    }
  }

  const prefetchRevenueCatData = useCallback(async () => {
    const now = Date.now();

    if (!authReady || !userId) {
      if (__DEV__) {
        console.log("[RevenueCat] Pro screen prefetch waiting for auth");
      }

      return;
    }

    if (
      now - subscriptionPrefetchedAtRef.current <
      SUBSCRIPTION_PREFETCH_FRESHNESS_MS
    ) {
      if (__DEV__) {
        console.log("[RevenueCat] Pro screen prefetch skipped; cache is fresh");
      }

      return;
    }

    if (__DEV__) {
      console.log("[RevenueCat] Pro screen prefetch started");
    }

    setIsPrefetchingSubscriptions(true);
    setSubscriptionPackageStatus("checking");

    try {
      const customerInfoStartedAt = Date.now();
      const info = await withProPurchaseTimeout(
        "RevenueCat prefetch customer info",
        prefetchSubscriptionData(),
        PRO_PURCHASE_PREFETCH_TIMEOUT_MS,
      ).catch((error) => {
        console.log("[RevenueCat] Pro screen customer info prefetch error", {
          error: getRevenueCatErrorDetails(error),
        });
        logRevenueCatError("Pro screen customer info prefetch failed", error);
        return null;
      });

      if (__DEV__) {
        console.log(
          "[RevenueCat] Customer info loaded in ms:",
          Date.now() - customerInfoStartedAt,
          {
            isPro: hasProEntitlement(info),
          },
        );
      }

      const offeringStartedAt = Date.now();
      const offering = await withProPurchaseTimeout(
        "RevenueCat prefetch offerings",
        prefetchRevenueCatOfferings(),
        PRO_PURCHASE_PREFETCH_TIMEOUT_MS,
      );

      if (__DEV__) {
        console.log(
          "[RevenueCat] Offering loaded in ms:",
          Date.now() - offeringStartedAt,
          {
            offeringId: offering?.identifier ?? null,
            packagesCount: offering?.availablePackages?.length ?? 0,
            packageProductIds:
              offering?.availablePackages?.map(
                (pkg) => pkg.product.identifier,
              ) ?? [],
          },
        );
      }

      const packageSummaries = sortSubscriptionPackages(
        (offering?.availablePackages ?? []).map(summarizeSubscriptionPackage),
      );

      console.log("[RevenueCat] Pro screen packages available", {
        offeringId: offering?.identifier ?? null,
        packageIdentifiers: packageSummaries.map(
          (pkg) => pkg.packageIdentifier,
        ),
        productIdentifiers: packageSummaries.map(
          (pkg) => pkg.productIdentifier,
        ),
      });

      setSubscriptionPackageSummaries(packageSummaries);

      if (packageSummaries.length) {
        setSubscriptionPackageStatus("available");
        setPurchaseStatusMessage("");
      } else {
        console.log("[RevenueCat] Offerings/packages unavailable", {
          source: "pro_screen_prefetch",
          reason: offering ? "packages_empty" : "no_offering",
          offeringId: offering?.identifier ?? null,
          packagesCount: offering?.availablePackages?.length ?? 0,
        });
        setSubscriptionPackageSummaries([]);
        setSubscriptionPackageStatus("unavailable");
        setPurchaseStatusMessage("");
      }

      subscriptionPrefetchedAtRef.current = Date.now();
    } catch (error) {
      console.log("[RevenueCat] Offerings/packages unavailable", {
        source: "pro_screen_prefetch",
        reason: "offerings_fetch_failed",
        error: getRevenueCatErrorDetails(error),
      });
      logRevenueCatError("Pro screen prefetch failed", error);
      setSubscriptionPackageSummaries([]);
      setSubscriptionPackageStatus("unavailable");
      setPurchaseStatusMessage("");
      subscriptionPrefetchedAtRef.current = Date.now();
    } finally {
      setIsPrefetchingSubscriptions(false);
    }
  }, [authReady, prefetchSubscriptionData, userId]);

  useFocusEffect(
    useCallback(() => {
      void prefetchRevenueCatData();
    }, [prefetchRevenueCatData]),
  );

  async function handleUpgrade() {
    if (
      isOpeningPaywall ||
      isCheckingSubscription ||
      isPrefetchingSubscriptions
    ) {
      return false;
    }

    if (isPro) {
      setIsOpeningPaywall(true);
      try {
        await showCustomerCenter();
        return true;
      } finally {
        setIsOpeningPaywall(false);
      }
    }

    console.log("[RevenueCat] purchase UI dormant; showing Pro preview only", {
      entitlement: REVENUECAT_ENTITLEMENT_ID,
      subscriptionPackageStatus,
      offeringsMayLoad: subscriptionPackageSummaries.length > 0,
    });
    setPurchaseStatusMessage(PRO_PREVIEW_LOCKED_MESSAGE);
    return false;
  }

  async function handleRestore() {
    if (isRestoringPurchases) return;

    console.log("[RevenueCat] restore start", {
      source: "pro_screen",
      userId,
    });

    setIsRestoringPurchases(true);

    try {
      const restored = await restore();
      const { entitlementActive: restoredIsPro } =
        await refreshCustomerInfoForPurchase("restore");

      console.log("[RevenueCat] restore success", {
        source: "pro_screen",
        restored,
        entitlement: REVENUECAT_ENTITLEMENT_ID,
        active: restoredIsPro,
      });

      if (restored || restoredIsPro) {
        setPurchaseStatusMessage(
          restoredIsPro ? "" : PRO_PURCHASE_DELAYED_MESSAGE,
        );
      }
    } catch (error) {
      console.log("[RevenueCat] restore failure", {
        source: "pro_screen",
        error: getRevenueCatErrorDetails(error),
      });
      Alert.alert(
        "Restore failed",
        "Purchases could not be restored. Please try again.",
      );
    } finally {
      setIsRestoringPurchases(false);
    }
  }

  async function handleOpenCustomerCenterFromHelp() {
    try {
      await showCustomerCenter();
      setShowSubscriptionHelp(false);
    } catch {
      Alert.alert(
        "Subscription help",
        "Unable to open subscription help. Please try again.",
      );
    }
  }

  const primaryButtonStyle = {
    backgroundColor: PRO_PRIMARY_COLOR,
    borderRadius: 16,
    paddingVertical: 17,
    paddingHorizontal: 18,
    alignItems: "center" as const,
    marginBottom: 12,
  };
  const secondaryButtonStyle = {
    borderWidth: 1,
    borderColor: PRO_SECONDARY_BORDER,
    backgroundColor: PRO_SECONDARY_COLOR,
    borderRadius: 16,
    paddingVertical: 16,
    paddingHorizontal: 18,
    alignItems: "center" as const,
    marginBottom: 12,
  };
  const subscriptionsUnavailable =
    !isPro && subscriptionPackageStatus === "unavailable";
  const subscriptionPackagesChecking =
    !isPro && subscriptionPackageStatus === "checking";
  const upgradeDisabled =
    !isPro ||
    isCheckingSubscription ||
    isOpeningPaywall ||
    isPrefetchingSubscriptions ||
    subscriptionsUnavailable ||
    subscriptionPackagesChecking;
  const upgradeButtonLabel = isOpeningPaywall
    ? "Opening..."
    : isCheckingSubscription
      ? "Checking subscription status..."
      : "Schedova Pro coming soon";

  return (
    <AppScreen
      scroll
      backgroundColor={colors.background}
      bottomPadding={56}
      contentContainerStyle={{ gap: 16 }}
    >
      <Pressable
        onPress={() => router.back()}
        style={{
          alignSelf: "flex-start",
          paddingVertical: 6,
          paddingRight: 12,
        }}
      >
        <Text style={{ color: colors.mutedText, fontWeight: "900" }}>Back</Text>
      </Pressable>

      <View
        style={{
          backgroundColor: colors.card,
          borderColor: colors.border,
          borderWidth: 1,
          borderRadius: 18,
          padding: 20,
        }}
      >
        <View
          style={{
            alignItems: "flex-start",
            flexDirection: "row",
            justifyContent: "space-between",
            gap: 14,
          }}
        >
          <View style={{ flex: 1 }}>
            <Text
              style={{
                color: colors.text,
                fontSize: 34,
                fontWeight: "900",
                lineHeight: 40,
              }}
            >
              Schedova Pro
            </Text>
            <Text
              style={{
                color: colors.mutedText,
                fontSize: 16,
                lineHeight: 23,
                marginTop: 10,
              }}
            >
              Unlock advanced tools for your booking business.
            </Text>
          </View>

          <View
            style={{
              backgroundColor: isPro ? colors.primary : colors.background,
              borderColor: isPro ? colors.primary : colors.border,
              borderWidth: 1,
              borderRadius: 999,
              paddingHorizontal: 12,
              paddingVertical: 7,
            }}
          >
            <Text
              style={{
                color: isPro ? "#FFFFFF" : colors.text,
                fontSize: 12,
                fontWeight: "900",
              }}
            >
              {isCheckingSubscription
                ? "Checking..."
                : isPro
                  ? hasLifetimeAccess
                    ? "Lifetime"
                    : "Active"
                  : "Free plan"}
            </Text>
          </View>
        </View>

        <View
          style={{
            backgroundColor: colors.background,
            borderColor: colors.border,
            borderWidth: 1,
            borderRadius: 14,
            marginTop: 18,
            padding: 14,
          }}
        >
          <Text style={{ color: colors.text, fontSize: 16, fontWeight: "900" }}>
              {isPro
                ? hasLifetimeAccess
                  ? "You have lifetime access to Schedova Pro features."
                  : "You have access to Schedova Pro features."
                : isCheckingSubscription
                  ? "Checking your subscription status..."
                  : PRO_PREVIEW_LOCKED_MESSAGE}
          </Text>

          {isPro && hasLifetimeAccess ? (
            <Text
              style={{
                color: colors.mutedText,
                fontSize: 13,
                lineHeight: 19,
                marginTop: 8,
              }}
            >
              {proStatusLabel}
            </Text>
          ) : null}

          {isPro && !hasLifetimeAccess && renewalDate ? (
            <Text
              style={{
                color: colors.mutedText,
                fontSize: 13,
                lineHeight: 19,
                marginTop: 8,
              }}
            >
              Subscription renews or expires on {renewalDate}.
            </Text>
          ) : null}
        </View>
      </View>

      {REVENUECAT_DIAGNOSTICS_ENABLED ? (
        <RevenueCatDebugPanel colors={colors} />
      ) : null}

      <View
        style={{
          backgroundColor: colors.card,
          borderColor: colors.border,
          borderWidth: 1,
          borderRadius: 18,
          padding: 18,
        }}
      >
        <Text
          style={{
            color: colors.text,
            fontSize: 20,
            fontWeight: "900",
            marginBottom: 10,
          }}
        >
          Included with Pro
        </Text>

        {PRO_FEATURES.map((feature, index) => (
          <View
            key={feature.title}
            style={{
              flexDirection: "row",
              alignItems: "flex-start",
              gap: 12,
              paddingVertical: 13,
              borderTopWidth: index === 0 ? 0 : 1,
              borderTopColor: colors.border,
            }}
          >
            <View
              style={{
                width: 34,
                height: 34,
                borderRadius: 17,
                alignItems: "center",
                justifyContent: "center",
                backgroundColor: isPro ? colors.primary : colors.background,
                borderWidth: isPro ? 0 : 1,
                borderColor: colors.border,
              }}
            >
              <Ionicons
                name={isPro ? "checkmark" : feature.icon}
                size={18}
                color={isPro ? "#FFFFFF" : colors.primary}
              />
            </View>

            <View style={{ flex: 1 }}>
              <Text
                style={{
                  color: colors.text,
                  fontSize: 16,
                  fontWeight: "900",
                  lineHeight: 21,
                }}
              >
                {feature.title}
              </Text>
              <Text
                style={{
                  color: colors.mutedText,
                  fontSize: 13,
                  lineHeight: 19,
                  marginTop: 3,
                }}
              >
                {feature.description}
              </Text>
            </View>
          </View>
        ))}
      </View>

      {!isPro ? (
        <View
          style={{
            backgroundColor: colors.card,
            borderColor: colors.border,
            borderWidth: 1,
            borderRadius: 18,
            padding: 18,
          }}
        >
          <Text
            style={{
              color: colors.text,
              fontSize: 20,
              fontWeight: "900",
              marginBottom: 10,
            }}
          >
            Pro Preview
          </Text>

          <Text style={{ color: colors.mutedText, lineHeight: 20 }}>
            {PRO_PREVIEW_LOCKED_MESSAGE}
          </Text>

          {REVENUECAT_DIAGNOSTICS_ENABLED &&
          !subscriptionPackagesChecking &&
          !isPrefetchingSubscriptions &&
          subscriptionPackageSummaries.length > 0 ? (
            <Text
              style={{
                color: colors.mutedText,
                fontSize: 12,
                lineHeight: 18,
                marginTop: 12,
              }}
            >
              RevenueCat products loaded for diagnostics, but purchase UI is
              hidden while Pro is dormant.
            </Text>
          ) : null}
        </View>
      ) : null}

      <View>
        {isPro ? (
          <>
            <Text
              style={{
                color: colors.mutedText,
                fontSize: 13,
                lineHeight: 19,
                marginBottom: 12,
                textAlign: "center",
              }}
            >
              {hasLifetimeAccess
                ? "Lifetime access is active on this Schedova account."
                : "Manage, cancel, or restore your subscription through the store account used to purchase Schedova Pro."}
            </Text>

            {!hasLifetimeAccess ? (
              <Pressable
                onPress={() => void showCustomerCenter()}
                style={primaryButtonStyle}
              >
                <Text
                  style={{ color: "#FFFFFF", fontSize: 16, fontWeight: "900" }}
                >
                  Manage Subscription
                </Text>
              </Pressable>
            ) : null}

            {!hasLifetimeAccess ? (
              <>
                <Pressable
                  disabled={isRestoringPurchases}
                  onPress={() => void handleRestore()}
                  style={[
                    secondaryButtonStyle,
                    isRestoringPurchases ? { opacity: 0.65 } : null,
                  ]}
                >
                  <Text
                    style={{ color: "#FFFFFF", fontSize: 16, fontWeight: "900" }}
                  >
                    {isRestoringPurchases ? "Restoring..." : "Restore Purchases"}
                  </Text>
                </Pressable>

                <Pressable
                  onPress={() => setShowSubscriptionHelp(true)}
                  style={secondaryButtonStyle}
                >
                  <Text
                    style={{
                      color: "#FFFFFF",
                      fontSize: 16,
                      fontWeight: "900",
                    }}
                  >
                    Cancel or Refund Help
                  </Text>
                </Pressable>
              </>
            ) : null}
          </>
        ) : (
          <>
            <Pressable
              disabled={upgradeDisabled}
              onPress={() => void handleUpgrade()}
              style={[
                primaryButtonStyle,
                upgradeDisabled ? { opacity: 0.7 } : null,
              ]}
            >
              <Text
                style={{ color: "#FFFFFF", fontSize: 16, fontWeight: "900" }}
              >
                {upgradeButtonLabel}
              </Text>
            </Pressable>

            {isPrefetchingSubscriptions ? (
              <Text
                style={{
                  color: colors.mutedText,
                  fontSize: 13,
                  lineHeight: 18,
                  marginTop: -4,
                  marginBottom: 12,
                  textAlign: "center",
                }}
              >
                Loading subscription options...
              </Text>
            ) : null}

            {purchaseStatusMessage ? (
              <Text
                style={{
                  color: colors.mutedText,
                  fontSize: 13,
                  lineHeight: 18,
                  marginTop: -4,
                  marginBottom: 12,
                  textAlign: "center",
                }}
              >
                {purchaseStatusMessage}
              </Text>
            ) : null}

            <Pressable
              disabled={isRestoringPurchases}
              onPress={() => void handleRestore()}
              style={[
                secondaryButtonStyle,
                isRestoringPurchases ? { opacity: 0.65 } : null,
              ]}
            >
              <Text
                style={{ color: "#FFFFFF", fontSize: 16, fontWeight: "900" }}
              >
                {isRestoringPurchases ? "Restoring..." : "Restore Purchases"}
              </Text>
            </Pressable>

            <Pressable
              onPress={() => setShowSubscriptionHelp(true)}
              style={secondaryButtonStyle}
            >
              <Text
                style={{
                  color: "#FFFFFF",
                  fontSize: 16,
                  fontWeight: "900",
                }}
              >
                Subscription Help
              </Text>
            </Pressable>
          </>
        )}
      </View>

      <SubscriptionHelpModal
        visible={showSubscriptionHelp}
        colors={colors}
        onClose={() => setShowSubscriptionHelp(false)}
        onOpenCustomerCenter={() => {
          void handleOpenCustomerCenterFromHelp();
        }}
      />

      <View
        style={{
          flexDirection: "row",
          justifyContent: "center",
          flexWrap: "wrap",
          gap: 14,
          paddingTop: 4,
        }}
      >
        <Pressable onPress={() => void openUrl(PRIVACY_POLICY_URL)}>
          <Text style={{ color: colors.mutedText, fontSize: 13 }}>
            Privacy Policy
          </Text>
        </Pressable>
        <Text style={{ color: colors.border, fontSize: 13 }}>|</Text>
        <Pressable onPress={() => void openUrl(TERMS_OF_USE_URL)}>
          <Text style={{ color: colors.mutedText, fontSize: 13 }}>
            Terms of Use
          </Text>
        </Pressable>
      </View>
    </AppScreen>
  );
}

export default function SchedovaProScreen() {
  return <SchedovaProEnabledScreen />;
}
