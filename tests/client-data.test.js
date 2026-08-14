const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildClientCsv,
  buildClientImportPreview,
  buildClientMergeDraft,
  classifyClientDuplicateMatch,
  escapeCsvCell,
  getMergedClientConsent,
  inferClientCsvMapping,
  normalizeClientImportValues,
  parseClientCsv,
  resolveImportedClientMergeValues,
} = require("../lib/clientData.ts");

test("CSV parsing keeps quoted commas, quotes, and newlines intact", () => {
  const parsed = parseClientCsv(
    'Full Name,Phone Number,Notes\n"Ava, Jones","(555) 111-2222","Line 1\nLine 2"\n"Chris ""CJ"" Ray",,Simple',
  );

  assert.deepEqual(parsed.headers.slice(0, 3), [
    "Full Name",
    "Phone Number",
    "Notes",
  ]);
  assert.equal(parsed.rows[0][0], "Ava, Jones");
  assert.equal(parsed.rows[0][1], "(555) 111-2222");
  assert.equal(parsed.rows[0][2], "Line 1\nLine 2");
  assert.equal(parsed.rows[1][0], 'Chris "CJ" Ray');
});

test("CSV escaping quotes values that contain commas, quotes, or newlines", () => {
  assert.equal(escapeCsvCell("Simple"), "Simple");
  assert.equal(escapeCsvCell('A "quoted" client'), '"A ""quoted"" client"');
  assert.equal(escapeCsvCell("Comma, here"), '"Comma, here"');

  const csv = buildClientCsv([
    {
      birthday: "",
      email: "jamie@example.com",
      name: "Jamie Smith",
      notes: 'Line 1, "Line 2"',
      phone: "+15551112222",
      rebooking_weeks: 6,
      tag: "VIP",
    },
  ]);

  assert.match(csv, /"Line 1, ""Line 2"""/);
});

test("header mapping recognizes common client CSV variations", () => {
  const mapping = inferClientCsvMapping([
    "Full Name",
    "Mobile",
    "Email Address",
    "Client Notes",
    "Birthday",
    "Tag",
    "Rebooking Weeks",
  ]);

  assert.equal(mapping[0], "name");
  assert.equal(mapping[1], "phone");
  assert.equal(mapping[2], "email");
  assert.equal(mapping[3], "notes");
  assert.equal(mapping[4], "birthday");
  assert.equal(mapping[5], "tag");
  assert.equal(mapping[6], "rebooking_weeks");
});

test("phone and email normalization reuse existing rules for import rows", async () => {
  const values = await normalizeClientImportValues(
    {
      birthday: "7-4",
      email: " TEST@Example.COM ",
      name: " Jamie   Smith ",
      notes: "  First visit  ",
      phone: "555-111-2222",
      rebooking_weeks: "8",
      tag: "VIP",
    },
    async (value) => `+1${String(value).replace(/\D/g, "")}`,
  );

  assert.equal(values.name, "Jamie Smith");
  assert.equal(values.phone, "+15551112222");
  assert.equal(values.email, "test@example.com");
  assert.equal(values.birthday, "07/04");
  assert.equal(values.notes, "First visit");
  assert.equal(values.rebookingWeeks, 8);
  assert.equal(values.tag, "VIP");
});

test("duplicate classification distinguishes strong, review, and possible matches", () => {
  const existing = [
    { id: "strong", name: "Jamie Smith", phone: "+15551112222", email: "" },
    { id: "review", name: "Taylor Jones", phone: "+15553334444", email: "" },
    { id: "possible", name: "Alex Green", phone: "", email: "" },
  ];

  const strong = classifyClientDuplicateMatch(
    {
      birthday: "",
      email: "",
      name: "Jamie Smith",
      notes: "",
      phone: "+15551112222",
      rebookingWeeks: null,
      tag: "New",
    },
    existing,
  );
  const review = classifyClientDuplicateMatch(
    {
      birthday: "",
      email: "",
      name: "Jordan Blake",
      notes: "",
      phone: "+15553334444",
      rebookingWeeks: null,
      tag: "New",
    },
    existing,
  );
  const possible = classifyClientDuplicateMatch(
    {
      birthday: "",
      email: "",
      name: "Alex Green",
      notes: "",
      phone: "",
      rebookingWeeks: null,
      tag: "New",
    },
    existing,
  );

  assert.equal(strong?.kind, "strong");
  assert.deepEqual(strong?.matches.map((client) => client.id), ["strong"]);
  assert.equal(review?.kind, "review");
  assert.deepEqual(review?.matches.map((client) => client.id), ["review"]);
  assert.equal(possible?.kind, "possible");
  assert.deepEqual(possible?.matches.map((client) => client.id), ["possible"]);
});

