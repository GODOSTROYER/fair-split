// Stored rows → IC-01 DTOs. Amounts leave as integer cents (never floats), states keep their contract names,
// and provenance always travels with the row (I8).
import type {
  ApprovalDTO,
  HoldDTO,
  HoldState,
  KeyId,
  MemberLineDTO,
  MemberLineState,
  SlipFieldDTO,
} from "@fairsplit/contracts";
import { KeyId as KeyIdSchema, Legibility } from "@fairsplit/contracts";
import type { schema } from "@fairsplit/db";
import { mergeDisplay } from "@fairsplit/domain";
import { approvalRoleOf, iso, isoOrNull, provenanceOf, railOf, toInt } from "./codes.js";
import { engineLineOf, holdFacts, resolutionOf } from "./engine.js";
import type { HoldRow, LineRow } from "./machine.js";

type ApprovalRow = typeof schema.approvals.$inferSelect;
type FieldRow = typeof schema.slipFields.$inferSelect;

export function holdDto(row: HoldRow): HoldDTO {
  const f = holdFacts(row);
  const r = resolutionOf(row);
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    runId: row.runId,
    label: row.code ?? row.kind,
    key: f.key,
    lineId: row.lineId,
    memberNo: f.memberNo,
    kind: row.kind,
    gate: row.gate,
    state: row.state as HoldState,
    engineParams: f.params,
    engineLine: engineLineOf(row),
    claudeLine: row.claudeLine,
    evidence: Array.isArray(row.evidence)
      ? (row.evidence as { kind?: unknown; ref?: unknown }[])
          .filter((e) => typeof e?.kind === "string" && typeof e?.ref === "string")
          .map((e) => ({ kind: e.kind as string, ref: e.ref as string }))
      : [],
    resolution:
      r && (row.state === "RESOLVED" || row.state === "EXCLUDED")
        ? { kind: r.kind, by: r.by, at: r.at, reason: r.reason }
        : null,
    provenance: provenanceOf(row.provenance),
  };
}

interface StoredDeduction {
  ruleId?: unknown;
  category?: unknown;
  amountCents?: unknown;
  ref?: unknown;
}

export function lineDto(row: LineRow, memberNo: string): MemberLineDTO {
  const trace = (row.trace ?? {}) as { slipSerials?: unknown };
  const serials = Array.isArray(trace.slipSerials) ? trace.slipSerials.map(String) : [];
  const deductions = Array.isArray(row.deductions) ? (row.deductions as StoredDeduction[]) : [];
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    runId: row.runId,
    memberId: row.memberId,
    memberNo,
    state: row.state as MemberLineState,
    rail: railOf(row.rail),
    verifiedG: toInt(row.verifiedG),
    grade1G: toInt(row.grade1G),
    premiumCents: toInt(row.premiumCents),
    bonusCents: toInt(row.bonusCents),
    deductions: deductions.map((d) => ({
      ruleId: String(d.ruleId ?? ""),
      category: String(d.category ?? ""),
      amountCents: typeof d.amountCents === "number" ? d.amountCents : Number(d.amountCents ?? 0),
      ref: typeof d.ref === "string" ? d.ref : null,
    })),
    creditsCents: toInt(row.creditsCents),
    netCents: toInt(row.netCents),
    lineSha256: row.lineSha256 ?? "0".repeat(64),
    trace: serials.map((s) => `slip:${s}`),
    provenance: provenanceOf(row.provenance),
  };
}

function read(v: unknown): { valueText: string; legibility: Legibility } | null {
  if (!v || typeof v !== "object") return null;
  const r = v as { valueText?: unknown; legibility?: unknown };
  if (typeof r.valueText !== "string") return null;
  const leg = Legibility.safeParse(r.legibility);
  return { valueText: r.valueText, legibility: leg.success ? leg.data : "CLEAR" };
}

/** Per-character merge of two reads for display ("6?.80"), the domain's own rule. */
export function merge(a: string | null, b: string | null): string {
  if (a === null) return b ?? "";
  if (b === null) return a;
  return mergeDisplay(a, b);
}

export function fieldDto(row: FieldRow): SlipFieldDTO {
  const a = read(row.readA);
  const b = read(row.readB);
  const z = read(row.zoom);
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    slipRowId: row.slipRowId,
    field: row.field as SlipFieldDTO["field"],
    readA: a,
    readB: b,
    zoom: z,
    score: row.agreement ?? 0,
    displayMerge: merge(a?.valueText ?? null, b?.valueText ?? null),
    finalValue: row.finalValue,
    decidedBy: row.decidedBy,
    provenance: provenanceOf(row.provenance),
  };
}

const keyLabel = (keyId: string): string =>
  /-demo-[a-z0-9]{6}$/.test(keyId)
    ? "Browser demo key"
    : /-w\d+$/.test(keyId)
      ? "Demo key (this browser)"
      : /-s\d+$/.test(keyId)
        ? "Sample key (seeded)"
        : "Device key";

export function approvalDto(row: ApprovalRow): ApprovalDTO {
  const keyId: KeyId = KeyIdSchema.safeParse(row.keyId).success ? (row.keyId as string) : "fs-unknown-s0";
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    runId: row.runId,
    role: approvalRoleOf(row.role),
    keyId,
    payloadJcs: row.payloadJcs ?? "",
    signatureHex: row.signature ?? "0".repeat(128),
    nonce: row.nonce ?? "",
    exp: row.exp ? iso(row.exp) : iso(row.createdAt),
    signedAt: iso(row.createdAt),
    voidedAt: isoOrNull(row.voidedAt),
    keyLabel: keyLabel(keyId),
    provenance: provenanceOf(row.provenance),
  };
}
