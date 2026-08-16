import { Ionicons } from "@expo/vector-icons";
import { Picker } from "@react-native-picker/picker";
import { useRouter } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import { Alert, Pressable, Text, View } from "react-native";

import {
  AppButton,
  AppCard,
  AppScreen,
  EmptyState,
  LoadingCard,
  ScreenHeader,
} from "../components/ui";
import {
  buildClientImportPreview,
  inferClientCsvMapping,
  isManualClientCsvMappingField,
  parseClientCsv,
  shouldShowManualClientCsvMapping,
  type ClientCsvMapping,
  type ClientCsvMappingValue,
  type ClientDataRecord,
  type ClientImportDecisionAction,
  type ClientImportPreview,
  type ParsedClientCsv,
} from "../lib/clientData";
import {
  fetchActiveClients,
  importClientRows,
  pickClientCsvFile,
  type ClientImportBatchResult,
} from "../lib/clientDataActions";
import { useAuthSession } from "../lib/authSession";
import { normalizePhoneForSmsWithUserDefault } from "../lib/countrySettings";
import { clearDashboardPrimaryCache } from "../lib/dashboardCache";
import { useFeatureAccess } from "../lib/featureAccess";
import { useAppTheme } from "../lib/useAppTheme";

const COLUMN_OPTIONS: { label: string; value: ClientCsvMappingValue | "" }[] = [
  { label: "Ignore column", value: "" },
  { label: "First Name", value: "name" },
  { label: "Last Name", value: "last_name" },
  { label: "Phone", value: "phone" },
  { label: "Email", value: "email" },
];

function labelForAction(action: ClientImportDecisionAction) {
  switch (action) {
    case "merge":
      return "Merge with existing";
    case "keep_separate":
      return "Keep separate";
    case "skip":
      return "Skip";
    default:
      return "Import as new";
  }
}

function describeRowValues(row: {
  values: {
    email: string;
    name: string;
    phone: string;
    rebookingWeeks: number | null;
    tag: string;
  };
}) {
  return [
    row.values.name || "Unnamed client",
    row.values.phone || null,
    row.values.email || null,
    row.values.tag && row.values.tag !== "New" ? `Tag: ${row.values.tag}` : null,
    row.values.rebookingWeeks
      ? `Rebooking: ${row.values.rebookingWeeks} week${row.values.rebookingWeeks === 1 ? "" : "s"}`
      : null,
  ]
    .filter(Boolean)
    .join(" • ");
}

function duplicateLabel(kind: "possible" | "review" | "strong") {
  switch (kind) {
    case "review":
      return "Contact info matches a different name";
    case "possible":
      return "Same-name duplicate to review";
    default:
      return "Strong duplicate match";
  }
}

function duplicateHelp(kind: "possible" | "review" | "strong") {
  switch (kind) {
    case "review":
      return "Schedova found the same phone or email under another name. Choose merge only if this is the same person.";
    case "possible":
      return "Same-name matches never auto-merge. You can keep them separate, merge, or skip this row.";
    default:
      return "This row matches an existing client closely enough to merge automatically if you want.";
  }
}

function statusCopy(status: ClientImportPreview["rows"][number]["status"]) {
  switch (status) {
    case "invalid":
      return "Invalid row";
    case "plan_limit_skip":
      return "Plan-limit skip";
    case "skipped":
      return "Skipped";
    default:
      return "Ready";
  }
}

