import { getSnapshot } from "@fairsplit/api-client/seed";
import {
  GENESIS_PREV_HASH,
  type LedgerEntry,
  LedgerPayloads,
  ProofBundle,
  type PublishedKeys,
} from "@fairsplit/contracts";
import { ed25519 } from "@noble/curves/ed25519.js";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AppProviders } from "../../chrome/AppProviders.js";
import { jcs, utf8 } from "../../lib/jcs.js";
import { toHex } from "../../lib/sha256.js";
import * as browser from "../../lib/verify.js";
import { createTestRuntime } from "../../test/world.js";
import { deriveFigures } from "./metrics.js";
import { countItems, ledgerFacts, mergeItems, WITHHELD_RECEIVER } from "./model.js";
import { ProofView } from "./ProofView.js";
import type { ProofPage } from "./useProof.js";
import { PLATES, runVerification } from "./verify.js";

const snapshot = getSnapshot();
const REPLAY_REASON =
  "Replayed (labelled): these statuses come from a recorded run, not from verified simulator notices";

/** Rebuild real evidence and its signed checkpoint, without stubbing any verifier result. */
function replayFixture(): { bundle: ProofBundle; keys: PublishedKeys } {
  const original = snapshot.proof;
  const states = new Map<string, string>();
  const ledger: LedgerEntry[] = [];
  for (const entry of original.ledger) {
    let fact = entry;
    if (entry.kind === "webhook.applied") {
      const notice = LedgerPayloads["webhook.applied"].parse(entry.payload);
      if (notice.resource === "payout_item") {
        const from = states.get(notice.senderItemId) ?? "SUBMITTED";
        states.set(notice.senderItemId, notice.status);
        fact = {
          ...entry,
          kind: "payout.item.replayed",
          payload: {
            runId: original.runId,
            senderItemId: notice.senderItemId,
            payoutItemId: notice.payoutItemId,
            from,
            status: notice.status,
            provenance: "replay",
            source: notice.status === "RETURNED" ? "cancel" : "post_response",
          },
        };
      }
    }
    const seq = ledger.length + 1;
    const prevHash = ledger.at(-1)?.entryHash ?? GENESIS_PREV_HASH;
    ledger.push({
      ...fact,
      seq,
      prevHash,
      entryHash: browser.browserProofCrypto.sha256Hex(browser.ledgerPreimage(prevHash, seq, fact)),
    });
  }
  const head = ledger.at(-1);
  if (!head) throw new Error("Fixture requires a ledger head.");
  // A fresh test-only key is created in memory; no private material is serialized or printed.
  const privateKey = ed25519.utils.randomSecretKey();
  const checkpoint = { ...original.checkpoint, seq: head.seq, entryHash: head.entryHash };
  const signedBytes = utf8(
    jcs({
      purpose: "fairsplit.ledger.checkpoint",
      v: checkpoint.v,
      keyId: checkpoint.keyId,
      runId: checkpoint.runId,
      seq: checkpoint.seq,
      entryHash: checkpoint.entryHash,
      at: checkpoint.at,
    }),
  );
  const bundle = ProofBundle.parse({
    ...original,
    ledger,
    checkpoint: { ...checkpoint, signatureHex: toHex(ed25519.sign(signedBytes, privateKey)) },
    batch: {
      ...original.batch,
      items: original.batch.items.map((item) => ({ ...item, eventId: null, provenance: "replay" })),
    },
  });
  const keys = {
    ...snapshot.publishedKeys,
    ledger: snapshot.publishedKeys.ledger.map((key) =>
      key.keyId === checkpoint.keyId
        ? { ...key, publicKeyHex: toHex(ed25519.getPublicKey(privateKey)) }
        : key,
    ),
  };
  return { bundle, keys };
}

type Tier = "public" | "member" | "brand";

/** Matches fs-api's tier contract: only the member's own receiver survives a member read. */
function tierBundle(full: ProofBundle, tier: Tier): ProofBundle {
  return ProofBundle.parse({
    ...full,
    batch: {
      ...full.batch,
      items: full.batch.items.map((item) => ({
        ...item,
        receiver:
          tier === "brand" || (tier === "member" && item.senderItemId.endsWith("-M-014"))
            ? item.receiver
            : WITHHELD_RECEIVER,
      })),
    },
  });
}

