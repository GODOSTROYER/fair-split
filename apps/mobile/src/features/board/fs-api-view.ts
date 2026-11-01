import type { ApprovalDTO, MemberLineDTO, PayRun, ProofLine } from "@fairsplit/contracts";
import type { CosignLine, CosignRequestDTO } from "../../_shims/api-client";

/** Only the fields consumed from fs-api's validated BatchView/RunView/LineList. */
export interface BatchView {
  runSlug: string;
  runId: string;
  runState: string;
  senderBatchId: string;
  rateCardSha256: string;
  items: CosignRequestDTO["items"];
  itemCount: number;
  totalCents: number;
  batchSha256: string | null;
  memberLines: { memberNo: string; lineSha256: string | null }[];
  linesDigest: string | null;
  chairReasons: string[];
  blocking: { id: string; label: string }[];
  unpayable: string[];
  rail: "simulated" | "sandbox";
}
export interface RunView {
  run: PayRun;
  approvals: ApprovalDTO[];
}
export interface LineList {
  runSlug: string;
  lines: (MemberLineDTO & { canonical: ProofLine["canonical"] })[];
}

/** The actual /lines preimage is rehashed, as well as compared with the independent /batch listing. */
export function digestLines(batch: BatchView, view: LineList): CosignLine[] {
  const matching =
    view.runSlug === batch.runSlug &&
    batch.memberLines.length === view.lines.length &&
    new Set(batch.memberLines.map((l) => l.memberNo)).size === batch.memberLines.length;
  return view.lines.map((l) => ({
    source: "fs-api-lines",
    memberNo: l.memberNo,
    rail: l.rail,
    netCents: l.netCents,
    lineSha256: l.lineSha256,
    canonical: l.canonical,
    batchLineSha256:
      matching && l.runId === batch.runId
        ? (batch.memberLines.find((m) => m.memberNo === l.memberNo)?.lineSha256 ?? null)
        : null,
  }));
}

export function cosignView(
  batch: BatchView,
  view: LineList,
  run: RunView,
  thresholds: {
    cosignBatchCents: number;
    cosignLineCents: number;
  },
): CosignRequestDTO {
  const reasons = batch.chairReasons;
  const reason = reasons.includes("OVERRIDE")
    ? "override"
    : reasons.includes("BATCH_OVER_THRESHOLD")
      ? "batch-over-threshold"
      : "line-over-threshold";
  const approved = run.approvals.find((a) => a.role === "treasurer" && a.voidedAt === null);
  const signed = run.approvals.some((a) => a.role === "chair" && a.voidedAt === null);
  const open =
    batch.runState === "AWAITING_BOARD" &&
    run.run.state === "AWAITING_BOARD" &&
    batch.blocking.length === 0 &&
    batch.unpayable.length === 0;
  return {
    rail: batch.rail,
    runId: batch.runId,
    runSlug: batch.runSlug,
    seasonId: run.run.seasonId,
    seasonCode: batch.runSlug.split("-r")[0] ?? "",
    state: signed ? "signed" : open ? (reason === "override" ? "override" : "request") : "declined",
    provenance: run.run.provenance,
    totalCents: batch.totalCents,
    itemCount: batch.itemCount,
    currency: "USD",
    thresholdCents:
      reason === "line-over-threshold" ? thresholds.cosignLineCents : thresholds.cosignBatchCents,
    reason,
    rateCardSha256: batch.rateCardSha256,
    senderBatchId: batch.senderBatchId,
    batchSha256: run.run.id === batch.runId ? (batch.batchSha256 ?? "") : "",
    linesDigest: batch.linesDigest ?? "",
    items: batch.items,
    lines: digestLines(batch, view),
    holds: [],
    treasurerSigned: approved ? { keyId: approved.keyId, at: approved.signedAt } : null,
    presence: null,
    // A display freshness window only. The actual signing window is fs-api's nonce/exp, checked separately.
    expiresAt: new Date(Date.now() + 30 * 60_000).toISOString(),
  };
}
