// A member line's statement facts, read from the server's records (never from a request, never from a model):
// the line's engine numbers, the member's registry entry, the run's recorded rate, the ratified card's buyer and
// resolution, the co-op and its treasurer, the line's PayPal item, and where its slip readings came from (the
// AI_NOTE says Claude read them only when Claude did, T1). Every number is an integer.
import {
  type Lang,
  type MemberLineState,
  type PayoutItemStatus,
  PROVENANCES,
  type Provenance,
} from "@fairsplit/contracts";
import { type DbOrTx, schema } from "@fairsplit/db";
import { and, asc, desc, eq, inArray, ne } from "drizzle-orm";
import { parseCanonical } from "../proof/bundle.js";
import type { StatementLineFacts } from "./plan.js";

export interface StatementContext {
  facts: StatementLineFacts;
  workspaceId: string;
  memberId: string;
  /** The member's registry language (the statement's default). */
  registryLang: Lang;
  runId: string;
  runSlug: string;
  rail: "PAYPAL" | "CASH";
  provenance: Provenance;
}

const CATEGORY_OF = { R1: "CBU", R3: "LOAN", R4: "ADVANCE" } as const;
const ACCEPTED_ROWS = ["AUTO_ACCEPTED", "CONFIRMED"] as const;

/** The labels a reading can carry other than `live`, the least real first. */
const NOT_LIVE: readonly Provenance[] = ["seeded", "replay", "simulated_rail"];
const KNOWN_PROVENANCE = new Set<string>(PROVENANCES);

/**
 * A line's reading provenance, from its slip rows' labels (I8): `live` only when every reading is live (a real
 * Claude reading); otherwise the least real label present, an unknown label counting as `seeded`; null when there
 * is no reading at all. The AI_NOTE claims Claude's reading only for `live` (render.ts `aiNoteVariant`).
 */
export function readingProvenanceOf(labels: readonly string[]): Provenance | null {
  if (labels.length === 0) return null;
  if (labels.every((p) => p === "live")) return "live";
  if (labels.some((p) => !KNOWN_PROVENANCE.has(p))) return "seeded";
  return NOT_LIVE.find((p) => labels.includes(p)) ?? "seeded";
}

