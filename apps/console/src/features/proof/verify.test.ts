// "Verify in your browser" (W-PF-01): verify-core runs over the served bundle against keys that come from outside
// it. The seeded bundle is signed with seeded sample keys, so a full match reads Sample, never Verified; an edited
// bundle fails and names the plate; a public bundle with withheld receivers checks five of six here.

import type { PlateResult, ProofBundle } from "@fairsplit/contracts";
import { getSnapshot } from "@fairsplit/seed";
import { describe, expect, it } from "vitest";
import * as verifyModule from "../../lib/verify.js";
import { WITHHELD_RECEIVER } from "./model.js";
import { headOf, outcomeOf, PLATES, runVerification } from "./verify.js";

const snapshot = getSnapshot();
const load = async () => verifyModule;
const seedKeys = async () => ({ trust: snapshot.publishedKeys, source: "seed" as const });

function clone(bundle: ProofBundle): ProofBundle {
  return JSON.parse(JSON.stringify(bundle)) as ProofBundle;
}

describe("Verify in your browser", () => {
  it("matches all six plates on the seeded bundle and reads Sample (seeded keys)", async () => {
    const outcome = await runVerification({ bundle: snapshot.proof, keys: seedKeys, load });
    expect(outcome.failure).toBeNull();
    expect(outcome.verdict).toBe("sample");
    for (const plate of PLATES) expect(outcome.checks[plate].state).toBe("matches");
    expect(outcome.sampleKeys).toEqual(expect.arrayContaining(snapshot.proof.approvals.map((a) => a.keyId)));
    expect(outcome.chain.ok).toBe(true);
    expect(outcome.checkpoint.ok).toBe(true);
    expect(outcome.anchors.invoiceNumber).toBe(snapshot.proof.invoice.invoiceNumber);
    expect(outcome.trust).toBe("seed");
    expect(outcome.head).toBe(headOf(snapshot.proof));
  });

  it("fails on an edited line and names the plate it broke", async () => {
    const edited = clone(snapshot.proof);
    const line = edited.lines.find((l) => l.memberNo === "M-014");
    if (!line) throw new Error("seed has M-014");
    line.netCents += 1;
    line.canonical.netCents += 1;
    const outcome = await runVerification({ bundle: edited, keys: seedKeys, load });
    expect(outcome.verdict).toBe("failed");
    expect(outcome.failure?.where).toBe("computed");
    expect(outcome.checks.computed.state).toBe("differs");
  });

  it("fails closed when the keys are not the ones that signed", async () => {
    const strangers = {
      trust: { v: 1 as const, officers: [], ledger: [] },
      source: "published" as const,
    };
    const outcome = await runVerification({ bundle: snapshot.proof, keys: async () => strangers, load });
    expect(outcome.verdict).toBe("failed");
    expect(outcome.failure).not.toBeNull();
  });

  it("checks five of six on a public bundle whose receivers are withheld, and takes the server's word on plate 6", async () => {
    const publicTier = clone(snapshot.proof);
    for (const item of publicTier.batch.items) item.receiver = WITHHELD_RECEIVER;
    const partial = await runVerification({ bundle: publicTier, keys: seedKeys, load });
    expect(partial.verdict).toBe("partial");
    expect(partial.checks.payoutItems.state).toBe("withheld");
    expect(partial.failure).toBeNull();

    const attested: PlateResult = { ok: true, reason: null };
    const withServer = await runVerification({
      bundle: publicTier,
      keys: seedKeys,
      load,
      server: async () => attested,
    });
    expect(withServer.checks.payoutItems.state).toBe("server");
    expect(withServer.verdict).toBe("sample");
  });

  it("outcomeOf reports a broken chain before any plate", () => {
    const base = verifyModule.verifyChainWith(
      snapshot.proof,
      verifyModule.browserProofCrypto,
      snapshot.publishedKeys,
      {
        demoMode: true,
      },
    );
    const broken = outcomeOf(
      { ...base, chain: { ...base.chain, ok: false, brokenAtSeq: 12 } },
      { withheld: false, server: null, trust: "seed", head: "x" },
    );
    expect(broken.verdict).toBe("failed");
    expect(broken.failure).toEqual({ where: "chain", reason: "The record's hash chain breaks at entry 12." });
  });
});