describe("Proof's actual public, member and brand bundles", () => {
  it.each<[Tier, boolean]>([
    ["public", false],
    ["member", false],
    ["brand", false],
    ["public", true],
    ["member", true],
    ["brand", true],
  ])("inv.i8.%s tier renders all six plates correctly (replayed: %s)", async (tier, replayed) => {
    const fixture = replayed ? replayFixture() : { bundle: snapshot.proof, keys: snapshot.publishedKeys };
    const bundle = tierBundle(fixture.bundle, tier);
    const visible = bundle.batch.items.filter((item) => item.receiver !== WITHHELD_RECEIVER);
    expect(visible).toHaveLength(tier === "public" ? 0 : tier === "member" ? 1 : bundle.batch.items.length);
    if (tier === "member") expect(visible[0]?.senderItemId).toMatch(/-M-014$/);
    // Redaction must leave every signed preimage, line, hash and ledger record untouched.
    expect(bundle.ledger).toEqual(fixture.bundle.ledger);
    expect(bundle.approvals).toEqual(fixture.bundle.approvals);
    expect(bundle.checkpoint).toEqual(fixture.bundle.checkpoint);
    expect(bundle.lines).toEqual(fixture.bundle.lines);
    const serverResult = browser.verifyChainWith(fixture.bundle, browser.browserProofCrypto, fixture.keys, {
      demoMode: true,
    });
    expect(serverResult.status).toBe(replayed ? "replay" : "sample");
    expect(serverResult.chain.ok).toBe(true);
    expect(serverResult.checkpoint.ok).toBe(true);
    expect(serverResult.plates.payoutItems).toEqual(
      replayed ? { ok: true, state: "replay", reason: REPLAY_REASON } : { ok: true, reason: null },
    );
    const attestation = vi.fn(async () => serverResult.plates.payoutItems);
    const outcome = await runVerification({
      bundle,
      keys: async () => ({ trust: fixture.keys, source: "published" }),
      server: attestation,
      load: async () => browser,
    });
    expect(attestation).toHaveBeenCalledTimes(tier === "brand" ? 0 : 1);
    expect(outcome.withheld).toBe(tier !== "brand");
    expect(outcome.verdict).toBe(replayed ? "replay" : "sample");
    expect(outcome.failure).toBeNull();
    for (const plate of PLATES) {
      expect(outcome.checks[plate]).toEqual(
        plate === "payoutItems" && replayed
          ? { state: "replay", reason: REPLAY_REASON }
          : { state: plate === "payoutItems" && tier !== "brand" ? "server" : "matches", reason: null },
      );
    }
    const facts = ledgerFacts(bundle.ledger);
    const items = mergeItems(bundle.batch.items);
    const progress = countItems(items.map((item) => item.status));
    const page: ProofPage = {
      phase: "ready",
      error: null,
      retry: () => undefined,
      runSlug: bundle.runSlug,
      bundle,
      provenance: replayed ? "replay" : "seeded",
      withheld: tier !== "brand",
      items,
      lineStates: {},
      progress,
      progressEvent: null,
      live: false,
      notPosted: false,
      facts,
      figures: deriveFigures({ bundle, items, lineStates: {}, facts, holds: null, seeded: null }),
      fees: null,
      snapshot,
      runView: undefined,
    };
    const { runtime } = createTestRuntime();
    render(
      <AppProviders runtime={runtime} motion="reduced">
        <ProofView
          page={page}
          rail="simulator"
          verification={{
            state: { kind: "done", outcome, at: "2026-11-01T12:00:00Z", pressId: tier },
            verify: () => undefined,
          }}
        />
      </AppProviders>,
    );
    for (const plate of PLATES) {
      const expected =
        plate === "payoutItems" ? (replayed ? "replay" : tier !== "brand" ? "server" : "matches") : "matches";
      expect(screen.getByTestId(`W-PF-01.plate.${plate}`).dataset.state).toBe(expected);
      expect(screen.getByTestId(`W-PF-01.checks.${plate}`).dataset.state).toBe(expected);
    }
    expect(screen.getByTestId("W-PF-01.verdict.word").textContent).toBe(
      replayed ? "five of six match; one replayed, labelled" : "Sample",
    );
    expect(screen.getByTestId("W-PF-01.verdict.word").dataset.verdict).toBe(replayed ? "replay" : "sample");
    expect(
      screen.getByTestId("W-PF-01.checks").querySelectorAll('[data-state="matches"], [data-state="server"]'),
    ).toHaveLength(replayed ? 5 : 6);
    if (replayed) {
      fireEvent.click(screen.getByTestId("W-PF-01.plate.payoutItems.toggle"));
      expect(screen.getByTestId("W-PF-01.plate.payoutItems.reason").textContent).toBe(REPLAY_REASON);
      expect(screen.getByTestId("W-PF-01.verdict").textContent).not.toContain("Six of six match");
    } else {
      expect(screen.getByTestId("W-PF-01.verdict").textContent).toContain("Six of six match");
    }
    runtime.client.clear();
  });
});