/** Loads one line of one workspace (null when it is not there: another workspace's line looks absent). */
export async function loadStatementContext(
  db: DbOrTx,
  workspaceId: string,
  lineId: string,
  lang?: Lang,
): Promise<StatementContext | null> {
  const ml = schema.memberLines;
  const [row] = await db
    .select({
      id: ml.id,
      runId: ml.runId,
      memberId: ml.memberId,
      state: ml.state,
      rail: ml.rail,
      verifiedG: ml.verifiedG,
      grade1G: ml.grade1G,
      premiumCents: ml.premiumCents,
      bonusCents: ml.bonusCents,
      creditsCents: ml.creditsCents,
      netCents: ml.netCents,
      deductions: ml.deductions,
      trace: ml.trace,
      lineProvenance: ml.provenance,
      memberNo: schema.members.memberNo,
      displayName: schema.members.displayName,
      honorific: schema.members.honorific,
      memberLang: schema.members.lang,
      coopId: schema.members.coopId,
    })
    .from(ml)
    .innerJoin(
      schema.members,
      and(eq(schema.members.workspaceId, ml.workspaceId), eq(schema.members.id, ml.memberId)),
    )
    .where(and(eq(ml.workspaceId, workspaceId), eq(ml.id, lineId)))
    .limit(1);
  if (!row) return null;

  const [run] = await db
    .select({
      id: schema.payRuns.id,
      runSlug: schema.payRuns.runSlug,
      rateCardId: schema.payRuns.rateCardId,
      seasonId: schema.payRuns.seasonId,
      fxNum: schema.payRuns.fxNum,
      fxDen: schema.payRuns.fxDen,
      provenance: schema.payRuns.provenance,
    })
    .from(schema.payRuns)
    .where(and(eq(schema.payRuns.workspaceId, workspaceId), eq(schema.payRuns.id, row.runId)))
    .limit(1);
  if (!run) return null;
  const [card] = await db
    .select({ canonicalJcs: schema.rateCards.canonicalJcs })
    .from(schema.rateCards)
    .where(and(eq(schema.rateCards.workspaceId, workspaceId), eq(schema.rateCards.id, run.rateCardId)))
    .limit(1);
  const canonical = card ? parseCanonical(card.canonicalJcs) : null;
  const [coop] = await db
    .select({ name: schema.coops.name })
    .from(schema.coops)
    .where(and(eq(schema.coops.workspaceId, workspaceId), eq(schema.coops.id, row.coopId)))
    .limit(1);
  const [treasurer] = await db
    .select({ persona: schema.memberships.persona })
    .from(schema.memberships)
    .where(and(eq(schema.memberships.workspaceId, workspaceId), eq(schema.memberships.role, "treasurer")))
    .orderBy(asc(schema.memberships.createdAt))
    .limit(1);
  const [item] = await db
    .select({ status: schema.payoutItems.status })
    .from(schema.payoutItems)
    .where(and(eq(schema.payoutItems.workspaceId, workspaceId), eq(schema.payoutItems.lineId, lineId)))
    .orderBy(desc(schema.payoutItems.createdAt))
    .limit(1);
  const [receipt] = await db
    .select({ paidAt: schema.cashReceipts.paidAt })
    .from(schema.cashReceipts)
    .where(and(eq(schema.cashReceipts.workspaceId, workspaceId), eq(schema.cashReceipts.lineId, lineId)))
    .limit(1);

  const trace = asRecord(row.trace);
  const canonicalTrace = asRecord(trace?.canonical);
  let slipSerials = stringArray(canonicalTrace?.slipSerials) ?? stringArray(trace?.slipSerials);
  if (!slipSerials) {
    const slips = await db
      .select({ serial: schema.slipRows.serial })
      .from(schema.slipRows)
      .where(
        and(
          eq(schema.slipRows.workspaceId, workspaceId),
          eq(schema.slipRows.seasonId, run.seasonId),
          eq(schema.slipRows.memberId, row.memberId),
          inArray(schema.slipRows.state, [...ACCEPTED_ROWS]),
        ),
      );
    slipSerials = [...new Set(slips.map((x) => x.serial))].sort();
  }
  // The readings behind this line: the member's own non-rejected slip rows in the run's season (the run's, when
  // the member has none yet). Judge and showcase rows are seeded or replayed, so they take the demo AI_NOTE.
  const readings = await db
    .selectDistinct({ memberId: schema.slipRows.memberId, provenance: schema.slipRows.provenance })
    .from(schema.slipRows)
    .where(
      and(
        eq(schema.slipRows.workspaceId, workspaceId),
        eq(schema.slipRows.seasonId, run.seasonId),
        ne(schema.slipRows.state, "REJECTED"),
      ),
    );
  const own = readings.filter((x) => x.memberId === row.memberId);
  const readingProvenance = readingProvenanceOf((own.length > 0 ? own : readings).map((x) => x.provenance));
  const statementLang = lang ?? (row.memberLang as Lang);
  const facts: StatementLineFacts = {
    lineId: row.id,
    memberNo: row.memberNo,
    lang: statementLang,
    state: row.state as MemberLineState,
    verifiedG: Number(row.verifiedG),
    grade1G: Number(row.grade1G),
    premiumCents: Number(row.premiumCents),
    bonusCents: Number(row.bonusCents),
    netCents: Number(row.netCents),
    deductions: deductionsOf(row.deductions),
    credits: creditsOf(trace?.credits, Number(row.creditsCents)),
    slipSerials: [...new Set(slipSerials)],
    honorific: honorificOf(row.honorific, row.displayName, statementLang),
    payer: canonical?.pricing.buyer ?? "the buyer",
    resolutionNo: canonical?.resolutionNo ?? "the rate card",
    treasurer: treasurer?.persona ? givenName(treasurer.persona) : null,
    coop: coop ? shortCoopName(coop.name) : "Co-op",
    fx:
      run.fxNum !== null && run.fxDen !== null && run.fxDen > 0n
        ? { num: Number(run.fxNum), den: Number(run.fxDen) }
        : null,
    cashDay: receipt ? receipt.paidAt.toISOString().slice(0, 10) : null,
    itemStatus: (item?.status as PayoutItemStatus | undefined) ?? null,
    readingProvenance,
  };
  return {
    facts,
    workspaceId,
    memberId: row.memberId,
    registryLang: row.memberLang as Lang,
    runId: run.id,
    runSlug: run.runSlug,
    rail: row.rail === "ON" ? "PAYPAL" : "CASH",
    provenance: run.provenance as Provenance,
  };
}

