/**
 * Minimal synthetic fixtures for persistence tests. These are not the canonical world: real figures come only
 * from the seed snapshot (IC-03). Values here are deliberately round and obviously fake.
 */
import { eq } from "drizzle-orm";
import type { WorkspaceKind } from "../_shims/contracts.js";
import { jcs, sha256Hex } from "../_shims/domain.js";
import type { DbOrTx } from "../client.js";
import { coops, lots, members, payRuns, rateCards, rateRules, seasons, workspaces } from "../schema/index.js";

export interface FixtureOptions {
  kind?: WorkspaceKind;
  name?: string;
  /** ratify the card at this instant (default: 2026-03-14T02:00:00Z); false leaves it a draft */
  ratifiedAt?: Date | false;
  members?: number;
  withRun?: boolean;
  expiresAt?: Date | null;
}

export interface FixtureWorkspace {
  workspaceId: string;
  coopId: string;
  seasonId: string;
  lotId: string;
  rateCardId: string;
  rateCardSha256: string;
  memberIds: string[];
  runId: string | null;
}

export const FIXTURE_RATIFIED_AT = new Date("2026-03-14T02:00:00.000Z");

export async function fixtureWorkspace(db: DbOrTx, opts: FixtureOptions = {}): Promise<FixtureWorkspace> {
  const [ws] = await db
    .insert(workspaces)
    .values({
      kind: opts.kind ?? "showcase",
      name: opts.name ?? "fixture",
      expiresAt: opts.expiresAt ?? null,
    })
    .returning({ id: workspaces.id });
  const workspaceId = must(ws).id;
  const [coop] = await db
    .insert(coops)
    .values({ workspaceId, name: "Fixture Growers MPC", region: "Test Region", provenance: "seeded" })
    .returning({ id: coops.id });
  const coopId = must(coop).id;
  const [season] = await db
    .insert(seasons)
    .values({
      workspaceId,
      coopId,
      code: "2026A",
      label: "2026-A",
      opensOn: "2026-04-01",
      closesOn: "2026-08-31",
      currency: "USD",
      cosignBatchCents: 100n,
      cosignLineCents: 10n,
      massBalanceTolBp: 100,
      kgPerTreeMaxG: 1000,
      autoAcceptBp: 9000,
      provenance: "seeded",
    })
    .returning({ id: seasons.id });
  const seasonId = must(season).id;
  const [lot] = await db
    .insert(lots)
    .values({
      workspaceId,
      seasonId,
      lotCode: "LOT-TEST-1",
      sacks: 1,
      shippedG: 1000n,
      grade1ShippedG: 500n,
      provenance: "seeded",
    })
    .returning({ id: lots.id });
  const lotId = must(lot).id;

  const card = { code: "BR TEST", season: "2026A", rules: [{ ruleId: "R0", kind: "SHARE" }] };
  const canonicalJcs = jcs(card);
  const rateCardSha256 = sha256Hex(canonicalJcs);
  const [rc] = await db
    .insert(rateCards)
    .values({
      workspaceId,
      seasonId,
      code: card.code,
      canonicalJcs,
      sha256: rateCardSha256,
      provenance: "seeded",
    })
    .returning({ id: rateCards.id });
  const rateCardId = must(rc).id;
  await db.insert(rateRules).values({
    workspaceId,
    rateCardId,
    ruleId: "R0",
    kind: "SHARE",
    category: "premium",
    basis: "PER_KG",
    params: { centsPerKg: 1 },
    sourceQuote: "R0 fixture rule",
    provenance: "seeded",
  });
  if (opts.ratifiedAt !== false) {
    await db
      .update(rateCards)
      .set({ ratifiedAt: opts.ratifiedAt ?? FIXTURE_RATIFIED_AT })
      .where(eq(rateCards.id, rateCardId));
  }

  const memberIds: string[] = [];
  for (let i = 1; i <= (opts.members ?? 2); i++) {
    const [m] = await db
      .insert(members)
      .values({
        workspaceId,
        coopId,
        memberNo: `M-${String(i).padStart(3, "0")}`,
        displayName: `Fixture Member ${i}`,
        lang: "en",
        receiverRef: i % 2 === 1 ? `M-${String(i).padStart(3, "0")}` : null,
        provenance: "seeded",
      })
      .returning({ id: members.id });
    memberIds.push(must(m).id);
  }

  let runId: string | null = null;
  if (opts.withRun) {
    const [run] = await db
      .insert(payRuns)
      .values({
        workspaceId,
        seasonId,
        lotId,
        rateCardId,
        seasonCode: "2026A",
        currency: "USD",
        rateCardSha256,
        provenance: "seeded",
      })
      .returning({ id: payRuns.id });
    runId = must(run).id;
  }
  return { workspaceId, coopId, seasonId, lotId, rateCardId, rateCardSha256, memberIds, runId };
}

function must<T>(v: T | undefined): T {
  if (v === undefined) throw new Error("fixture insert returned no row");
  return v;
}
