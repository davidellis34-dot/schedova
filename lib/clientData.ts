import { normalizeClientTag, type ClientTag } from "./clientTags";
import { countActiveClients, FREE_TIER_LIMITS } from "./freePlanLimits";

export const CLIENT_CSV_COLUMNS = [
  "name",
  "phone",
  "email",
  "notes",
  "birthday",
  "tag",
  "rebooking_weeks",
] as const;

export const CLIENT_DUPLICATE_KIND_ORDER = {
  strong: 0,
  review: 1,
  possible: 2,
} as const;

export type ClientCsvColumn = (typeof CLIENT_CSV_COLUMNS)[number];

export type ClientCsvMapping = Record<number, ClientCsvColumn | "">;

export type ParsedClientCsv = {
  delimiter: string;
  headers: string[];
  rows: string[][];
};

export type ClientDataRecord = {
  archived_at?: string | null;
  birthday?: string | null;
  client_tag?: string | null;
  email?: string | null;
  email_opt_in?: boolean | null;
  email_opt_in_at?: string | null;
  email_opt_in_source?: string | null;
  id: string;
  name?: string | null;
  notes?: string | null;
  phone?: string | null;
  rebooking_weeks?: number | null;
  sms_opt_in?: boolean | null;
  sms_opt_in_at?: string | null;
  sms_opt_in_source?: string | null;
};

export type ClientFieldValues = {
  birthday: string;
  email: string;
  name: string;
  notes: string;
  phone: string;
  rebookingWeeks: number | null;
  tag: ClientTag;
};

export type ClientImportDuplicateKind = "possible" | "review" | "strong";

export type ClientDuplicateReason =
  | "exact_email"
  | "exact_phone"
  | "same_name_exact_email"
  | "same_name_exact_phone"
  | "same_name_only";

export type ClientDuplicateMatch = {
  kind: ClientImportDuplicateKind;
  matches: ClientDataRecord[];
  reasons: ClientDuplicateReason[];
};

export type ClientImportDecisionAction =
  | "insert"
  | "keep_separate"
  | "merge"
  | "skip";

export type ClientImportRowDecision = {
  action: ClientImportDecisionAction;
  targetClientId?: string | null;
};

export type ClientImportRow = {
  decision: ClientImportRowDecision;
  duplicate: ClientDuplicateMatch | null;
  errors: string[];
  mappedValues: Partial<Record<ClientCsvColumn, string>>;
  mergedValues: ClientFieldValues | null;
  rowNumber: number;
  status: "invalid" | "plan_limit_skip" | "ready" | "skipped";
  values: ClientFieldValues;
};

export type ClientImportPreview = {
  rows: ClientImportRow[];
  summary: {
    invalidRows: number;
    planLimitSkips: number;
    possibleDuplicates: number;
    readyRows: number;
    skippedRows: number;
    totalRows: number;
  };
};

export type ClientDuplicatePair = {
  id: string;
  kind: ClientImportDuplicateKind;
  left: ClientDataRecord;
  reasons: ClientDuplicateReason[];
  right: ClientDataRecord;
};

export type ClientMergeField = keyof ClientFieldValues;

export type ClientMergeChoice = "duplicate" | "primary";

export type ClientMergeDraft = {
  conflicts: ClientMergeField[];
  choices: Record<ClientMergeField, ClientMergeChoice>;
  values: ClientFieldValues;
};

const CLIENT_MERGE_FIELDS: ClientMergeField[] = [
  "name",
  "phone",
  "email",
  "notes",
  "birthday",
  "tag",
  "rebookingWeeks",
];

type PhoneNormalizer = (
  value: string | null | undefined,
) => Promise<string> | string;

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const CLIENT_IMPORT_TEMPLATE_ROW: Record<ClientCsvColumn, string> = {
  birthday: "",
  email: "",
  name: "",
  notes: "",
  phone: "",
  rebooking_weeks: "",
  tag: "",
};

