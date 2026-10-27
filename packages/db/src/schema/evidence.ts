/**
 * Evidence group (register §7): documents, extraction_reads, slip_rows, slip_fields, deduction_marks,
 * slip_anomalies.
 *
 * I2 lives in SQL (migrations/0002): a `slip_rows` row needs a ratified rate card for its season, may not be
 * written before `ratified_at`, and may not be dated before the ratification date in the season's zone
 * (`FS422 RULES_BEFORE_FACTS`).
 */
import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  date,
  doublePrecision,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import {
  bytea,
  cents,
  checkCurrency,
  checkIn,
  checkProvenance,
  checkSha,
  createdAt,
  currency,
  grams,
  id,
  provenance,
  sha256,
  tstz,
  updatedAt,
  version,
  wsFk,
  wsIdUnique,
} from "./_columns.js";
import { members, seasons } from "./coop.js";
import { llmCalls } from "./llm.js";
import { workspaceId } from "./workspace.js";

export const DOCUMENT_KINDS = [
  "slip_photo",
  "slip_page",
  "logbook_page",
  "rate_card_pdf",
  "rate_card_page",
] as const;
export const DOCUMENT_STORAGE = ["static", "db"] as const;

export const documents = pgTable(
  "documents",
  {
    id: id(),
    workspaceId: workspaceId(),
    seasonId: uuid("season_id"),
    kind: text("kind", { enum: DOCUMENT_KINDS }).notNull(),
    sha256: sha256("sha256").notNull(),
    /** 64-bit dHash as 16 hex characters */
    phash: text("phash"),
    storage: text("storage", { enum: DOCUMENT_STORAGE }).notNull(),
    /** static storage: path under /media (IC-11), e.g. photos/B.webp */
    path: text("path"),
    /** db storage: the bytes (clerk captures) */
    bytes: bytea("bytes"),
    byteSize: integer("byte_size").notNull(),
    mime: text("mime").notNull(),
    width: integer("width"),
    height: integer("height"),
    /** client-side UUIDv7 of a mobile capture (idempotency: same id → no-op) */
    captureId: uuid("capture_id"),
    exactDuplicateOf: uuid("exact_duplicate_of"),
    /** white | pink | yellow carbon copy */
    copyColor: text("copy_color"),
    templateSerial: text("template_serial"),
    /** A..L, P01..P54 */
    photoCode: text("photo_code"),
    capturedAt: tstz("captured_at"),
    capturedBy: text("captured_by"),
    provenance: provenance(),
    createdAt: createdAt(),
  },
  (t) => [
    checkIn("documents_kind_ck", t.kind, DOCUMENT_KINDS),
    checkIn("documents_storage_ck", t.storage, DOCUMENT_STORAGE),
    checkSha("documents_sha256_ck", t.sha256),
    check("documents_phash_ck", sql`${t.phash} is null or ${t.phash} ~ '^[0-9a-f]{16}$'`),
    check(
      "documents_storage_payload_ck",
      sql`(${t.storage} = 'static' and ${t.path} is not null) or (${t.storage} = 'db' and ${t.bytes} is not null)`,
    ),
    check("documents_byte_size_ck", sql`${t.byteSize} >= 0`),
    checkProvenance("documents", t.provenance),
    unique("documents_capture_uq").on(t.workspaceId, t.captureId),
    index("documents_sha256_idx").on(t.workspaceId, t.sha256),
    wsIdUnique("documents", t),
    wsFk("documents_season_fk", t, t.seasonId, seasons),
    wsFk("documents_exact_duplicate_fk", t, t.exactDuplicateOf, { workspaceId: t.workspaceId, id: t.id }),
  ],
);

export const READ_VARIANTS = ["A", "B", "ZOOM"] as const;

export const extractionReads = pgTable(
  "extraction_reads",
  {
    id: id(),
    workspaceId: workspaceId(),
    documentId: uuid("document_id").notNull(),
    variant: text("variant", { enum: READ_VARIANTS }).notNull(),
    llmCallId: uuid("llm_call_id"),
    model: text("model").notNull(),
    modelServed: text("model_served"),
    effort: text("effort").notNull(),
    promptV: text("prompt_v").notNull(),
    schemaV: text("schema_v").notNull(),
    cacheKey: text("cache_key").notNull(),
    stopReason: text("stop_reason"),
    rawContent: jsonb("raw_content"),
    costMicros: bigint("cost_micros", { mode: "bigint" }).notNull(),
    provenance: provenance(),
    createdAt: createdAt(),
  },
  (t) => [
    checkIn("extraction_reads_variant_ck", t.variant, READ_VARIANTS),
    checkSha("extraction_reads_cache_key_ck", t.cacheKey),
    checkProvenance("extraction_reads", t.provenance),
    index("extraction_reads_document_idx").on(t.workspaceId, t.documentId),
    wsIdUnique("extraction_reads", t),
    wsFk("extraction_reads_document_fk", t, t.documentId, documents),
    // recordings are shared across workspaces, so this one reference is by id alone
    foreignKey({
      name: "extraction_reads_llm_call_fk",
      columns: [t.llmCallId],
      foreignColumns: [llmCalls.id],
    }).onDelete("set null"),
  ],
);

