import { Ionicons } from "@expo/vector-icons";
import { useEffect, useMemo, useState } from "react";
import { Pressable, Text, View, useWindowDimensions, Alert } from "react-native";

import {
  AppButton,
  AppCard,
  AppScreen,
  EmptyState,
  ListRow,
  LoadingCard,
  ScreenHeader,
} from "../components/ui";
import {
  buildClientMergeDraft,
  buildDuplicateClientPairs,
  getMergedClientConsent,
  type ClientDataRecord,
  type ClientDuplicatePair,
  type ClientMergeChoice,
  type ClientMergeField,
} from "../lib/clientData";
import { clearDashboardPrimaryCache } from "../lib/dashboardCache";
import { fetchActiveClients, mergeClientRecords } from "../lib/clientDataActions";
import { useAuthSession } from "../lib/authSession";
import { useAppTheme } from "../lib/useAppTheme";

const FIELD_LABELS: Record<ClientMergeField, string> = {
  birthday: "Birthday",
  email: "Email",
  name: "Name",
  notes: "Notes",
  phone: "Phone",
  rebookingWeeks: "Rebooking weeks",
  tag: "Tag",
};

function duplicateKindLabel(kind: ClientDuplicatePair["kind"]) {
  switch (kind) {
    case "review":
      return "Needs review";
    case "possible":
      return "Possible duplicate";
    default:
      return "Strong duplicate";
  }
}

function duplicateKindHelp(kind: ClientDuplicatePair["kind"]) {
  switch (kind) {
    case "review":
      return "Same contact info, different name.";
    case "possible":
      return "Same name only.";
    default:
      return "Matching name and contact info.";
  }
}

function formatFieldValue(field: ClientMergeField, client: ClientDataRecord) {
  switch (field) {
    case "birthday":
      return String(client.birthday || "").trim() || "Not set";
    case "email":
      return String(client.email || "").trim() || "Not set";
    case "name":
      return String(client.name || "").trim() || "Not set";
    case "notes":
      return String(client.notes || "").trim() || "Not set";
    case "phone":
      return String(client.phone || "").trim() || "Not set";
    case "rebookingWeeks":
      return client.rebooking_weeks ? `${client.rebooking_weeks} weeks` : "Not set";
    case "tag":
      return String(client.client_tag || "New").trim() || "New";
    default:
      return "Not set";
  }
}

function getClientSummary(client: ClientDataRecord) {
  return [client.phone, client.email].filter(Boolean).join(" • ") || "No phone or email";
}