const HEADER_ALIASES = new Map<string, ClientCsvColumn>([
  ["birthday", "birthday"],
  ["birthdate", "birthday"],
  ["client email", "email"],
  ["client name", "name"],
  ["client notes", "notes"],
  ["client tag", "tag"],
  ["contact email", "email"],
  ["contact name", "name"],
  ["customer email", "email"],
  ["customer name", "name"],
  ["dob", "birthday"],
  ["e mail", "email"],
  ["email", "email"],
  ["email address", "email"],
  ["full name", "name"],
  ["mobile", "phone"],
  ["mobile number", "phone"],
  ["name", "name"],
  ["note", "notes"],
  ["notes", "notes"],
  ["phone", "phone"],
  ["phone number", "phone"],
  ["rebooking interval weeks", "rebooking_weeks"],
  ["rebooking weeks", "rebooking_weeks"],
  ["rebooking_weeks", "rebooking_weeks"],
  ["return weeks", "rebooking_weeks"],
  ["tag", "tag"],
  ["weeks between visits", "rebooking_weeks"],
]);

function cleanString(value: unknown) {
  return String(value || "").trim();
}

function normalizeName(value: unknown) {
  return cleanString(value).replace(/\s+/g, " ").toLocaleLowerCase();
}

function normalizePhoneDigits(value: unknown) {
  return cleanString(value).replace(/\D/g, "");
}

function normalizeEmail(value: unknown) {
  return cleanString(value).toLocaleLowerCase();
}

function normalizeHeaderKey(value: string) {
  return cleanString(value)
    .toLocaleLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ");
}

function detectCsvDelimiter(text: string) {
  const sample = String(text || "").replace(/^\uFEFF/, "");
  let inQuotes = false;
  const counts = {
    ",": 0,
    ";": 0,
    "\t": 0,
  };

  for (let index = 0; index < sample.length; index += 1) {
    const character = sample[index];
    if (character === '"') {
      if (inQuotes && sample[index + 1] === '"') {
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (!inQuotes && character === "\n") break;
    if (!inQuotes && (character === "," || character === ";" || character === "\t")) {
      counts[character] += 1;
    }
  }

  return Object.entries(counts).sort((left, right) => right[1] - left[1])[0]?.[0] || ",";
}

function uniqueReasons(reasons: ClientDuplicateReason[]) {
  return Array.from(new Set(reasons));
}

function normalizeBirthday(value: unknown) {
  const trimmed = cleanString(value);
  if (!trimmed) return "";

  const digitsOnly = trimmed.replace(/\D/g, "");
  if (digitsOnly.length === 4) {
    return `${digitsOnly.slice(0, 2)}/${digitsOnly.slice(2, 4)}`;
  }

  const matched = trimmed.match(/^(\d{1,2})[\/\-.](\d{1,2})$/);
  if (matched) {
    return `${matched[1].padStart(2, "0")}/${matched[2].padStart(2, "0")}`;
  }

  return trimmed;
}

function parseRebookingWeeks(value: unknown) {
  const trimmed = cleanString(value);
  if (!trimmed) return null;

  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed)) return null;

  const rounded = Math.round(parsed);
  return rounded > 0 ? rounded : null;
}

function hasIdentifier(values: ClientFieldValues) {
  return Boolean(values.name || values.phone || values.email);
}

function getFieldValue(client: ClientDataRecord, field: ClientMergeField) {
  switch (field) {
    case "birthday":
      return normalizeBirthday(client.birthday);
    case "email":
      return normalizeEmail(client.email);
    case "name":
      return cleanString(client.name).replace(/\s+/g, " ");
    case "notes":
      return cleanString(client.notes);
    case "phone":
      return cleanString(client.phone);
    case "rebookingWeeks":
      return parseRebookingWeeks(client.rebooking_weeks);
    case "tag":
      return normalizeClientTag(client.client_tag);
    default:
      return "";
  }
}

function valuesEquivalent(
  field: ClientMergeField,
  primary: ClientDataRecord,
  duplicate: ClientDataRecord,
) {
  const left = getFieldValue(primary, field);
  const right = getFieldValue(duplicate, field);

  if (field === "email") return normalizeEmail(left) === normalizeEmail(right);
  if (field === "name") return normalizeName(left) === normalizeName(right);
  if (field === "phone") return normalizePhoneDigits(left) === normalizePhoneDigits(right);
  return left === right;
}

export function isValidOptionalEmail(value: string) {
  return !value || EMAIL_PATTERN.test(value);
}

