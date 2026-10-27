// The batch both keys sign and PayoutsService posts (I4: the approved digest is the payout). It is rebuilt
// from the database every time it is needed (approval payload, each signature, the POST): the on-rail lines
// that are READY (LOCKED once approved, SUBMITTED once written) with a positive net and no open hold
// reserving them, each paid to its member's receiver, hashed with IC-02 `batchDigest`.
import type {
  BatchDigest,
  BatchItem,
  CosignReason,
  HoldResolutionKind,
  PayRunState,
  RateCardRules,
} from "@fairsplit/contracts";
import { type DbOrTx, schema, type WorkspaceScope } from "@fairsplit/db";
import { batchDigest, isOverride, requiresChair, senderBatchId, senderItemId } from "@fairsplit/domain";
import { and, eq } from "drizzle-orm";
import type { ReceiverDirectory } from "../money/receivers.js";
import { toInt } from "../runs/codes.js";
import { canonicalOf, cardById, cosignRule, type SeasonRow, seasonById } from "../runs/load.js";
import type { HoldRow, RunRow } from "../runs/machine.js";

export interface BatchLine extends BatchItem {
  lineId: string;
  memberNo: string;
}

export interface RunBatch {
  run: RunRow;
  season: SeasonRow;
  /** "2026-A": the label PayoutsService and the batch note use. */
  seasonLabel: string;
  senderBatchId: string;
  items: BatchLine[];
  /** Null when no on-rail line is payable. */
  digest: BatchDigest | null;
  cosign: RateCardRules["cosign"];
  chair: { required: boolean; reasons: CosignReason[] };
  overrides: number;
  /** Open holds that block approval (BLOCKS_APPROVAL, OPEN or ASKED_CHAIR). */
  blocking: HoldRow[];
  /** On-rail members left out because no receiver is known (sandbox mode only). */
  unpayable: string[];
}

const IN_BATCH: readonly string[] = ["READY", "LOCKED", "SUBMITTED"];
const OPEN: readonly string[] = ["OPEN", "ASKED_CHAIR"];

export async function runBatch(
  db: DbOrTx,
  scope: WorkspaceScope,
  run: RunRow,
  receivers: ReceiverDirectory,
): Promise<RunBatch> {
  const ws = scope.workspaceId;
  const season = await seasonById(db, scope, run.seasonId);
  const card = await cardById(db, scope, run.rateCardId);
  const cosign = cosignRule(season, canonicalOf(card));
  const lines = await db
    .select({ line: schema.memberLines, memberNo: schema.members.memberNo })
    .from(schema.memberLines)
    .innerJoin(schema.members, eq(schema.members.id, schema.memberLines.memberId))
    .where(and(eq(schema.memberLines.workspaceId, ws), eq(schema.memberLines.runId, run.id)));
  const holds = await db
    .select()
    .from(schema.holds)
    .where(and(eq(schema.holds.workspaceId, ws), eq(schema.holds.runId, run.id)));
  const reserved = new Set(
    holds
      .filter((h) => OPEN.includes(h.state) && h.gate === "RESERVES_LINE" && h.lineId)
      .map((h) => h.lineId as string),
  );
  const blocking = holds.filter((h) => OPEN.includes(h.state) && h.gate === "BLOCKS_APPROVAL");
  const overrides = holds.filter((h) => {
    const r = h.resolution as { kind?: string } | null;
    return (
      h.state === "RESOLVED" && r?.kind !== undefined && isOverride(h.kind, r.kind as HoldResolutionKind)
    );
  }).length;

  const sbid = senderBatchId(season.code, run.rateCardSha256, run.runSeq);
  const items: BatchLine[] = [];
  const unpayable: string[] = [];
  for (const { line, memberNo } of lines) {
    if (line.rail !== "ON" || !IN_BATCH.includes(line.state) || reserved.has(line.id)) continue;
    const net = toInt(line.netCents);
    if (net <= 0) continue;
    const receiver = receivers.receiverFor(memberNo);
    if (!receiver) {
      unpayable.push(memberNo);
      continue;
    }
    items.push({
      lineId: line.id,
      memberNo,
      senderItemId: senderItemId(run.runSeq, memberNo),
      receiver,
      amountCents: net,
      currency: "USD",
    });
  }
  items.sort((a, b) => (a.senderItemId < b.senderItemId ? -1 : a.senderItemId > b.senderItemId ? 1 : 0));
  const digest =
    items.length > 0
      ? batchDigest(
          { runId: run.id, senderBatchId: sbid, rateCardSha256: run.rateCardSha256 },
          items.map(({ senderItemId: s, receiver, amountCents, currency }) => ({
            senderItemId: s,
            receiver,
            amountCents,
            currency,
          })),
        )
      : null;
  const chair = requiresChair(
    {
      batchTotalCents: digest?.totalCents ?? 0,
      lineAmountsCents: items.map((i) => i.amountCents),
      overrides,
    },
    cosign,
  );
  return {
    run,
    season,
    seasonLabel: season.label,
    senderBatchId: sbid,
    items,
    digest,
    cosign,
    chair,
    overrides,
    blocking,
    unpayable,
  };
}

/** The states in which each role may sign (register §7, S3.8). */
export const SIGNABLE_IN: Readonly<Record<"treasurer" | "chair", readonly PayRunState[]>> = {
  treasurer: ["IN_REVIEW"],
  chair: ["AWAITING_BOARD"],
};