export default function ClientDuplicatesScreen() {
  const { userId } = useAuthSession();
  const { colors } = useAppTheme();
  const { width } = useWindowDimensions();
  const stackedCards = width < 760;
  const [clients, setClients] = useState<ClientDataRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [selectedPairId, setSelectedPairId] = useState("");
  const [primarySide, setPrimarySide] = useState<"left" | "right">("left");
  const [fieldChoices, setFieldChoices] = useState<
    Partial<Record<ClientMergeField, ClientMergeChoice>>
  >({});

  const pairs = useMemo(() => buildDuplicateClientPairs(clients), [clients]);
  const selectedPair = pairs.find((pair) => pair.id === selectedPairId) || null;
  const primaryClient = selectedPair
    ? primarySide === "left"
      ? selectedPair.left
      : selectedPair.right
    : null;
  const duplicateClient = selectedPair
    ? primarySide === "left"
      ? selectedPair.right
      : selectedPair.left
    : null;
  const mergeDraft =
    primaryClient && duplicateClient
      ? buildClientMergeDraft(primaryClient, duplicateClient, fieldChoices)
      : null;
  const mergedConsent =
    primaryClient && mergeDraft
      ? getMergedClientConsent({ primary: primaryClient, values: mergeDraft.values })
      : null;

  useEffect(() => {
    let active = true;

    async function loadClients() {
      if (!userId) {
        if (active) {
          setClients([]);
          setLoading(false);
        }
        return;
      }

      setLoading(true);
      try {
        const nextClients = await fetchActiveClients(userId);
        if (active) setClients(nextClients);
      } catch (error) {
        if (active) {
          Alert.alert(
            "Duplicates unavailable",
            error instanceof Error ? error.message : "Client duplicates could not be loaded.",
          );
        }
      } finally {
        if (active) setLoading(false);
      }
    }

    void loadClients();

    return () => {
      active = false;
    };
  }, [userId]);

  useEffect(() => {
    if (!selectedPair) {
      setFieldChoices({});
      return;
    }

    if (!pairs.some((pair) => pair.id === selectedPairId)) {
      setSelectedPairId("");
      setFieldChoices({});
    }
  }, [pairs, selectedPair, selectedPairId]);

  function openPair(pair: ClientDuplicatePair) {
    setSelectedPairId(pair.id);
    setPrimarySide("left");
    setFieldChoices({});
  }

  function choosePrimary(side: "left" | "right") {
    setPrimarySide(side);
    setFieldChoices({});
  }

  function chooseFieldValue(field: ClientMergeField, choice: ClientMergeChoice) {
    setFieldChoices((current) => ({ ...current, [field]: choice }));
  }

  async function applyMerge() {
    if (!primaryClient || !duplicateClient || !mergeDraft || saving) return;

    setSaving(true);
    try {
      await mergeClientRecords({
        duplicateClientId: duplicateClient.id,
        primaryClientId: primaryClient.id,
        values: mergeDraft.values,
      });

      clearDashboardPrimaryCache(userId);
      const nextClients = userId ? await fetchActiveClients(userId) : [];
      setClients(nextClients);
      setSelectedPairId("");
      setFieldChoices({});
      Alert.alert(
        "Clients merged",
        `${primaryClient.name || "Primary client"} now keeps the preserved details and linked history.`,
      );
    } catch (error) {
      Alert.alert(
        "Merge failed",
        error instanceof Error ? error.message : "These clients could not be merged.",
      );
    } finally {
      setSaving(false);
    }
  }

  function renderClientCard(client: ClientDataRecord, side: "left" | "right") {
    const selected = primarySide === side;

    return (
      <AppCard style={{ flex: 1 }}>
        <Text
          style={{
            color: colors.text,
            fontSize: 18,
            fontWeight: "900",
            marginBottom: 6,
          }}
        >
          {client.name || "Unnamed client"}
        </Text>
        <Text style={{ color: colors.mutedText, lineHeight: 20, marginBottom: 12 }}>
          {getClientSummary(client)}
        </Text>

        <View style={{ gap: 6, marginBottom: 14 }}>
          <Text style={{ color: colors.text, fontWeight: "700" }}>
            Tag: {formatFieldValue("tag", client)}
          </Text>
          <Text style={{ color: colors.text, fontWeight: "700" }}>
            Birthday: {formatFieldValue("birthday", client)}
          </Text>
          <Text style={{ color: colors.text, fontWeight: "700" }}>
            Rebooking: {formatFieldValue("rebookingWeeks", client)}
          </Text>
          <Text style={{ color: colors.text, fontWeight: "700" }}>
            Notes: {formatFieldValue("notes", client)}
          </Text>
        </View>

        <AppButton
          title={selected ? "Primary record" : "Use as primary"}
          variant={selected ? "secondary" : "primary"}
          onPress={() => choosePrimary(side)}
        />
      </AppCard>
    );
  }

  return (
    <AppScreen scroll backgroundColor={colors.background} bottomPadding={64}>
      <ScreenHeader
        title="Find & merge duplicates"
        subtitle="Review matching client records side-by-side before merging them."
        showBack
      />

      <AppCard style={{ marginBottom: 16 }}>
        <Text
          style={{
            color: colors.text,
            fontSize: 18,
            fontWeight: "900",
            marginBottom: 8,
          }}
        >
          Safe merge rules
        </Text>
        <Text style={{ color: colors.mutedText, lineHeight: 20 }}>
          Appointment history, messages, reply links, reminders, and communication
          recipients are reassigned before the duplicate record is archived. The
          chosen primary record keeps communication consent as-is, so merging never
          makes consent more permissive.
        </Text>
      </AppCard>

      {loading ? (
        <LoadingCard label="Checking for duplicate clients..." />
      ) : pairs.length === 0 ? (
        <EmptyState
          title="No duplicates found"
          message="Schedova did not find any active client pairs that share the same name, phone, or email closely enough to review."
        />
      ) : (
        <>
          {selectedPair && primaryClient && duplicateClient && mergeDraft ? (
            <AppCard style={{ marginBottom: 16 }}>
              <Text
                style={{
                  color: colors.text,
                  fontSize: 20,
                  fontWeight: "900",
                  marginBottom: 6,
                }}
              >
                Review selected pair
              </Text>
              <Text style={{ color: colors.mutedText, lineHeight: 20, marginBottom: 16 }}>
                {duplicateKindLabel(selectedPair.kind)} • {duplicateKindHelp(selectedPair.kind)}
              </Text>

              <View
                style={{
                  flexDirection: stackedCards ? "column" : "row",
                  gap: 12,
                  marginBottom: 16,
                }}
              >
                {renderClientCard(selectedPair.left, "left")}
                {renderClientCard(selectedPair.right, "right")}
              </View>

              {mergeDraft.conflicts.length > 0 ? (
                <View style={{ gap: 12, marginBottom: 16 }}>
                  <Text style={{ color: colors.text, fontSize: 18, fontWeight: "900" }}>
                    Resolve conflicting fields
                  </Text>
                  {mergeDraft.conflicts.map((field) => (
                    <AppCard
                      key={field}
                      variant="subtle"
                      style={{ marginBottom: 0 }}
                    >
                      <Text style={{ color: colors.text, fontWeight: "900", marginBottom: 8 }}>
                        {FIELD_LABELS[field]}
                      </Text>
                      <View
                        style={{
                          flexDirection: stackedCards ? "column" : "row",
                          gap: 10,
                        }}
                      >
                        <Pressable
                          accessibilityRole="button"
                          onPress={() => chooseFieldValue(field, "primary")}
                          style={{
                            flex: 1,
                            borderWidth: 1,
                            borderColor:
                              mergeDraft.choices[field] === "primary"
                                ? colors.primary
                                : colors.border,
                            backgroundColor:
                              mergeDraft.choices[field] === "primary"
                                ? `${colors.primary}14`
                                : colors.card,
                            borderRadius: 14,
                            padding: 12,
                          }}
                        >
                          <Text style={{ color: colors.text, fontWeight: "800", marginBottom: 4 }}>
                            Keep primary value
                          </Text>
                          <Text style={{ color: colors.mutedText, lineHeight: 20 }}>
                            {formatFieldValue(field, primaryClient)}
                          </Text>
                        </Pressable>
                        <Pressable
                          accessibilityRole="button"
                          onPress={() => chooseFieldValue(field, "duplicate")}
                          style={{
                            flex: 1,
                            borderWidth: 1,
                            borderColor:
                              mergeDraft.choices[field] === "duplicate"
                                ? colors.primary
                                : colors.border,
                            backgroundColor:
                              mergeDraft.choices[field] === "duplicate"
                                ? `${colors.primary}14`
                                : colors.card,
                            borderRadius: 14,
                            padding: 12,
                          }}
                        >
                          <Text style={{ color: colors.text, fontWeight: "800", marginBottom: 4 }}>
                            Use duplicate value
                          </Text>
                          <Text style={{ color: colors.mutedText, lineHeight: 20 }}>
                            {formatFieldValue(field, duplicateClient)}
                          </Text>
                        </Pressable>
                      </View>
                    </AppCard>
                  ))}
                </View>
              ) : (
                <Text style={{ color: colors.mutedText, lineHeight: 20, marginBottom: 16 }}>
                  These records do not have conflicting top-level fields. Non-conflicting
                  details will be preserved automatically.
                </Text>
              )}

              <AppCard variant="subtle" style={{ marginBottom: 16 }}>
                <Text style={{ color: colors.text, fontWeight: "900", marginBottom: 8 }}>
                  Merged result preview
                </Text>
                <View style={{ gap: 6 }}>
                  <Text style={{ color: colors.text, fontWeight: "700" }}>
                    Name: {mergeDraft.values.name}
                  </Text>
                  <Text style={{ color: colors.text, fontWeight: "700" }}>
                    Phone: {mergeDraft.values.phone || "Not set"}
                  </Text>
                  <Text style={{ color: colors.text, fontWeight: "700" }}>
                    Email: {mergeDraft.values.email || "Not set"}
                  </Text>
                  <Text style={{ color: colors.text, fontWeight: "700" }}>
                    Tag: {mergeDraft.values.tag}
                  </Text>
                  <Text style={{ color: colors.text, fontWeight: "700" }}>
                    Birthday: {mergeDraft.values.birthday || "Not set"}
                  </Text>
                  <Text style={{ color: colors.text, fontWeight: "700" }}>
                    Rebooking:{" "}
                    {mergeDraft.values.rebookingWeeks
                      ? `${mergeDraft.values.rebookingWeeks} weeks`
                      : "Not set"}
                  </Text>
                  <Text style={{ color: colors.text, fontWeight: "700" }}>
                    Notes: {mergeDraft.values.notes || "Not set"}
                  </Text>
                  <Text style={{ color: colors.mutedText, lineHeight: 20, marginTop: 6 }}>
                    SMS consent remains {mergedConsent?.smsOptIn ? "on" : "off"} from the
                    chosen primary record. Email consent remains{" "}
                    {mergedConsent?.emailOptIn ? "on" : "off"} from the chosen primary
                    record.
                  </Text>
                </View>
              </AppCard>

              <View style={{ gap: 10 }}>
                <AppButton
                  title={saving ? "Merging..." : "Merge Clients"}
                  loading={saving}
                  disabled={saving}
                  onPress={() => {
                    void applyMerge();
                  }}
                />
                <AppButton
                  title="Back to duplicate list"
                  variant="secondary"
                  disabled={saving}
                  onPress={() => {
                    setSelectedPairId("");
                    setFieldChoices({});
                  }}
                />
              </View>
            </AppCard>
          ) : null}

          <AppCard>
            <Text
              style={{
                color: colors.text,
                fontSize: 18,
                fontWeight: "900",
                marginBottom: 10,
              }}
            >
              Duplicate pairs
            </Text>
            <View style={{ gap: 10 }}>
              {pairs.map((pair) => (
                <ListRow
                  key={pair.id}
                  title={`${pair.left.name || "Client"} ↔ ${pair.right.name || "Client"}`}
                  subtitle={duplicateKindHelp(pair.kind)}
                  helper={pair.reasons.join(", ").replace(/_/g, " ")}
                  leftIcon={
                    <Ionicons
                      name="git-compare-outline"
                      size={20}
                      color={pair.id === selectedPairId ? colors.primary : colors.mutedText}
                    />
                  }
                  right={
                    <Text style={{ color: colors.primary, fontWeight: "800" }}>
                      {duplicateKindLabel(pair.kind)}
                    </Text>
                  }
                  onPress={() => openPair(pair)}
                  style={
                    pair.id === selectedPairId
                      ? { borderColor: colors.primary, backgroundColor: `${colors.primary}0F` }
                      : undefined
                  }
                />
              ))}
            </View>
          </AppCard>
        </>
      )}
    </AppScreen>
  );
}
