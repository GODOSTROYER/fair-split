// Pure parts of the Proof builder: where a line's canonical content comes from (and that it must re-hash to the
// stored line hash to count as explained), the forward-only item fold plate 6 replays, the I8 label of a bundle,
// and the tiers' redaction.
import { type EngineLine, ProofBundle } from "@fairsplit/contracts";
import { jcsSha256, lineCanonical } from "@fairsplit/domain";
import { getLines, getProof, getRateCard, getRun } from "@fairsplit/seed";
import { describe, expect, it } from "vitest";
import { foldItemEvents, resolveLineCanonical, weakestProvenance } from "./bundle.js";
import { must } from "./testing/world.js";
import { redactBundle, tierFor, WITHHELD_RECEIVER } from "./tier.js";

const SHA = getRateCard().sha256;

function row(l: EngineLine, over: Record<string, unknown> = {}) {
  const { lineSha256, ...rest } = l;
  return {
    memberNo: l.memberNo,
    rail: l.rail === "PAYPAL" ? "ON" : "OFF",
    verifiedG: BigInt(l.verifiedG),
    grade1G: BigInt(l.grade1G),
    premiumCents: BigInt(l.premiumCents),
    bonusCents: BigInt(l.bonusCents),
    netCents: BigInt(l.netCents),
    deductions: l.deductions as unknown,
    lineSha256,
    trace: { canonical: lineCanonical(rest, SHA) } as unknown,
    ...over,
  };
}

describe("resolveLineCanonical", () => {
  const loan = must(getLines().find((l) => l.memberNo === "M-022"));
  const credit = must(getLines().find((l) => l.memberNo === "M-018"));

  it("takes the canonical the line writer kept, when it re-hashes to the stored hash", () => {
    const r = resolveLineCanonical(row(credit), SHA, []);
    expect(r.matches).toBe(true);
    expect(r.sha256).toBe(credit.lineSha256);
  });

  it("rebuilds it from the columns, the engine's deductions and the accepted slips when none was kept", () => {
    const r = resolveLineCanonical(row(loan, { trace: null }), SHA, loan.slipSerials);
    expect(r.matches).toBe(true);
    expect(r.canonical.deductions).toEqual([
      expect.objectContaining({ ruleId: "R3", ref: must(loan.deductions[0]).ref }),
    ]);
  });

  it("serves a rebuild that does not re-hash as unexplained (the verifier then fails plate 4, honestly)", () => {
    const r = resolveLineCanonical(row(loan, { trace: null }), SHA, ["0001"]);
    expect(r.matches).toBe(false);
    expect(r.sha256).toBe(jcsSha256(r.canonical));
    const forged = resolveLineCanonical(
      row(loan, { trace: { canonical: { ...lineCanonical(loan, SHA), netCents: loan.netCents + 1 } } }),
      SHA,
      loan.slipSerials,
    );
    expect(forged.canonical.netCents).toBe(loan.netCents);
  });
});

describe("foldItemEvents", () => {
  it("inv.i5.forward-only: replays the chain's verified item events exactly as plate 6 does", () => {
    const folds = foldItemEvents(getProof().ledger);
    for (const it of getRun().items) {
      expect(folds.get(it.senderItemId), it.senderItemId).toEqual({
        status: it.status,
        lastEventId: it.eventId,
      });
    }
  });

  it("never applies a lower rank, a dev mock, or RETURNED without our own cancel", () => {
    const base = getProof().ledger;
    const rhea = must(getRun().items.find((i) => i.status === "RETURNED"));
    const withoutCancel = base.filter(
      (e) =>
        !(
          e.kind === "payout.cancel" &&
          (e.payload as { senderItemId?: string }).senderItemId === rhea.senderItemId
        ),
    );
    expect(foldItemEvents(withoutCancel).get(rhea.senderItemId)?.status).toBe("UNCLAIMED");
    const mocked = base.map((e) =>
      e.kind === "webhook.applied"
        ? { ...e, payload: { ...(e.payload as object), verified: "dev_mock" } }
        : e,
    );
    expect(foldItemEvents(mocked).size).toBe(0);
  });
});

describe("labels and tiers", () => {
  it("inv.i8.labels: a bundle is labelled by its least-real part", () => {
    expect(weakestProvenance(["live", "live"])).toBe("live");
    expect(weakestProvenance(["live", "replay"])).toBe("replay");
    expect(weakestProvenance(["live", "simulated_rail", "replay"])).toBe("simulated_rail");
    expect(weakestProvenance(["simulated_rail", "seeded"])).toBe("seeded");
  });

  it("redaction touches receivers only: every hash, signature and ledger entry is the same in every tier", () => {
    const full = ProofBundle.parse(getProof());
    const pub = redactBundle(full, "public");
    expect(pub.batch.items.every((i) => i.receiver === WITHHELD_RECEIVER)).toBe(true);
    const { batch: a, ...restPub } = pub;
    const { batch: b, ...restFull } = full;
    expect(restPub).toEqual(restFull);
    expect({ ...a, items: a.items.map(({ receiver: _r, ...i }) => i) }).toEqual({
      ...b,
      items: b.items.map(({ receiver: _r, ...i }) => i),
    });
    const member = redactBundle(full, "member", "M-014");
    expect(
      member.batch.items.filter((i) => i.receiver !== WITHHELD_RECEIVER).map((i) => i.senderItemId),
    ).toEqual(["r37-M-014"]);
  });

  it("the tier comes from the credential and the run's workspace, never from the request", () => {
    const ws = "0192f8a0-0000-7000-8000-0000000000aa";
    const other = "0192f8a0-0000-7000-8000-0000000000bb";
    const exp = new Date();
    expect(tierFor(null, ws)).toEqual({ tier: "public" });
    expect(
      tierFor(
        {
          kind: "brand_link",
          workspaceId: ws,
          brand: "lb",
          jti: "j".repeat(8),
          role: "brand",
          expiresAt: exp,
        },
        ws,
      ),
    ).toEqual({ tier: "full" });
    expect(
      tierFor(
        {
          kind: "brand_link",
          workspaceId: other,
          brand: "lb",
          jti: "j".repeat(8),
          role: "brand",
          expiresAt: exp,
        },
        ws,
      ),
    ).toEqual({ tier: "public" });
    expect(tierFor({ kind: "operator", role: "operator", persona: "operator", expiresAt: exp }, ws)).toEqual({
      tier: "public",
    });
    const frame = {
      kind: "frame" as const,
      tokenId: "t",
      workspaceId: ws,
      persona: "x",
      memberId: "m",
      sessionId: null,
      expiresAt: exp,
    };
    expect(tierFor({ ...frame, role: "clerk" }, ws)).toEqual({ tier: "public" });
    expect(tierFor({ ...frame, role: "member" }, ws)).toEqual({
      tier: "member",
      lineId: null,
      memberId: "m",
    });
    expect(tierFor({ ...frame, role: "board" }, ws)).toEqual({ tier: "full" });
  });
});