export function parseClientCsv(text: string): ParsedClientCsv {
  const delimiter = detectCsvDelimiter(text);
  const normalized = String(text || "")
    .replace(/^\uFEFF/, "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n");
  const rows: string[][] = [];
  let currentCell = "";
  let currentRow: string[] = [];
  let inQuotes = false;

  for (let index = 0; index < normalized.length; index += 1) {
    const character = normalized[index];

    if (character === '"') {
      if (inQuotes && normalized[index + 1] === '"') {
        currentCell += '"';
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (!inQuotes && character === delimiter) {
      currentRow.push(currentCell);
      currentCell = "";
      continue;
    }

    if (!inQuotes && character === "\n") {
      currentRow.push(currentCell);
      rows.push(currentRow);
      currentCell = "";
      currentRow = [];
      continue;
    }

    currentCell += character;
  }

  currentRow.push(currentCell);
  rows.push(currentRow);

  while (rows.length > 0 && rows[rows.length - 1].every((value) => cleanString(value) === "")) {
    rows.pop();
  }

  const [headers = [], ...body] = rows;
  const width = Math.max(
    headers.length,
    ...body.map((row) => row.length),
  );

  const normalizeRowWidth = (row: string[]) =>
    Array.from({ length: width }, (_, index) => row[index] ?? "");

  return {
    delimiter,
    headers: normalizeRowWidth(headers),
    rows: body.map(normalizeRowWidth),
  };
}

export function inferClientCsvMapping(headers: string[]): ClientCsvMapping {
  const nextMapping: ClientCsvMapping = {};
  const usedFields = new Set<ClientCsvColumn>();

  headers.forEach((header, index) => {
    const inferred = HEADER_ALIASES.get(normalizeHeaderKey(header)) || "";
    if (inferred && !usedFields.has(inferred)) {
      nextMapping[index] = inferred;
      usedFields.add(inferred);
      return;
    }

    nextMapping[index] = "";
  });

  return nextMapping;
}

export function shouldShowManualClientCsvMapping(input: {
  headers: string[];
  mapping: ClientCsvMapping;
  rows: string[][];
}) {
  const mappedIdentifierFields = new Set<ClientCsvColumn>();
  const hasData = input.rows.some((row) => row.some((value) => cleanString(value)));

  Object.values(input.mapping).forEach((field) => {
    if (field === "name" || field === "phone" || field === "email") {
      mappedIdentifierFields.add(field);
    }
  });

  return hasData && mappedIdentifierFields.size === 0 && input.headers.some((header) => cleanString(header));
}

export function mapClientCsvRow(
  row: string[],
  mapping: ClientCsvMapping,
): Partial<Record<ClientCsvColumn, string>> {
  return row.reduce<Partial<Record<ClientCsvColumn, string>>>((result, value, index) => {
    const field = mapping[index];
    if (field) {
      result[field] = value;
    }
    return result;
  }, {});
}

export async function normalizeClientImportValues(
  mappedValues: Partial<Record<ClientCsvColumn, string>>,
  phoneNormalizer: PhoneNormalizer,
): Promise<ClientFieldValues> {
  const rawPhone = cleanString(mappedValues.phone);
  const normalizedPhone = rawPhone ? await phoneNormalizer(rawPhone) : "";
  return {
    birthday: normalizeBirthday(mappedValues.birthday),
    email: normalizeEmail(mappedValues.email),
    name: cleanString(mappedValues.name).replace(/\s+/g, " "),
    notes: cleanString(mappedValues.notes),
    phone: cleanString(normalizedPhone),
    rebookingWeeks: parseRebookingWeeks(mappedValues.rebooking_weeks),
    tag: normalizeClientTag(cleanString(mappedValues.tag)),
  };
}

export function getDefaultClientImportDecision(
  duplicate: ClientDuplicateMatch | null,
): ClientImportRowDecision {
  if (!duplicate) {
    return { action: "insert", targetClientId: null };
  }

  if (duplicate.kind === "strong") {
    return {
      action: "merge",
      targetClientId: duplicate.matches.length === 1 ? duplicate.matches[0].id : null,
    };
  }

  if (duplicate.kind === "possible") {
    return { action: "keep_separate", targetClientId: null };
  }

  return { action: "skip", targetClientId: null };
}

export function classifyClientDuplicateMatch(
  imported: ClientFieldValues,
  existingClients: ClientDataRecord[],
): ClientDuplicateMatch | null {
  const importedName = normalizeName(imported.name);
  const importedPhone = normalizePhoneDigits(imported.phone);
  const importedEmail = normalizeEmail(imported.email);
  const strongMatches: ClientDataRecord[] = [];
  const reviewMatches: ClientDataRecord[] = [];
  const possibleMatches: ClientDataRecord[] = [];
  const strongReasons: ClientDuplicateReason[] = [];
  const reviewReasons: ClientDuplicateReason[] = [];
  const possibleReasons: ClientDuplicateReason[] = [];

  for (const existing of existingClients.filter((client) => !client.archived_at)) {
    const existingName = normalizeName(existing.name);
    const existingPhone = normalizePhoneDigits(existing.phone);
    const existingEmail = normalizeEmail(existing.email);
    const nameMatches = Boolean(importedName) && importedName === existingName;
    const phoneMatches = Boolean(importedPhone) && importedPhone === existingPhone;
    const emailMatches = Boolean(importedEmail) && importedEmail === existingEmail;

    if (phoneMatches || emailMatches) {
      const reasons: ClientDuplicateReason[] = [];
      if (phoneMatches) {
        reasons.push(nameMatches ? "same_name_exact_phone" : "exact_phone");
      }
      if (emailMatches) {
        reasons.push(nameMatches ? "same_name_exact_email" : "exact_email");
      }

      if (!importedName || !existingName || nameMatches) {
        strongMatches.push(existing);
        strongReasons.push(...reasons);
      } else {
        reviewMatches.push(existing);
        reviewReasons.push(...reasons);
      }
      continue;
    }

    if (nameMatches) {
      possibleMatches.push(existing);
      possibleReasons.push("same_name_only");
    }
  }

  if (reviewMatches.length > 0) {
    return {
      kind: "review",
      matches: reviewMatches,
      reasons: uniqueReasons(reviewReasons),
    };
  }

  if (strongMatches.length > 0) {
    return {
      kind: "strong",
      matches: strongMatches,
      reasons: uniqueReasons(strongReasons),
    };
  }

  if (possibleMatches.length > 0) {
    return {
      kind: "possible",
      matches: possibleMatches,
      reasons: uniqueReasons(possibleReasons),
    };
  }

  return null;
}

export function resolveImportedClientMergeValues(
  existing: ClientDataRecord,
  imported: ClientFieldValues,
): ClientFieldValues {
  const existingName = cleanString(existing.name).replace(/\s+/g, " ");
  const existingPhone = cleanString(existing.phone);
  const existingEmail = normalizeEmail(existing.email);
  const existingNotes = cleanString(existing.notes);
  const existingBirthday = normalizeBirthday(existing.birthday);
  const existingTag = normalizeClientTag(existing.client_tag);
  const existingWeeks = parseRebookingWeeks(existing.rebooking_weeks);

  const combinedNotes =
    existingNotes && imported.notes && existingNotes !== imported.notes
      ? `${existingNotes}\n\n${imported.notes}`
      : existingNotes || imported.notes;

  return {
    birthday: existingBirthday || imported.birthday,
    email: existingEmail || imported.email,
    name: existingName || imported.name || imported.phone || imported.email,
    notes: combinedNotes,
    phone: existingPhone || imported.phone,
    rebookingWeeks: existingWeeks || imported.rebookingWeeks,
    tag:
      existingTag !== "New"
        ? existingTag
        : imported.tag !== "New"
          ? imported.tag
          : existingTag,
  };
}

export async function buildClientImportPreview(input: {
  decisions?: Record<number, ClientImportRowDecision>;
  existingClients: ClientDataRecord[];
  isUnlimited: boolean;
  limit?: number;
  mapping: ClientCsvMapping;
  parsed: ParsedClientCsv;
  phoneNormalizer: PhoneNormalizer;
}): Promise<ClientImportPreview> {
  const rows: ClientImportRow[] = await Promise.all(
    input.parsed.rows.map(async (row, index) => {
      const rowNumber = index + 2;
      const mappedValues = mapClientCsvRow(row, input.mapping);
      const values = await normalizeClientImportValues(
        mappedValues,
        input.phoneNormalizer,
      );
      const errors: string[] = [];

      if (!hasIdentifier(values)) {
        errors.push("Add at least a name, phone number, or email.");
      }
      if (!isValidOptionalEmail(values.email)) {
        errors.push("Enter a valid email address or leave email blank.");
      }
      if (cleanString(mappedValues.rebooking_weeks) && !values.rebookingWeeks) {
        errors.push("Rebooking weeks must be a whole number greater than zero.");
      }

      const duplicate = errors.length
        ? null
        : classifyClientDuplicateMatch(values, input.existingClients);
      const decision = {
        ...getDefaultClientImportDecision(duplicate),
        ...(input.decisions?.[rowNumber] || {}),
      };
      const targetClientId = cleanString(decision.targetClientId);
      const targetClient =
        duplicate?.matches.find((client) => cleanString(client.id) === targetClientId) || null;
      if (decision.action === "merge" && !targetClient) {
        errors.push("Choose the existing client to merge with.");
      }

      return {
        decision: {
          action: decision.action,
          targetClientId: targetClient?.id || null,
        },
        duplicate,
        errors,
        mappedValues,
        mergedValues:
          decision.action === "merge" && targetClient
            ? resolveImportedClientMergeValues(targetClient, values)
            : null,
        rowNumber,
        status: errors.length > 0 ? "invalid" : "ready",
        values,
      } satisfies ClientImportRow;
    }),
  );

  let remainingSlots = input.isUnlimited
    ? Number.MAX_SAFE_INTEGER
    : Math.max(
        (input.limit ?? FREE_TIER_LIMITS.clients) -
          countActiveClients(input.existingClients),
        0,
      );
  let invalidRows = 0;
  let readyRows = 0;
  let skippedRows = 0;
  let planLimitSkips = 0;

  rows.forEach((row) => {
    if (row.errors.length > 0) {
      row.status = "invalid";
      invalidRows += 1;
      return;
    }

    if (row.decision.action === "skip") {
      row.status = "skipped";
      skippedRows += 1;
      return;
    }

    if (row.decision.action === "merge") {
      row.status = "ready";
      readyRows += 1;
      return;
    }

    if (remainingSlots <= 0) {
      row.status = "plan_limit_skip";
      planLimitSkips += 1;
      return;
    }

    remainingSlots -= 1;
    row.status = "ready";
    readyRows += 1;
  });

  return {
    rows,
    summary: {
      invalidRows,
      planLimitSkips,
      possibleDuplicates: rows.filter((row) => row.duplicate).length,
      readyRows,
      skippedRows,
      totalRows: rows.length,
    },
  };
}

export function buildClientImportRpcRows(rows: ClientImportRow[]) {
  return rows.map((row) => ({
    action:
      row.status === "invalid" || row.status === "plan_limit_skip"
        ? "skip"
        : row.decision.action === "keep_separate"
          ? "keep_separate"
          : row.decision.action,
    birthday:
      (row.mergedValues || row.values).birthday || null,
    client_tag: (row.mergedValues || row.values).tag || "New",
    email: (row.mergedValues || row.values).email || null,
    merge_target_client_id:
      row.decision.action === "merge" ? row.decision.targetClientId || null : null,
    name: (row.mergedValues || row.values).name || null,
    notes: (row.mergedValues || row.values).notes || null,
    phone: (row.mergedValues || row.values).phone || null,
    rebooking_weeks: (row.mergedValues || row.values).rebookingWeeks,
    row_number: row.rowNumber,
  }));
}

export function escapeCsvCell(value: unknown) {
  const stringValue = String(value ?? "");
  if (!/[",\n\r]/.test(stringValue)) return stringValue;
  return `"${stringValue.replace(/"/g, '""')}"`;
}

export function buildClientCsv(columns: Record<ClientCsvColumn, unknown>[]) {
  const headerLine = CLIENT_CSV_COLUMNS.join(",");
  const lines = columns.map((row) =>
    CLIENT_CSV_COLUMNS.map((column) => escapeCsvCell(row[column] ?? "")).join(","),
  );
  return [headerLine, ...lines].join("\r\n");
}

export function buildClientCsvTemplate() {
  return buildClientCsv([CLIENT_IMPORT_TEMPLATE_ROW]);
}

export function getClientCsvExportFileName(now = new Date()) {
  const year = now.getFullYear();
  const month = `${now.getMonth() + 1}`.padStart(2, "0");
  const day = `${now.getDate()}`.padStart(2, "0");
  return `schedova-clients-${year}-${month}-${day}.csv`;
}

export function buildDuplicateClientPairs(clients: ClientDataRecord[]) {
  const activeClients = clients.filter((client) => !client.archived_at && cleanString(client.id));
  const pairs: ClientDuplicatePair[] = [];

  for (let leftIndex = 0; leftIndex < activeClients.length; leftIndex += 1) {
    for (
      let rightIndex = leftIndex + 1;
      rightIndex < activeClients.length;
      rightIndex += 1
    ) {
      const left = activeClients[leftIndex];
      const right = activeClients[rightIndex];
      const duplicate = classifyClientDuplicateMatch(
        {
          birthday: normalizeBirthday(left.birthday),
          email: normalizeEmail(left.email),
          name: cleanString(left.name),
          notes: cleanString(left.notes),
          phone: cleanString(left.phone),
          rebookingWeeks: parseRebookingWeeks(left.rebooking_weeks),
          tag: normalizeClientTag(left.client_tag),
        },
        [right],
      );

      if (!duplicate) continue;

      pairs.push({
        id: [left.id, right.id].sort().join(":"),
        kind: duplicate.kind,
        left,
        reasons: duplicate.reasons,
        right,
      });
    }
  }

  return pairs.sort((left, right) => {
    const kindDelta =
      CLIENT_DUPLICATE_KIND_ORDER[left.kind] - CLIENT_DUPLICATE_KIND_ORDER[right.kind];
    if (kindDelta !== 0) return kindDelta;

    return `${cleanString(left.left.name)}${cleanString(left.right.name)}`.localeCompare(
      `${cleanString(right.left.name)}${cleanString(right.right.name)}`,
    );
  });
}

export function buildClientMergeDraft(
  primary: ClientDataRecord,
  duplicate: ClientDataRecord,
  overrides: Partial<Record<ClientMergeField, ClientMergeChoice>> = {},
): ClientMergeDraft {
  const conflicts: ClientMergeField[] = [];
  const choices = {} as Record<ClientMergeField, ClientMergeChoice>;
  const values = {} as ClientFieldValues;

  CLIENT_MERGE_FIELDS.forEach((field) => {
    const primaryValue = getFieldValue(primary, field);
    const duplicateValue = getFieldValue(duplicate, field);
    const hasPrimary = primaryValue !== null && primaryValue !== "";
    const hasDuplicate = duplicateValue !== null && duplicateValue !== "";

    if (!hasPrimary && !hasDuplicate) {
      choices[field] = "primary";
      switch (field) {
        case "rebookingWeeks":
          values.rebookingWeeks = null;
          break;
        case "tag":
          values.tag = "New";
          break;
        case "birthday":
          values.birthday = "";
          break;
        case "email":
          values.email = "";
          break;
        case "name":
          values.name = "";
          break;
        case "notes":
          values.notes = "";
          break;
        case "phone":
          values.phone = "";
          break;
      }
      return;
    }

    if (!hasPrimary || !hasDuplicate || valuesEquivalent(field, primary, duplicate)) {
      choices[field] = hasPrimary ? "primary" : "duplicate";
      values[field] = (hasPrimary ? primaryValue : duplicateValue) as never;
      return;
    }

    conflicts.push(field);
    choices[field] = overrides[field] || "primary";
    values[field] =
      choices[field] === "primary"
        ? (primaryValue as never)
        : (duplicateValue as never);
  });

  if (!values.name) {
    values.name = values.phone || values.email || "Client";
  }

  return { conflicts, choices, values };
}

export function getMergedClientConsent(input: {
  primary: ClientDataRecord;
  values: ClientFieldValues;
}) {
  return {
    emailOptIn: Boolean(input.primary.email_opt_in && input.values.email),
    smsOptIn: Boolean(input.primary.sms_opt_in && input.values.phone),
  };
}
