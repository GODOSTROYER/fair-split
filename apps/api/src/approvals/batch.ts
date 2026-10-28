// The batch both keys sign and PayoutsService posts (I4: the approved digest is the payout). It is rebuilt
// from the database every time it is needed (approval payload, each signature, the POST): the on-rail lines
// that are READY (LOCKED once approved, SUBMITTED once written) with a positive net and no open hold
// reserving them, each paid to its member's receiver, hashed with IC-02 `batchDigest`; and every member line of
// the run, on and off rail, hashed with IC-02 `linesDigest` (the second digest both keys sign, so a cash line
// changed after signing is refused too). A payable on-rail line whose member has no receiver is listed in
// `unpayable`, and the approval routes refuse to sign around it.
import {
  type BatchDigest,
  type BatchItem,
  type CosignReason,
  type EngineHold,
  HoldResolutionKind,
  type PayRunState,
  type RateCardRules,
} from "@fairsplit/contracts";
import { type DbOrTx, schema, type WorkspaceScope } from "@fairsplit/db";
import {
  batchDigest,
  linesDigest,
  overrideCount,
  requiresChair,
  senderBatchId,
  senderItemId,
} from "@fairsplit/domain";
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
  /**
   * Every member line of the run, on and off rail (the cash lines too), as `{memberNo, lineSha256}` stored now,
   * by member number: what IC-02 `linesDigest` hashes and M-BD-01 recomputes.
   */
  memberLines: { memberNo: string; lineSha256: string | null }[];
  /**
   * IC-02 `linesDigest(memberLines)`: the second digest both keys sign (I4: a cash line changed after signing
   * no longer matches). Null when the run has no line, or a line has no stored hash (nothing can be signed).
   */
  linesDigest: string | null;
  cosign: RateCardRules["cosign"];
  chair: { required: boolean; reasons: CosignReason[] };
  overrides: number;
  /** Open holds that block approval (BLOCKS_APPROVAL, OPEN or ASKED_CHAIR). */
  blocking: HoldRow[];
  /**
   * On-rail members with a payable line but no known receiver (an address missing from PP_RECEIVERS), sorted.
   * Never silently dropped: while this is non-empty nothing can be signed (S3.6.4 step 4, I3), and the
   * batch view names them.
   */
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
  // R5's overrides exactly as PayoutsService counts them before the POST (domain `overrideCount` over every hold
  // of the run as stored), so who must co-sign never differs between signing and posting.
  const overrides = overrideCount(runHolds(holds));

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
  unpayable.sort();
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
  const memberLines = lines
    .map(({ line, memberNo }) => ({ memberNo, lineSha256: line.lineSha256 ?? null }))
    .sort((a, b) => (a.memberNo < b.memberNo ? -1 : a.memberNo > b.memberNo ? 1 : 0));
  return {
    run,
    season,
    seasonLabel: season.label,
    senderBatchId: sbid,
    items,
    digest,
    memberLines,
    linesDigest: linesDigestOf(memberLines),
    cosign,
    chair,
    overrides,
    blocking,
    unpayable,
  };
}

const SHA256_HEX = /^[0-9a-f]{64}$/;
const RESOLUTION_KINDS: ReadonlySet<string> = new Set(HoldResolutionKind.options);

/**
 * The run's holds as domain `overrideCount` and PayoutsService read them: `{kind, resolution}` with the stored
 * resolution's kind (an unreadable resolution counts as none).
 */
export function runHolds(
  holds: readonly Pick<HoldRow, "kind" | "resolution">[],
): Pick<EngineHold, "kind" | "resolution">[] {
  return holds.map((h) => {
    const r = h.resolution as { kind?: unknown; by?: unknown; at?: unknown } | null;
    const kind = typeof r?.kind === "string" && RESOLUTION_KINDS.has(r.kind) ? r.kind : null;
    return {
      kind: h.kind as EngineHold["kind"],
      resolution:
        kind === null
          ? null
          : {
              kind: kind as HoldResolutionKind,
              by: typeof r?.by === "string" ? r.by : "",
              at: typeof r?.at === "string" ? r.at : null,
            },
    };
  });
}

/**
 * IC-02 `linesDigest` over every member line as stored, or null when it cannot be signed: no line, a line without
 * a stored hash, or one member with two lines (the domain refuses those; nothing signs around them).
 */
export function linesDigestOf(memberLines: readonly { memberNo: string; lineSha256: string | null }[]) {
  if (memberLines.length === 0) return null;
  const hashed: { memberNo: string; lineSha256: string }[] = [];
  for (const l of memberLines) {
    if (l.lineSha256 === null || !SHA256_HEX.test(l.lineSha256)) return null;
    hashed.push({ memberNo: l.memberNo, lineSha256: l.lineSha256 });
  }
  if (new Set(hashed.map((l) => l.memberNo)).size !== hashed.length) return null;
  return linesDigest(hashed);
}

/** The states in which each role may sign (register §7, S3.8). */
export const SIGNABLE_IN: Readonly<Record<"treasurer" | "chair", readonly PayRunState[]>> = {
  treasurer: ["IN_REVIEW"],
  chair: ["AWAITING_BOARD"],
};