export const SLIP_ROW_STATES = ["AUTO_ACCEPTED", "NEEDS_HUMAN", "CONFIRMED", "REJECTED"] as const;

export const slipRows = pgTable(
  "slip_rows",
  {
    id: id(),
    workspaceId: workspaceId(),
    seasonId: uuid("season_id").notNull(),
    documentId: uuid("document_id").notNull(),
    /** printed serial, e.g. 0403 */
    serial: text("serial").notNull(),
    rowNo: integer("row_no").notNull(),
    memberId: uuid("member_id"),
    slipDate: date("slip_date"),
    grossG: grams("gross_g"),
    tareG: grams("tare_g"),
    netG: grams("net_g"),
    grade: text("grade"),
    minConfidence: doublePrecision("min_confidence"),
    state: text("state", { enum: SLIP_ROW_STATES }).notNull(),
    /** reviewed fixture rectangle (C-10): the only source of provenance crops */
    cropRect: jsonb("crop_rect"),
    copyColor: text("copy_color"),
    version: version(),
    provenance: provenance(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    checkIn("slip_rows_state_ck", t.state, SLIP_ROW_STATES),
    check("slip_rows_date_ck", sql`${t.slipDate} is not null or ${t.state} in ('NEEDS_HUMAN', 'REJECTED')`),
    check("slip_rows_confidence_ck", sql`${t.minConfidence} is null or ${t.minConfidence} between 0 and 1`),
    check(
      "slip_rows_grams_ck",
      sql`coalesce(${t.netG}, 0) >= 0 and coalesce(${t.grossG}, 0) >= 0 and coalesce(${t.tareG}, 0) >= 0`,
    ),
    check("slip_rows_row_no_ck", sql`${t.rowNo} >= 1`),
    checkProvenance("slip_rows", t.provenance),
    unique("slip_rows_document_row_uq").on(t.documentId, t.serial, t.rowNo),
    index("slip_rows_serial_idx").on(t.workspaceId, t.serial),
    index("slip_rows_member_idx").on(t.workspaceId, t.memberId),
    wsIdUnique("slip_rows", t),
    wsFk("slip_rows_season_fk", t, t.seasonId, seasons),
    wsFk("slip_rows_document_fk", t, t.documentId, documents),
    wsFk("slip_rows_member_fk", t, t.memberId, members),
  ],
);

export const DECIDED_BY = ["agreement", "zoom", "person"] as const;

export const slipFields = pgTable(
  "slip_fields",
  {
    id: id(),
    workspaceId: workspaceId(),
    slipRowId: uuid("slip_row_id").notNull(),
    field: text("field").notNull(),
    readA: jsonb("read_a"),
    readB: jsonb("read_b"),
    zoom: jsonb("zoom"),
    legibility: text("legibility"),
    agreement: doublePrecision("agreement"),
    finalValue: text("final_value"),
    decidedBy: text("decided_by", { enum: DECIDED_BY }),
    decidedByActor: text("decided_by_actor"),
    decidedAt: tstz("decided_at"),
    provenance: provenance(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    checkIn("slip_fields_decided_by_ck", t.decidedBy, DECIDED_BY),
    check("slip_fields_agreement_ck", sql`${t.agreement} is null or ${t.agreement} between 0 and 1`),
    checkProvenance("slip_fields", t.provenance),
    unique("slip_fields_field_uq").on(t.slipRowId, t.field),
    wsIdUnique("slip_fields", t),
    wsFk("slip_fields_row_fk", t, t.slipRowId, slipRows),
  ],
);

export const deductionMarks = pgTable(
  "deduction_marks",
  {
    id: id(),
    workspaceId: workspaceId(),
    slipRowId: uuid("slip_row_id").notNull(),
    textVerbatim: text("text_verbatim").notNull(),
    /** a ratified rule id (R1..), or NO_MATCH, or null before classification */
    ruleId: text("rule_id"),
    writtenCents: cents("written_cents"),
    currency: currency().notNull(),
    provenance: provenance(),
    createdAt: createdAt(),
  },
  (t) => [
    check("deduction_marks_rule_id_ck", sql`${t.ruleId} is null or ${t.ruleId} ~ '^(R[0-9]+|NO_MATCH)$'`),
    checkCurrency("deduction_marks_currency_ck", t.currency),
    checkProvenance("deduction_marks", t.provenance),
    wsIdUnique("deduction_marks", t),
    wsFk("deduction_marks_row_fk", t, t.slipRowId, slipRows),
  ],
);

export const slipAnomalies = pgTable(
  "slip_anomalies",
  {
    id: id(),
    workspaceId: workspaceId(),
    documentId: uuid("document_id").notNull(),
    slipRowId: uuid("slip_row_id"),
    kind: text("kind").notNull(),
    detail: jsonb("detail"),
    /** text quarantined by the injection screen; shown as a notice, never executed (C-16) */
    quarantinedText: text("quarantined_text"),
    provenance: provenance(),
    createdAt: createdAt(),
  },
  (t) => [
    checkProvenance("slip_anomalies", t.provenance),
    wsIdUnique("slip_anomalies", t),
    wsFk("slip_anomalies_document_fk", t, t.documentId, documents),
    wsFk("slip_anomalies_row_fk", t, t.slipRowId, slipRows),
  ],
);