export default function ClientImportScreen() {
  const router = useRouter();
  const { colors } = useAppTheme();
  const { userId } = useAuthSession();
  const featureAccess = useFeatureAccess();
  const isUnlimited = featureAccess.isPro === true;
  const [clients, setClients] = useState<ClientDataRecord[]>([]);
  const [loadingClients, setLoadingClients] = useState(true);
  const [working, setWorking] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [selectedFileName, setSelectedFileName] = useState("");
  const [parsed, setParsed] = useState<ParsedClientCsv | null>(null);
  const [mapping, setMapping] = useState<ClientCsvMapping>({});
  const [preview, setPreview] = useState<ClientImportPreview | null>(null);
  const [editingMapping, setEditingMapping] = useState(false);
  const [importSummary, setImportSummary] = useState<{
    fileName: string;
    invalidRows: number;
    result: ClientImportBatchResult;
  } | null>(null);
  const [decisions, setDecisions] = useState<Record<number, { action: ClientImportDecisionAction; targetClientId?: string | null }>>({});

  useEffect(() => {
    let active = true;

    async function loadClients() {
      if (!userId) {
        if (active) {
          setClients([]);
          setLoadingClients(false);
        }
        return;
      }

      setLoadingClients(true);
      try {
        const nextClients = await fetchActiveClients(userId);
        if (active) setClients(nextClients);
      } catch (error) {
        if (active) {
          Alert.alert(
            "Clients unavailable",
            error instanceof Error ? error.message : "Client import needs your current client list first.",
          );
        }
      } finally {
        if (active) setLoadingClients(false);
      }
    }

    void loadClients();

    return () => {
      active = false;
    };
  }, [userId]);

  useEffect(() => {
    let active = true;

    async function loadPreview() {
      if (!parsed) {
        if (active) setPreview(null);
        return;
      }

      setPreviewLoading(true);
      try {
        const nextPreview = await buildClientImportPreview({
          decisions,
          existingClients: clients,
          isUnlimited,
          mapping,
          parsed,
          phoneNormalizer: normalizePhoneForSmsWithUserDefault,
        });

        if (active) setPreview(nextPreview);
      } catch (error) {
        if (active) {
          Alert.alert(
            "Preview failed",
            error instanceof Error ? error.message : "Client import preview could not be prepared.",
          );
          setPreview(null);
        }
      } finally {
        if (active) setPreviewLoading(false);
      }
    }

    if (!loadingClients) {
      void loadPreview();
    }

    return () => {
      active = false;
    };
  }, [clients, decisions, isUnlimited, loadingClients, mapping, parsed]);

  const mappedHeaders = useMemo(
    () =>
      parsed?.headers.map((header, index) => ({
        header,
        index,
        value: (mapping[index] || "") as ClientCsvMappingValue | "",
      }))
        .filter((column) => isManualClientCsvMappingField(column.value)) || [],
    [mapping, parsed],
  );

  async function chooseFile() {
    if (working) return;

    try {
      const picked = await pickClientCsvFile();
      if (!picked) return;

      const nextParsed = parseClientCsv(picked.text);
      const nextMapping = inferClientCsvMapping(nextParsed.headers);

      setSelectedFileName(picked.name);
      setParsed(nextParsed);
      setMapping(nextMapping);
      setPreview(null);
      setImportSummary(null);
      setDecisions({});
      setEditingMapping(
        shouldShowManualClientCsvMapping({
          headers: nextParsed.headers,
          mapping: nextMapping,
          rows: nextParsed.rows,
        }),
      );
    } catch (error) {
      Alert.alert(
        "CSV unavailable",
        error instanceof Error ? error.message : "The selected CSV could not be opened.",
      );
    }
  }

  function resetImportFlow() {
    setSelectedFileName("");
    setParsed(null);
    setMapping({});
    setPreview(null);
    setEditingMapping(false);
    setImportSummary(null);
    setDecisions({});
  }

  function updateColumnMapping(index: number, value: ClientCsvMappingValue | "") {
    setMapping((current) => {
      const next = { ...current };

      if (value) {
        Object.keys(next).forEach((key) => {
          const numericKey = Number(key);
          if (numericKey !== index && next[numericKey] === value) {
            next[numericKey] = "";
          }
        });
      }

      next[index] = value;
      return next;
    });
    setDecisions({});
  }

  function updateRowDecision(
    rowNumber: number,
    action: ClientImportDecisionAction,
    targetClientId?: string | null,
  ) {
    setDecisions((current) => ({
      ...current,
      [rowNumber]: {
        action,
        targetClientId:
          action === "merge" ? targetClientId ?? current[rowNumber]?.targetClientId ?? null : null,
      },
    }));
  }

  async function applyImport() {
    if (!preview || working) return;

    if (preview.summary.readyRows === 0) {
      Alert.alert("Nothing ready", "Adjust the preview so at least one row is ready to import.");
      return;
    }

    setWorking(true);
    try {
      const result = await importClientRows(preview.rows);
      clearDashboardPrimaryCache(userId);
      setImportSummary({
        fileName: selectedFileName,
        invalidRows: preview.summary.invalidRows,
        result,
      });
    } catch (error) {
      Alert.alert(
        "Import failed",
        error instanceof Error ? error.message : "Client rows could not be imported.",
      );
    } finally {
      setWorking(false);
    }
  }

  return (
    <AppScreen scroll backgroundColor={colors.background} bottomPadding={64}>
      <ScreenHeader
        title="Import CSV"
        subtitle="Pick a client CSV, review the preview, and import only the rows you want."
        showBack
      />

      {loadingClients ? (
        <LoadingCard label="Loading active clients..." style={{ marginBottom: 16 }} />
      ) : null}

      {importSummary ? (
        <AppCard>
          <Text
            style={{
              color: colors.text,
              fontSize: 20,
              fontWeight: "900",
              marginBottom: 8,
            }}
          >
            Import finished
          </Text>
          <Text style={{ color: colors.mutedText, lineHeight: 20, marginBottom: 16 }}>
            {importSummary.fileName || "Selected CSV"}
          </Text>

          <View style={{ gap: 8, marginBottom: 18 }}>
            <Text style={{ color: colors.text, fontWeight: "700" }}>
              Inserted: {importSummary.result.inserted || 0}
            </Text>
            <Text style={{ color: colors.text, fontWeight: "700" }}>
              Merged: {importSummary.result.merged || 0}
            </Text>
            <Text style={{ color: colors.text, fontWeight: "700" }}>
              Skipped: {importSummary.result.skipped || 0}
            </Text>
            <Text style={{ color: colors.text, fontWeight: "700" }}>
              Invalid rows skipped: {importSummary.invalidRows}
            </Text>
            <Text style={{ color: colors.text, fontWeight: "700" }}>
              Plan-limit skips: {importSummary.result.planLimitSkipped || 0}
            </Text>
          </View>

          <View style={{ gap: 10 }}>
            <AppButton title="Import another CSV" onPress={resetImportFlow} />
                <AppButton
                  title="Back to Manage Clients"
                  variant="secondary"
                  onPress={() => {
                    resetImportFlow();
                    router.replace("/manage-clients" as any);
                  }}
                />
              </View>
            </AppCard>
      ) : !parsed ? (
        <>
          <AppCard style={{ marginBottom: 16 }}>
            <View style={{ flexDirection: "row", gap: 12 }}>
              <View
                style={{
                  width: 42,
                  height: 42,
                  borderRadius: 21,
                  backgroundColor: `${colors.primary}16`,
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <Ionicons name="cloud-upload-outline" size={20} color={colors.primary} />
              </View>
              <View style={{ flex: 1 }}>
                <Text
                  style={{
                    color: colors.text,
                    fontSize: 18,
                    fontWeight: "900",
                    marginBottom: 6,
                  }}
                >
                  Bring in your client list
                </Text>
                <Text style={{ color: colors.mutedText, lineHeight: 20 }}>
                  Supported columns are name, phone, email, notes, birthday, tag,
                  and rebooking weeks. Schedova will preview duplicates, invalid rows,
                  and plan-limit skips before anything is saved.
                </Text>
              </View>
            </View>
          </AppCard>

          <AppButton title="Choose CSV File" onPress={() => void chooseFile()} />
        </>
      ) : (
        <>
          <AppCard style={{ marginBottom: 16 }}>
            <Text
              style={{
                color: colors.text,
                fontSize: 18,
                fontWeight: "900",
                marginBottom: 6,
              }}
            >
              {selectedFileName || "Selected CSV"}
            </Text>
            <Text style={{ color: colors.mutedText, lineHeight: 20 }}>
              {parsed.rows.length} data row{parsed.rows.length === 1 ? "" : "s"} found.
            </Text>
          </AppCard>

          {editingMapping ? (
            <AppCard style={{ marginBottom: 16 }}>
              <Text
                style={{
                  color: colors.text,
                  fontSize: 18,
                  fontWeight: "900",
                  marginBottom: 8,
                }}
              >
                Column mapping
              </Text>
              <Text style={{ color: colors.mutedText, lineHeight: 20, marginBottom: 16 }}>
                Map name, phone, and email columns here. Other recognized client
                fields stay auto-detected.
              </Text>

              <View style={{ gap: 14 }}>
                {mappedHeaders.map((column) => (
                  <View key={`${column.header}-${column.index}`} style={{ gap: 8 }}>
                    <Text style={{ color: colors.text, fontWeight: "800" }}>
                      {column.header || `Column ${column.index + 1}`}
                    </Text>
                    <View
                      style={{
                        borderWidth: 1,
                        borderColor: colors.border,
                        borderRadius: 14,
                        overflow: "hidden",
                        backgroundColor: colors.card,
                      }}
                    >
                      <Picker
                        selectedValue={column.value}
                        onValueChange={(value) =>
                          updateColumnMapping(
                            column.index,
                            value as ClientCsvMappingValue | "",
                          )
                        }
                        style={{ color: colors.text }}
                      >
                        {COLUMN_OPTIONS.map((option) => (
                          <Picker.Item
                            key={option.label}
                            label={option.label}
                            value={option.value}
                          />
                        ))}
                      </Picker>
                    </View>
                  </View>
                ))}
              </View>

              <View style={{ gap: 10, marginTop: 18 }}>
                <AppButton
                  title="Continue to Preview"
                  onPress={() => setEditingMapping(false)}
                />
                <AppButton
                  title="Choose Another CSV"
                  variant="secondary"
                  onPress={() => void chooseFile()}
                />
              </View>
            </AppCard>
          ) : previewLoading ? (
            <LoadingCard label="Building import preview..." style={{ marginBottom: 16 }} />
          ) : preview ? (
            <>
              <AppCard style={{ marginBottom: 16 }}>
                <Text
                  style={{
                    color: colors.text,
                    fontSize: 18,
                    fontWeight: "900",
                    marginBottom: 12,
                  }}
                >
                  Import preview
                </Text>
                <View style={{ gap: 8 }}>
                  <Text style={{ color: colors.text, fontWeight: "700" }}>
                    Total rows: {preview.summary.totalRows}
                  </Text>
                  <Text style={{ color: colors.text, fontWeight: "700" }}>
                    Ready rows: {preview.summary.readyRows}
                  </Text>
                  <Text style={{ color: colors.text, fontWeight: "700" }}>
                    Invalid rows: {preview.summary.invalidRows}
                  </Text>
                  <Text style={{ color: colors.text, fontWeight: "700" }}>
                    Possible duplicates: {preview.summary.possibleDuplicates}
                  </Text>
                  <Text style={{ color: colors.text, fontWeight: "700" }}>
                    Plan-limit skips: {preview.summary.planLimitSkips}
                  </Text>
                </View>

                <View style={{ gap: 10, marginTop: 18 }}>
                  <AppButton
                    title={working ? "Importing..." : "Import Ready Rows"}
                    disabled={working || preview.summary.readyRows === 0}
                    loading={working}
                    onPress={() => {
                      void applyImport();
                    }}
                  />
                  <AppButton
                    title="Review Column Mapping"
                    variant="secondary"
                    disabled={working}
                    onPress={() => setEditingMapping(true)}
                  />
                  <AppButton
                    title="Choose Another CSV"
                    variant="ghost"
                    disabled={working}
                    onPress={() => void chooseFile()}
                  />
                </View>
              </AppCard>

              {preview.rows.filter(
                (row) => row.duplicate || row.errors.length > 0 || row.status !== "ready",
              ).length === 0 ? (
                <EmptyState
                  title="Everything is ready"
                  message="This file does not need any extra review before import."
                  style={{ marginBottom: 16 }}
                />
              ) : null}

              <View style={{ gap: 12 }}>
                {preview.rows
                  .filter(
                    (row) =>
                      row.duplicate || row.errors.length > 0 || row.status !== "ready",
                  )
                  .map((row) => (
                    <AppCard key={row.rowNumber}>
                      <View
                        style={{
                          flexDirection: "row",
                          justifyContent: "space-between",
                          gap: 12,
                          marginBottom: 10,
                        }}
                      >
                        <Text style={{ color: colors.text, fontWeight: "900", flex: 1 }}>
                          Row {row.rowNumber}
                        </Text>
                        <Text style={{ color: colors.primary, fontWeight: "800" }}>
                          {statusCopy(row.status)}
                        </Text>
                      </View>

                      <Text style={{ color: colors.mutedText, lineHeight: 20 }}>
                        {describeRowValues(row)}
                      </Text>

                      {row.errors.length > 0 ? (
                        <View style={{ gap: 6, marginTop: 12 }}>
                          {row.errors.map((error) => (
                            <Text key={error} style={{ color: "#B45309", lineHeight: 20 }}>
                              {error}
                            </Text>
                          ))}
                        </View>
                      ) : null}

                      {row.duplicate ? (
                        <View style={{ marginTop: 14 }}>
                          <Text style={{ color: colors.text, fontWeight: "900" }}>
                            {duplicateLabel(row.duplicate.kind)}
                          </Text>
                          <Text
                            style={{
                              color: colors.mutedText,
                              lineHeight: 20,
                              marginTop: 4,
                              marginBottom: 10,
                            }}
                          >
                            {duplicateHelp(row.duplicate.kind)}
                          </Text>

                          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                            {(["merge", "keep_separate", "skip"] as ClientImportDecisionAction[]).map(
                              (action) => {
                                const selected = row.decision.action === action;
                                return (
                                  <Pressable
                                    key={action}
                                    accessibilityRole="button"
                                    onPress={() =>
                                      updateRowDecision(
                                        row.rowNumber,
                                        action,
                                        action === "merge" && row.duplicate?.matches.length === 1
                                          ? row.duplicate.matches[0].id
                                          : row.decision.targetClientId,
                                      )
                                    }
                                    style={{
                                      borderWidth: 1,
                                      borderColor: selected ? colors.primary : colors.border,
                                      backgroundColor: selected
                                        ? `${colors.primary}16`
                                        : colors.card,
                                      borderRadius: 999,
                                      paddingHorizontal: 12,
                                      paddingVertical: 8,
                                    }}
                                  >
                                    <Text
                                      style={{
                                        color: selected ? colors.primary : colors.text,
                                        fontWeight: "800",
                                      }}
                                    >
                                      {labelForAction(action)}
                                    </Text>
                                  </Pressable>
                                );
                              },
                            )}
                          </View>

                          {row.decision.action === "merge" ? (
                            <View style={{ gap: 10, marginTop: 14 }}>
                              {row.duplicate.matches.map((match) => {
                                const selected = row.decision.targetClientId === match.id;
                                return (
                                  <Pressable
                                    key={match.id}
                                    accessibilityRole="button"
                                    onPress={() =>
                                      updateRowDecision(row.rowNumber, "merge", match.id)
                                    }
                                    style={{
                                      borderWidth: 1,
                                      borderColor: selected ? colors.primary : colors.border,
                                      backgroundColor: selected
                                        ? `${colors.primary}12`
                                        : colors.card,
                                      borderRadius: 14,
                                      padding: 12,
                                    }}
                                  >
                                    <Text style={{ color: colors.text, fontWeight: "900" }}>
                                      {match.name || "Unnamed client"}
                                    </Text>
                                    <Text
                                      style={{
                                        color: colors.mutedText,
                                        lineHeight: 20,
                                        marginTop: 4,
                                      }}
                                    >
                                      {[match.phone, match.email].filter(Boolean).join(" • ")}
                                    </Text>
                                  </Pressable>
                                );
                              })}
                            </View>
                          ) : null}
                        </View>
                      ) : null}

                      {row.status === "plan_limit_skip" ? (
                        <Text style={{ color: "#B45309", lineHeight: 20, marginTop: 12 }}>
                          This row will be skipped because the Free client limit is already full.
                        </Text>
                      ) : null}
                    </AppCard>
                  ))}
              </View>
            </>
          ) : null}
        </>
      )}
    </AppScreen>
  );
}
