import * as DocumentPicker from "expo-document-picker";
import * as FileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";

import {
  buildClientCsv,
  buildClientCsvTemplate,
  buildClientImportRpcRows,
  getClientCsvExportFileName,
  type ClientDataRecord,
  type ClientFieldValues,
  type ClientImportRow,
} from "./clientData";
import { supabase } from "./supabase";

const ACTIVE_CLIENT_SELECT = [
  "id",
  "name",
  "phone",
  "email",
  "notes",
  "birthday",
  "client_tag",
  "rebooking_weeks",
  "sms_opt_in",
  "sms_opt_in_at",
  "sms_opt_in_source",
  "email_opt_in",
  "email_opt_in_at",
  "email_opt_in_source",
  "archived_at",
].join(", ");

export type PickedClientCsvFile = {
  name: string;
  text: string;
  uri: string;
};

export type ClientImportBatchResult = {
  inserted?: number;
  merged?: number;
  ok?: boolean;
  planLimitSkipped?: number;
  skipped?: number;
  totalRows?: number;
};

export async function pickClientCsvFile(): Promise<PickedClientCsvFile | null> {
  const result = await DocumentPicker.getDocumentAsync({
    copyToCacheDirectory: true,
    type: ["text/csv", "text/comma-separated-values", "*/*"],
  });

  if (result.canceled || !result.assets?.[0]) return null;

  const asset = result.assets[0];
  const text = await FileSystem.readAsStringAsync(asset.uri);

  return {
    name: asset.name || "clients.csv",
    text,
    uri: asset.uri,
  };
}

async function shareClientCsvFile(fileName: string, contents: string) {
  if (!FileSystem.cacheDirectory) {
    throw new Error("File sharing is unavailable on this device.");
  }

  const fileUri = `${FileSystem.cacheDirectory}${fileName}`;
  await FileSystem.writeAsStringAsync(fileUri, contents);
  await Sharing.shareAsync(fileUri, {
    UTI: "public.comma-separated-values-text",
    mimeType: "text/csv",
  });
}

export async function shareClientCsvExport(rows: ClientFieldValues[]) {
  const contents = buildClientCsv(
    rows.map((row) => ({
      birthday: row.birthday,
      email: row.email,
      name: row.name,
      notes: row.notes,
      phone: row.phone,
      rebooking_weeks: row.rebookingWeeks ?? "",
      tag: row.tag,
    })),
  );
  await shareClientCsvFile(getClientCsvExportFileName(), contents);
}

export async function shareClientCsvTemplate() {
  await shareClientCsvFile("schedova-clients-template.csv", buildClientCsvTemplate());
}

export async function fetchActiveClients(userId: string): Promise<ClientDataRecord[]> {
  const { data, error } = await supabase
    .from("clients")
    .select(ACTIVE_CLIENT_SELECT)
    .eq("user_id", userId)
    .is("archived_at", null)
    .order("name");

  if (error) throw error;
  return (((data || []) as unknown) as ClientDataRecord[]).filter(Boolean);
}

export async function shareActiveClientsCsv(userId: string) {
  const clients = await fetchActiveClients(userId);
  const rows = clients.map((client) => ({
    birthday: String(client.birthday || "").trim(),
    email: String(client.email || "").trim().toLocaleLowerCase(),
    name: String(client.name || "").trim(),
    notes: String(client.notes || "").trim(),
    phone: String(client.phone || "").trim(),
    rebookingWeeks:
      typeof client.rebooking_weeks === "number" &&
      Number.isFinite(client.rebooking_weeks) &&
      client.rebooking_weeks > 0
        ? client.rebooking_weeks
        : null,
    tag:
      client.client_tag === "Regular" || client.client_tag === "VIP"
        ? client.client_tag
        : "New",
  })) satisfies ClientFieldValues[];

  await shareClientCsvExport(rows);
  return clients.length;
}

export async function importClientRows(rows: ClientImportRow[]) {
  const { data, error } = await supabase.rpc("import_clients_batch", {
    p_rows: buildClientImportRpcRows(rows),
  });

  if (error) throw error;
  return (data || {}) as ClientImportBatchResult;
}

export async function mergeClientRecords(input: {
  duplicateClientId: string;
  primaryClientId: string;
  values: ClientFieldValues;
}) {
  const { data, error } = await supabase.rpc("merge_client_records", {
    p_birthday: input.values.birthday || null,
    p_client_tag: input.values.tag,
    p_duplicate_client_id: input.duplicateClientId,
    p_email: input.values.email || null,
    p_name: input.values.name || null,
    p_notes: input.values.notes || null,
    p_phone: input.values.phone || null,
    p_primary_client_id: input.primaryClientId,
    p_rebooking_weeks: input.values.rebookingWeeks,
  });

  if (error) throw error;
  return data as { duplicateClientId?: string; ok?: boolean; primaryClientId?: string };
}