function deductionsOf(v: unknown): StatementLineFacts["deductions"] {
  const list = Array.isArray(v) ? v : ((asRecord(v)?.items as unknown[] | undefined) ?? []);
  return list.flatMap((d) => {
    const r = asRecord(d);
    const ruleId = r?.ruleId;
    if (ruleId !== "R1" && ruleId !== "R3" && ruleId !== "R4") return [];
    const amount = Number(r?.amountCents);
    if (!Number.isSafeInteger(amount) || amount <= 0) return [];
    const category =
      r?.category === "CBU" || r?.category === "LOAN" || r?.category === "ADVANCE"
        ? r.category
        : CATEGORY_OF[ruleId];
    return [{ ruleId, category, amountCents: amount }];
  });
}

function creditsOf(v: unknown, creditsCents: number): StatementLineFacts["credits"] {
  const detailed = Array.isArray(v)
    ? v.flatMap((c) => {
        const r = asRecord(c);
        const amount = Number(r?.amountCents);
        if (!r || !Number.isSafeInteger(amount) || amount <= 0) return [];
        const serial = typeof r.serial === "string" && /^\d{4}$/.test(r.serial) ? r.serial : null;
        const php = Number.isSafeInteger(r.phpCentavos) ? Number(r.phpCentavos) : null;
        return [{ serial, phpCentavos: php, amountCents: amount }];
      })
    : [];
  if (detailed.length > 0) return detailed;
  return creditsCents > 0 ? [{ serial: null, phpCentavos: null, amountCents: creditsCents }] : [];
}

/** The registry keeps one honorific per language as JSON ({ceb, fil, en}); a plain string serves all three. */
export function honorificOf(stored: string | null, displayName: string, lang: Lang): string {
  if (stored) {
    const parsed = safeJson(stored);
    const r = asRecord(parsed);
    if (r && typeof r[lang] === "string" && r[lang]) return r[lang] as string;
    if (typeof parsed !== "object" && stored.trim()) return stored.trim();
  }
  return displayName;
}

/** "treasurer:analyn" or "analyn" → "Analyn". */
export function givenName(persona: string): string {
  const bare = persona.includes(":") ? (persona.split(":")[1] ?? persona) : persona;
  return bare.charAt(0).toUpperCase() + bare.slice(1);
}

const COOP_SUFFIXES = new Set([
  "mpc",
  "growers",
  "cooperative",
  "coop",
  "co-op",
  "inc.",
  "inc",
  "multi-purpose",
]);

/** The SMS sender name: the co-op's name without its legal suffixes ("Bulawanon Kakaw Growers MPC" → "Bulawanon Kakaw"). */
export function shortCoopName(name: string): string {
  const words = name.trim().split(/\s+/);
  while (words.length > 1 && COOP_SUFFIXES.has((words.at(-1) ?? "").toLowerCase())) words.pop();
  return words.join(" ");
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function stringArray(v: unknown): string[] | null {
  return Array.isArray(v) && v.every((x) => typeof x === "string") ? [...(v as string[])] : null;
}
