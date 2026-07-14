import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  ScrollView,
  Text,
  View,
} from "react-native";
import {
  AppButton,
  AppCard,
  AppScreen,
  AppTextInput,
  EmptyState,
  ScreenHeader,
} from "../components/ui";
import { normalizeClientTag } from "../lib/clientTags";
import {
  canUseFeature,
  FREE_TIER_LIMITS,
  useFeatureAccess,
} from "../lib/featureAccess";
import { useAuthSession } from "../lib/authSession";
import { sendConsentRequests } from "../lib/communicationRecipients";
import { PRO_UPSELL_COPY, showProUpgradePrompt } from "../lib/proUpsell";
import { supabase } from "../lib/supabase";
import { useAppTheme } from "../lib/useAppTheme";

type ConsentSource =
  | "In person"
  | "Written form"
  | "Online booking"
  | "Existing customer request"
  | "Other";

type BulkSummary = {
  updated: number;
  requestsSent: number;
  missingPhone: number;
  missingEmail: number;
  alreadyOptedIn: number;
  failed: number;
};

type RemoveClientsSummary = {
  removed: number;
  failed: number;
};

const CONSENT_SOURCES: ConsentSource[] = [
  "In person",
  "Written form",
  "Online booking",
  "Existing customer request",
  "Other",
];

function emptySummary(): BulkSummary {
  return {
    updated: 0,
    requestsSent: 0,
    missingPhone: 0,
    missingEmail: 0,
    alreadyOptedIn: 0,
    failed: 0,
  };
}

function cleanContact(value?: string | null) {
  return String(value || "").trim();
}

function formatSummary(summary: BulkSummary) {
  return [
    `Successfully updated: ${summary.updated}`,
    `Requests sent: ${summary.requestsSent}`,
    `Missing phone numbers: ${summary.missingPhone}`,
    `Missing email addresses: ${summary.missingEmail}`,
    `Already opted in: ${summary.alreadyOptedIn}`,
    `Failed: ${summary.failed}`,
  ].join("\n");
}