test("import merge resolution preserves existing data and appends distinct notes", () => {
  const merged = resolveImportedClientMergeValues(
    {
      id: "client-1",
      birthday: "02/14",
      client_tag: "Regular",
      email: "jamie@example.com",
      name: "Jamie Smith",
      notes: "Prefers mornings",
      phone: "+15551112222",
      rebooking_weeks: 6,
    },
    {
      birthday: "",
      email: "jamie@example.com",
      name: "Jamie Smith",
      notes: "VIP from old system",
      phone: "",
      rebookingWeeks: 8,
      tag: "VIP",
    },
  );

  assert.equal(merged.name, "Jamie Smith");
  assert.equal(merged.phone, "+15551112222");
  assert.equal(merged.email, "jamie@example.com");
  assert.equal(merged.birthday, "02/14");
  assert.equal(merged.rebookingWeeks, 6);
  assert.equal(merged.tag, "Regular");
  assert.equal(merged.notes, "Prefers mornings\n\nVIP from old system");
});

test("merge-field resolution defaults conflicts to the chosen primary record", () => {
  const draft = buildClientMergeDraft(
    {
      id: "primary",
      birthday: "02/14",
      client_tag: "Regular",
      email: "primary@example.com",
      email_opt_in: false,
      name: "Jamie Smith",
      notes: "Primary note",
      phone: "+15551112222",
      rebooking_weeks: 6,
      sms_opt_in: true,
    },
    {
      id: "duplicate",
      birthday: "03/01",
      client_tag: "VIP",
      email: "duplicate@example.com",
      email_opt_in: true,
      name: "Jamie Smith",
      notes: "Duplicate note",
      phone: "+15553334444",
      rebooking_weeks: 8,
      sms_opt_in: true,
    },
  );

  assert.ok(draft.conflicts.includes("phone"));
  assert.ok(draft.conflicts.includes("email"));
  assert.equal(draft.choices.phone, "primary");
  assert.equal(draft.values.phone, "+15551112222");
  assert.equal(draft.values.email, "primary@example.com");

  const consent = getMergedClientConsent({
    primary: {
      id: "primary",
      email_opt_in: false,
      sms_opt_in: true,
    },
    values: draft.values,
  });

  assert.equal(consent.smsOptIn, true);
  assert.equal(consent.emailOptIn, false);
});

test("import preview reports invalid rows, duplicate rows, and free-plan skips", async () => {
  const parsed = parseClientCsv(
    "Full Name,Mobile,Email Address\nJordan,+15550000001,\nTaylor,+15550000002,\n,,\nJamie Smith,+15551112222,\nChris,+15550000003,",
  );
  const mapping = inferClientCsvMapping(parsed.headers);
  const existingClients = Array.from({ length: 24 }, (_, index) => ({
    id: `existing-${index}`,
    archived_at: null,
    email: "",
    name: `Client ${index}`,
    phone: `+16660000${String(index).padStart(3, "0")}`,
  })).concat([
    {
      id: "match-1",
      archived_at: null,
      email: "",
      name: "Jamie Smith",
      phone: "+15551112222",
    },
  ]);

  const preview = await buildClientImportPreview({
    existingClients,
    isUnlimited: false,
    mapping,
    parsed,
    phoneNormalizer: async (value) => String(value).trim(),
  });

  assert.equal(preview.summary.totalRows, 5);
  assert.equal(preview.summary.invalidRows, 1);
  assert.equal(preview.summary.possibleDuplicates, 1);
  assert.equal(preview.summary.planLimitSkips, 3);
  assert.equal(preview.summary.readyRows, 1);
  assert.equal(preview.rows[0].status, "plan_limit_skip");
  assert.equal(preview.rows[2].status, "invalid");
  assert.equal(preview.rows[3].decision.action, "merge");
  assert.equal(preview.rows[3].status, "ready");
  assert.equal(preview.rows[4].status, "plan_limit_skip");
});