export default function ClientsScreen() {
  const router = useRouter();
  const { colors, themeName } = useAppTheme();
  const { isHydrated, userId } = useAuthSession();
  useFeatureAccess();
  const [clients, setClients] = useState<any[]>([]);
  const [loadingClients, setLoadingClients] = useState(true);
  const [searchText, setSearchText] = useState("");
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedClientIds, setSelectedClientIds] = useState<string[]>([]);
  const [bulkWorking, setBulkWorking] = useState(false);
  const [manualConsentVisible, setManualConsentVisible] = useState(false);
  const [manualSmsConsent, setManualSmsConsent] = useState(true);
  const [manualEmailConsent, setManualEmailConsent] = useState(false);
  const [manualConsentSource, setManualConsentSource] =
    useState<ConsentSource>("In person");
  const [manualConfirmed, setManualConfirmed] = useState(false);
  const isDarkTheme = themeName === "dark" || themeName === "black";
  const infoAccent = isDarkTheme ? "#60A5FA" : "#2563EB";
  const infoAccentSoft = isDarkTheme
    ? "rgba(96, 165, 250, 0.16)"
    : "rgba(37, 99, 235, 0.10)";
  const infoAccentBorder = isDarkTheme
    ? "rgba(96, 165, 250, 0.32)"
    : "rgba(37, 99, 235, 0.24)";
  const greenAccentSoft = isDarkTheme
    ? "rgba(15, 118, 110, 0.28)"
    : "rgba(15, 118, 110, 0.12)";
  const polishedBorder = isDarkTheme
    ? "rgba(148, 163, 184, 0.28)"
    : "rgba(15, 23, 42, 0.12)";

  useFocusEffect(
    useCallback(() => {
      let isActive = true;

      async function fetchClients() {
        if (!isActive) return;

        if (!isHydrated) {
          setLoadingClients(true);
          return;
        }

        setLoadingClients(true);

        if (!userId) {
          setClients([]);
          setLoadingClients(false);
          return;
        }

        const { data, error } = await supabase
          .from("clients")
          .select("*")
          .eq("user_id", userId)
          .is("archived_at", null)
          .order("name");

        if (!isActive) return;

        if (error) {
          Alert.alert("Error", error.message);
          setLoadingClients(false);
          return;
        }

        setClients((data || []).filter(Boolean));
        setLoadingClients(false);
      }

      void fetchClients();

      return () => {
        isActive = false;
      };
    }, [isHydrated, userId]),
  );

  const filteredClients = clients.filter((client) => {
    if (!client?.id) return false;

    const search = searchText.toLowerCase();

    const clientName = String(client.name || "").toLowerCase();
    const clientPhone = String(client.phone || "").toLowerCase();
    const clientEmail = String(client.email || "").toLowerCase();

    return (
      clientName.includes(search) ||
      clientPhone.includes(search) ||
      clientEmail.includes(search)
    );
  });
  const selectedClientIdSet = new Set(selectedClientIds);
  const selectedClients = clients.filter((client) =>
    selectedClientIdSet.has(String(client.id)),
  );
  const visibleSelectableIds = filteredClients
    .map((client) => String(client.id || "").trim())
    .filter(Boolean);
  const allVisibleSelected =
    visibleSelectableIds.length > 0 &&
    visibleSelectableIds.every((id) => selectedClientIdSet.has(id));

  const canAddMoreClients =
    canUseFeature("moreClients") || clients.length < FREE_TIER_LIMITS.clients;

  async function openAddClient() {
    if (!canAddMoreClients) {
      showProUpgradePrompt(PRO_UPSELL_COPY.freeLimit);
      return;
    }

    router.push("/add-client" as any);
  }

  function toggleSelectionMode() {
    setSelectionMode((current) => {
      if (current) setSelectedClientIds([]);
      return !current;
    });
  }

  function toggleClientSelected(clientId: string) {
    setSelectedClientIds((current) =>
      current.includes(clientId)
        ? current.filter((id) => id !== clientId)
        : [...current, clientId],
    );
  }

  function selectAllVisible() {
    setSelectedClientIds((current) => {
      if (allVisibleSelected) {
        return current.filter((id) => !visibleSelectableIds.includes(id));
      }

      return Array.from(new Set([...current, ...visibleSelectableIds]));
    });
  }

  function clearSelection() {
    setSelectedClientIds([]);
  }

  function showBulkSummary(title: string, summary: BulkSummary) {
    Alert.alert(title, formatSummary(summary));
  }

  function showRemoveClientsSummary(summary: RemoveClientsSummary) {
    if (summary.failed > 0) {
      Alert.alert(
        "Clients removed",
        `${summary.removed} client${summary.removed === 1 ? "" : "s"} removed.\n${summary.failed} failed and remain in the active client list.`,
      );
      return;
    }

    Alert.alert(
      "Clients removed",
      `${summary.removed} client${summary.removed === 1 ? "" : "s"} removed`,
    );
  }

  function getConsentBadges(client: any) {
    const hasPhone = Boolean(cleanContact(client.phone));
    const hasEmail = Boolean(cleanContact(client.email));
    const smsOn = Boolean(client.sms_opt_in);
    const emailOn = Boolean(client.email_opt_in);
    const badges: { label: string; tone: "good" | "neutral" | "warn" }[] = [];

    if (smsOn && emailOn) badges.push({ label: "SMS + Email", tone: "good" });
    else if (smsOn) badges.push({ label: "SMS On", tone: "good" });
    else if (emailOn) badges.push({ label: "Email On", tone: "good" });
    else badges.push({ label: "No Consent", tone: "neutral" });

    if (!hasPhone) badges.push({ label: "Missing Phone", tone: "warn" });
    if (!hasEmail) badges.push({ label: "Missing Email", tone: "warn" });

    return badges;
  }

  async function refreshClients() {
    if (!userId) return;

    const { data, error } = await supabase
      .from("clients")
      .select("*")
      .eq("user_id", userId)
      .is("archived_at", null)
      .order("name");

    if (error) throw error;
    setClients((data || []).filter(Boolean));
  }

  async function sendBulkConsentRequests(mode: "sms" | "email" | "both") {
    if (selectedClients.length === 0 || bulkWorking) return;

    const wantsSms = mode === "sms" || mode === "both";
    const wantsEmail = mode === "email" || mode === "both";

    if (wantsEmail && !canUseFeature("emailMessaging")) {
      showProUpgradePrompt(PRO_UPSELL_COPY.emailMessaging);
      return;
    }

    setBulkWorking(true);
    const summary = emptySummary();
    const seenPhones = new Set<string>();
    const seenEmails = new Set<string>();

    try {
      for (const client of selectedClients) {
        const clientId = String(client.id || "").trim();
        const phone = cleanContact(client.phone);
        const email = cleanContact(client.email).toLowerCase();
        let requestSms = false;
        let requestEmail = false;

        if (wantsSms) {
          if (!phone) summary.missingPhone += 1;
          else if (client.sms_opt_in) summary.alreadyOptedIn += 1;
          else if (seenPhones.has(phone)) summary.alreadyOptedIn += 1;
          else {
            seenPhones.add(phone);
            requestSms = true;
          }
        }

        if (wantsEmail) {
          if (!email) summary.missingEmail += 1;
          else if (client.email_opt_in) summary.alreadyOptedIn += 1;
          else if (seenEmails.has(email)) summary.alreadyOptedIn += 1;
          else {
            seenEmails.add(email);
            requestEmail = true;
          }
        }

        if (!clientId || (!requestSms && !requestEmail)) continue;

        try {
          const result = await sendConsentRequests({
            clientId,
            recipients: [
              {
                name: cleanContact(client.name) || "Client",
                relationship: "",
                phone,
                email,
                smsEnabled: requestSms,
                emailEnabled: requestEmail,
                isPrimary: true,
              },
            ],
          });

          if (result?.ok) {
            summary.requestsSent += Number(result.sent || 0) || 1;
            summary.failed += Array.isArray(result.failures)
              ? result.failures.length
              : 0;
          } else {
            summary.failed += 1;
          }
        } catch (error) {
          console.log("Bulk consent request failed", error);
          summary.failed += 1;
        }
      }

      showBulkSummary("Consent request summary", summary);
    } finally {
      setBulkWorking(false);
    }
  }

  async function applyManualConsent() {
    if (!userId || selectedClients.length === 0 || bulkWorking) return;

    if (!manualSmsConsent && !manualEmailConsent) {
      Alert.alert("Choose consent type", "Select SMS, Email, or both.");
      return;
    }

    if (!manualConfirmed) {
      Alert.alert(
        "Confirmation required",
        "Confirm these clients agreed before marking consent received.",
      );
      return;
    }

    setBulkWorking(true);
    const now = new Date().toISOString();
    const summary = emptySummary();

    try {
      for (const client of selectedClients) {
        const clientId = String(client.id || "").trim();
        if (!clientId) {
          summary.failed += 1;
          continue;
        }

        const patch: Record<string, unknown> = {};
        if (manualSmsConsent) {
          if (!cleanContact(client.phone)) summary.missingPhone += 1;
          if (client.sms_opt_in) summary.alreadyOptedIn += 1;
          patch.sms_opt_in = true;
          patch.sms_opt_in_at = client.sms_opt_in_at || now;
          patch.sms_opt_in_source = manualConsentSource;
        }

        if (manualEmailConsent) {
          if (!cleanContact(client.email)) summary.missingEmail += 1;
          if (client.email_opt_in) summary.alreadyOptedIn += 1;
          patch.email_opt_in = true;
          patch.email_opt_in_at = client.email_opt_in_at || now;
          patch.email_opt_in_source = manualConsentSource;
        }

        const { error } = await supabase
          .from("clients")
          .update(patch)
          .eq("id", clientId)
          .eq("user_id", userId);

        if (error) summary.failed += 1;
        else summary.updated += 1;
      }

      await refreshClients();
      setManualConsentVisible(false);
      setManualConfirmed(false);
      showBulkSummary("Consent update summary", summary);
    } catch (error) {
      console.log("Manual consent update failed", error);
      Alert.alert("Consent update failed", "Please try again.");
    } finally {
      setBulkWorking(false);
    }
  }

  async function removeConsent(kind: "sms" | "email") {
    if (!userId || selectedClients.length === 0 || bulkWorking) return;

    Alert.alert(
      kind === "sms" ? "Remove SMS consent?" : "Remove email consent?",
      `This will immediately stop future automatic ${kind === "sms" ? "text" : "email"} messages for the selected clients.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Remove",
          style: "destructive",
          onPress: async () => {
            setBulkWorking(true);
            const summary = emptySummary();

            try {
              for (const client of selectedClients) {
                const clientId = String(client.id || "").trim();
                if (!clientId) {
                  summary.failed += 1;
                  continue;
                }

                const patch =
                  kind === "sms"
                    ? {
                        sms_opt_in: false,
                        sms_opt_in_at: null,
                        sms_opt_in_source: null,
                        sms_opt_out_at: new Date().toISOString(),
                      }
                    : {
                        email_opt_in: false,
                        email_opt_in_at: null,
                        email_opt_in_source: null,
                      };

                const { error } = await supabase
                  .from("clients")
                  .update(patch)
                  .eq("id", clientId)
                  .eq("user_id", userId);

                if (error) summary.failed += 1;
                else summary.updated += 1;
              }

              await refreshClients();
              showBulkSummary("Consent removal summary", summary);
            } catch (error) {
              console.log("Bulk consent removal failed", error);
              Alert.alert("Consent removal failed", "Please try again.");
            } finally {
              setBulkWorking(false);
            }
          },
        },
      ],
    );
  }

  async function removeSelectedClients() {
    if (!userId || selectedClients.length === 0 || bulkWorking) return;

    const selectedCount = selectedClients.length;

    Alert.alert(
      "Remove selected clients?",
      `This will remove ${selectedCount} selected clients from the active client list. Existing appointments and history should remain available.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Remove Clients",
          style: "destructive",
          onPress: async () => {
            setBulkWorking(true);
            const archivedAt = new Date().toISOString();
            const removedIds: string[] = [];
            let failed = 0;

            try {
              for (const client of selectedClients) {
                const clientId = String(client.id || "").trim();

                if (!clientId) {
                  failed += 1;
                  continue;
                }

                const { data, error } = await supabase
                  .from("clients")
                  .update({ archived_at: archivedAt })
                  .eq("id", clientId)
                  .eq("user_id", userId)
                  .is("archived_at", null)
                  .select("id")
                  .maybeSingle();

                if (error || !data?.id) {
                  console.log("Bulk client archive failed", {
                    clientId,
                    message: error?.message || "No matching client row updated",
                  });
                  failed += 1;
                } else {
                  removedIds.push(clientId);
                }
              }

              const removedIdSet = new Set(removedIds);
              setClients((current) =>
                current.filter((client) => !removedIdSet.has(String(client.id))),
              );
              setSelectedClientIds([]);
              setSelectionMode(false);
              showRemoveClientsSummary({
                removed: removedIds.length,
                failed,
              });
            } catch (error) {
              console.log("Bulk client archive failed", error);
              Alert.alert(
                "Remove clients failed",
                "Selected clients could not be removed. Please try again.",
              );
            } finally {
              setBulkWorking(false);
            }
          },
        },
      ],
    );
  }

  return (
    <AppScreen scroll backgroundColor={colors.background} bottomPadding={64}>
      <ScreenHeader
        title="Clients"
        subtitle="Keep client details and appointment history organized."
        rightAction={
          <AppButton
            title={selectionMode ? "Done" : "Select"}
            variant="secondary"
            fullWidth={false}
            onPress={toggleSelectionMode}
            style={{ minHeight: 40, paddingHorizontal: 14 }}
            textStyle={{ fontSize: 14 }}
          />
        }
      />

      <AppButton
        title="Add Client"
        onPress={() => {
          void openAddClient();
        }}
        style={{ marginBottom: 14 }}
      />

      {!canUseFeature("moreClients") ? (
        <AppCard
          variant="subtle"
          style={{
            borderColor: infoAccentBorder,
            borderLeftColor: infoAccent,
            borderLeftWidth: 4,
            borderWidth: 1,
            marginBottom: 14,
          }}
        >
          <Text style={{ color: colors.mutedText, fontWeight: "700" }}>
            Free plan: {loadingClients ? "..." : clients.length}/
            {FREE_TIER_LIMITS.clients} clients
          </Text>
        </AppCard>
      ) : null}

      <AppTextInput
        value={searchText}
        onChangeText={setSearchText}
        placeholder="Search clients"
        autoCapitalize="none"
        containerStyle={{ marginBottom: 20 }}
      />

      {selectionMode ? (
        <AppCard
          variant="subtle"
          style={{
            borderColor: infoAccentBorder,
            borderWidth: 1,
            marginBottom: 14,
          }}
        >
          <Text style={{ color: colors.text, fontWeight: "900", marginBottom: 10 }}>
            {selectedClientIds.length} selected
          </Text>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
            <AppButton
              title={allVisibleSelected ? "Unselect Visible" : "Select All Visible"}
              variant="secondary"
              fullWidth={false}
              onPress={selectAllVisible}
              style={{ flexGrow: 1, minHeight: 44 }}
              textStyle={{ fontSize: 13 }}
            />
            <AppButton
              title="Clear Selection"
              variant="ghost"
              fullWidth={false}
              onPress={clearSelection}
              style={{ flexGrow: 1, minHeight: 44 }}
              textStyle={{ fontSize: 13 }}
            />
          </View>
        </AppCard>
      ) : null}

      {selectionMode ? (
        <AppCard
          style={{
            borderColor: polishedBorder,
            borderLeftColor: infoAccent,
            borderLeftWidth: 4,
            borderWidth: 1,
            marginBottom: 14,
          }}
        >
          <Text style={{ color: colors.text, fontSize: 18, fontWeight: "900" }}>
            Bulk consent actions
          </Text>
          <Text style={{ color: colors.mutedText, lineHeight: 20, marginTop: 6 }}>
            Send confirmation links or update consent after permission was received.
          </Text>
          <View style={{ gap: 10, marginTop: 14 }}>
            <AppButton
              title="Send SMS Opt-In Request"
              variant="secondary"
              loading={bulkWorking}
              disabled={bulkWorking}
              onPress={() => {
                void sendBulkConsentRequests("sms");
              }}
            />
            <AppButton
              title="Send Email Opt-In Request"
              variant="secondary"
              loading={bulkWorking}
              disabled={bulkWorking}
              onPress={() => {
                void sendBulkConsentRequests("email");
              }}
            />
            <AppButton
              title="Send Both Opt-In Requests"
              variant="secondary"
              loading={bulkWorking}
              disabled={bulkWorking}
              onPress={() => {
                void sendBulkConsentRequests("both");
              }}
            />
            <AppButton
              title="Mark Consent Received"
              loading={bulkWorking}
              disabled={bulkWorking}
              onPress={() => setManualConsentVisible(true)}
            />
            <View style={{ flexDirection: "row", gap: 10, flexWrap: "wrap" }}>
              <AppButton
                title="Remove SMS Consent"
                variant="destructive"
                fullWidth={false}
                disabled={bulkWorking}
                onPress={() => {
                  void removeConsent("sms");
                }}
                style={{ flexGrow: 1, flexBasis: 150 }}
                textStyle={{ fontSize: 13 }}
              />
              <AppButton
                title="Remove Email Consent"
                variant="destructive"
                fullWidth={false}
                disabled={bulkWorking}
                onPress={() => {
                  void removeConsent("email");
                }}
                style={{ flexGrow: 1, flexBasis: 150 }}
                textStyle={{ fontSize: 13 }}
              />
            </View>
            <AppButton
              title="Remove Selected Clients"
              variant="destructive"
              loading={bulkWorking}
              disabled={bulkWorking || selectedClientIds.length === 0}
              onPress={() => {
                void removeSelectedClients();
              }}
            />
            <AppButton
              title="Clear Selection"
              variant="ghost"
              disabled={bulkWorking}
              onPress={clearSelection}
            />
          </View>
        </AppCard>
      ) : null}

      {loadingClients ? (
        <View
          style={{
            alignItems: "center",
            paddingVertical: 28,
          }}
        >
          <ActivityIndicator color={colors.primary} />
          <Text style={{ color: colors.mutedText, marginTop: 10 }}>
            Loading clients...
          </Text>
        </View>
      ) : filteredClients.length === 0 ? (
        <EmptyState
          title={clients.length === 0 ? "No clients yet" : "No clients found"}
          message={
            clients.length === 0
              ? "Add your first client to start booking appointments faster."
              : "Try a different name, phone, or email."
          }
          actionLabel={clients.length === 0 ? "Add Client" : undefined}
          onAction={
            clients.length === 0
              ? () => {
                  void openAddClient();
                }
              : undefined
          }
          style={{ marginBottom: 16 }}
        />
      ) : null}

      {filteredClients.map((client) => {
        const tag = normalizeClientTag(client.client_tag);
        const clientId = String(client.id || "");
        const selected = selectedClientIdSet.has(clientId);
        const consentBadges = getConsentBadges(client);

        return (
          <AppCard
            key={client.id}
            style={{
              borderColor: polishedBorder,
              borderLeftColor: infoAccent,
              borderLeftWidth: 4,
              borderWidth: 1,
              marginBottom: 14,
            }}
          >
            <Pressable
              accessibilityRole="button"
              onPress={() => {
                if (selectionMode) {
                  toggleClientSelected(clientId);
                  return;
                }

                router.push({
                  pathname: "/client-details",
                  params: { clientId: String(client.id) },
                });
              }}
            >
              <View
                style={{
                  flexDirection: "row",
                  alignItems: "flex-start",
                  justifyContent: "space-between",
                  gap: 12,
                }}
              >
                {selectionMode ? (
                  <View
                    style={{
                      width: 28,
                      height: 28,
                      borderRadius: 8,
                      borderWidth: 2,
                      borderColor: selected ? colors.primary : colors.border,
                      backgroundColor: selected ? colors.primary : colors.card,
                      alignItems: "center",
                      justifyContent: "center",
                      marginTop: 7,
                    }}
                  >
                    <Text style={{ color: "#FFFFFF", fontWeight: "900" }}>
                      {selected ? "✓" : ""}
                    </Text>
                  </View>
                ) : null}

                <View
                  style={{
                    width: 42,
                    height: 42,
                    borderRadius: 21,
                    backgroundColor: greenAccentSoft,
                    borderColor: `${colors.primary}55`,
                    borderWidth: 1,
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <Text
                    style={{
                      color: colors.primary,
                      fontSize: 17,
                      fontWeight: "900",
                    }}
                  >
                    {String(client.name || "?")
                      .trim()
                      .slice(0, 1)
                      .toUpperCase() || "?"}
                  </Text>
                </View>

                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text
                    style={{
                      color: colors.text,
                      fontSize: 20,
                      fontWeight: "900",
                    }}
                  >
                    {client.name || "Unnamed Client"}
                  </Text>

                  {!!client.phone && (
                    <Text
                      style={{
                        color: colors.mutedText,
                        fontWeight: "600",
                        marginTop: 8,
                      }}
                    >
                      {client.phone}
                    </Text>
                  )}

                  {!!client.email && (
                    <Text
                      numberOfLines={1}
                      ellipsizeMode="tail"
                      style={{
                        color: colors.mutedText,
                        marginTop: 3,
                        maxWidth: "100%",
                      }}
                    >
                      {client.email}
                    </Text>
                  )}
                </View>

                <View
                  style={{
                    alignSelf: "flex-start",
                    backgroundColor: infoAccentSoft,
                    borderWidth: 1,
                    borderColor: infoAccentBorder,
                    borderRadius: 999,
                    paddingHorizontal: 10,
                    paddingVertical: 4,
                  }}
                >
                  <Text style={{ color: infoAccent, fontWeight: "900" }}>
                    {tag}
                  </Text>
                </View>
              </View>

              <View
                style={{
                  flexDirection: "row",
                  flexWrap: "wrap",
                  gap: 6,
                  marginTop: 12,
                }}
              >
                {consentBadges.map((badge) => {
                  const warn = badge.tone === "warn";
                  const good = badge.tone === "good";
                  return (
                    <View
                      key={badge.label}
                      style={{
                        borderRadius: 999,
                        paddingHorizontal: 9,
                        paddingVertical: 4,
                        borderWidth: 1,
                        borderColor: warn
                          ? "rgba(217, 119, 6, 0.34)"
                          : good
                            ? "rgba(15, 118, 110, 0.34)"
                            : infoAccentBorder,
                        backgroundColor: warn
                          ? "rgba(217, 119, 6, 0.12)"
                          : good
                            ? greenAccentSoft
                            : infoAccentSoft,
                      }}
                    >
                      <Text
                        style={{
                          color: warn ? "#B45309" : good ? "#0F766E" : infoAccent,
                          fontSize: 11,
                          fontWeight: "900",
                        }}
                      >
                        {badge.label}
                      </Text>
                    </View>
                  );
                })}
              </View>

              {!selectionMode ? (
                <Text
                  style={{
                    color: infoAccent,
                    fontWeight: "900",
                    marginTop: 14,
                  }}
                >
                  View Client Profile
                </Text>
              ) : null}
            </Pressable>

            {!selectionMode ? (
              <AppButton
                title="Edit Client"
                onPress={() =>
                  router.push({
                    pathname: "/edit-client",
                    params: { clientId: String(client.id) },
                  })
                }
                style={{ marginTop: 14 }}
              />
            ) : null}
          </AppCard>
        );
      })}

      <Modal
        visible={manualConsentVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setManualConsentVisible(false)}
      >
        <View
          style={{
            flex: 1,
            backgroundColor: "rgba(0,0,0,0.55)",
            justifyContent: "flex-end",
          }}
        >
          <View
            style={{
              backgroundColor: colors.background,
              borderTopLeftRadius: 22,
              borderTopRightRadius: 22,
              maxHeight: "88%",
              padding: 18,
            }}
          >
            <ScrollView keyboardShouldPersistTaps="handled">
              <Text
                style={{
                  color: colors.text,
                  fontSize: 22,
                  fontWeight: "900",
                  marginBottom: 6,
                }}
              >
                Mark Consent Received
              </Text>
              <Text style={{ color: colors.mutedText, lineHeight: 20 }}>
                {selectedClientIds.length} selected client
                {selectedClientIds.length === 1 ? "" : "s"}
              </Text>

              <View style={{ gap: 10, marginTop: 18 }}>
                {[
                  ["SMS consent", manualSmsConsent, setManualSmsConsent],
                  ["Email consent", manualEmailConsent, setManualEmailConsent],
                ].map(([label, value, setter]) => (
                  <Pressable
                    key={String(label)}
                    accessibilityRole="button"
                    onPress={() => (setter as (next: boolean) => void)(!value)}
                    style={{
                      minHeight: 48,
                      borderRadius: 14,
                      borderWidth: 1,
                      borderColor: value ? colors.primary : polishedBorder,
                      backgroundColor: value ? infoAccentSoft : colors.card,
                      paddingHorizontal: 14,
                      alignItems: "center",
                      flexDirection: "row",
                      justifyContent: "space-between",
                    }}
                  >
                    <Text style={{ color: colors.text, fontWeight: "900" }}>
                      {String(label)}
                    </Text>
                    <Text style={{ color: colors.primary, fontWeight: "900" }}>
                      {value ? "On" : "Off"}
                    </Text>
                  </Pressable>
                ))}
              </View>

              <Text
                style={{
                  color: colors.text,
                  fontWeight: "900",
                  marginTop: 18,
                  marginBottom: 10,
                }}
              >
                Consent source
              </Text>
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                {CONSENT_SOURCES.map((source) => {
                  const selectedSource = source === manualConsentSource;
                  return (
                    <Pressable
                      key={source}
                      accessibilityRole="button"
                      onPress={() => setManualConsentSource(source)}
                      style={{
                        minHeight: 40,
                        borderRadius: 999,
                        paddingHorizontal: 12,
                        alignItems: "center",
                        justifyContent: "center",
                        borderWidth: 1,
                        borderColor: selectedSource ? colors.primary : polishedBorder,
                        backgroundColor: selectedSource ? colors.primary : colors.card,
                      }}
                    >
                      <Text
                        style={{
                          color: selectedSource ? "#FFFFFF" : colors.text,
                          fontWeight: "900",
                        }}
                      >
                        {source}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>

              <Pressable
                accessibilityRole="checkbox"
                accessibilityState={{ checked: manualConfirmed }}
                onPress={() => setManualConfirmed((current) => !current)}
                style={{
                  marginTop: 18,
                  borderRadius: 14,
                  borderWidth: 1,
                  borderColor: manualConfirmed ? colors.primary : polishedBorder,
                  backgroundColor: manualConfirmed ? infoAccentSoft : colors.card,
                  padding: 14,
                  flexDirection: "row",
                  gap: 12,
                }}
              >
                <Text style={{ color: colors.primary, fontWeight: "900" }}>
                  {manualConfirmed ? "✓" : "○"}
                </Text>
                <Text style={{ color: colors.text, flex: 1, lineHeight: 20 }}>
                  I confirm these clients agreed to receive the selected
                  appointment messages.
                </Text>
              </Pressable>

              <View style={{ gap: 10, marginTop: 18, marginBottom: 8 }}>
                <AppButton
                  title="Apply Consent"
                  loading={bulkWorking}
                  disabled={bulkWorking}
                  onPress={() => {
                    void applyManualConsent();
                  }}
                />
                <AppButton
                  title="Cancel"
                  variant="secondary"
                  disabled={bulkWorking}
                  onPress={() => {
                    setManualConsentVisible(false);
                    setManualConfirmed(false);
                  }}
                />
              </View>
            </ScrollView>
          </View>
        </View>
      </Modal>
    </AppScreen>
  );
}
