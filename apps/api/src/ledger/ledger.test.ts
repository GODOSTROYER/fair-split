// The ledger checkpoint key and signing (S3.12): a configured server key reads Verified, an unset one is a
// labelled sample key (stable when FS_COOKIE_SECRET is set), the published keys never carry a private half, and
// a checkpoint is never signed over a chain that does not verify.
import type { LedgerEntry } from "@fairsplit/contracts";
import { verifyChain } from "@fairsplit/domain";
import { getProof, getPublishedKeys } from "@fairsplit/seed";
import { describe, expect, it } from "vitest";
import { createCredentialKeys } from "../credentials/verify/index.js";
import { ApiProblem } from "../lib/problem.js";
import { checkLedger, signProofCheckpoint } from "./chain.js";
import {
  describeLedgerKey,
  ledgerSigningKey,
  publishedLedgerKeys,
  SAMPLE_LEDGER_KEY_ID,
  SERVER_LEDGER_KEY_ID,
} from "./keys.js";

const SECRET = "a-cookie-secret-for-tests-0123456789abcdef";

describe("the ledger signing key", () => {
  it("FS_LEDGER_SIGNING_KEY makes fs-ledger-k1, kind server: what it signs can read Verified", () => {
    const k = ledgerSigningKey({
      ledgerSigningKey: "11".repeat(32),
      credentialKeys: createCredentialKeys({ cookieSecret: SECRET }),
    });
    expect(describeLedgerKey(k)).toMatchObject({
      keyId: SERVER_LEDGER_KEY_ID,
      kind: "server",
      source: "configured",
      proofReads: "Verified",
    });
  });

  it("unset, it is a labelled sample key: stable for one cookie secret, different for another, ephemeral without", () => {
    const a = ledgerSigningKey({
      ledgerSigningKey: undefined,
      credentialKeys: createCredentialKeys({ cookieSecret: SECRET }),
    });
    const b = ledgerSigningKey({
      ledgerSigningKey: undefined,
      credentialKeys: createCredentialKeys({ cookieSecret: SECRET }),
    });
    const c = ledgerSigningKey({
      ledgerSigningKey: undefined,
      credentialKeys: createCredentialKeys({ cookieSecret: `${SECRET}-other` }),
    });
    const e = ledgerSigningKey({ ledgerSigningKey: undefined, credentialKeys: createCredentialKeys({}) });
    expect(a).toMatchObject({ keyId: SAMPLE_LEDGER_KEY_ID, kind: "seeded", source: "derived_sample" });
    expect(b.publicKeyHex).toBe(a.publicKeyHex);
    expect(c.publicKeyHex).not.toBe(a.publicKeyHex);
    expect(e.source).toBe("ephemeral_sample");
    expect(describeLedgerKey(a).proofReads).toBe("Sample");
  });

  it("publishes this server's key first, then the seed's sample key; public halves only", () => {
    const k = ledgerSigningKey({
      ledgerSigningKey: "22".repeat(32),
      credentialKeys: createCredentialKeys({ cookieSecret: SECRET }),
    });
    const published = publishedLedgerKeys(k);
    expect(published[0]).toEqual({
      keyId: SERVER_LEDGER_KEY_ID,
      publicKeyHex: k.publicKeyHex,
      kind: "server",
      revokedAt: null,
    });
    expect(published.slice(1)).toEqual(getPublishedKeys().ledger);
    const text = JSON.stringify(published);
    expect(text).not.toMatch(/private/i);
    for (const p of published)
      expect(Object.keys(p).sort()).toEqual(["keyId", "kind", "publicKeyHex", "revokedAt"]);
  });
});

describe("signing a Proof checkpoint", () => {
  const key = ledgerSigningKey({
    ledgerSigningKey: "33".repeat(32),
    credentialKeys: createCredentialKeys({ cookieSecret: SECRET }),
  });
  const seed = getProof();
  const trust = { officers: getPublishedKeys().officers, ledger: publishedLedgerKeys(key) };

  it("signs the head, dated now, or the head's own time when the clock is behind it", () => {
    const head = seed.ledger.at(-1) as LedgerEntry;
    const early = signProofCheckpoint(seed.ledger, seed.runId, key, new Date("2026-10-01T00:00:00.000Z"));
    expect(early).toMatchObject({
      keyId: SERVER_LEDGER_KEY_ID,
      seq: head.seq,
      entryHash: head.entryHash,
      at: head.at,
    });
    const late = signProofCheckpoint(seed.ledger, seed.runId, key, new Date("2026-11-30T00:00:00.000Z"));
    expect(late.at).toBe("2026-11-30T00:00:00.000Z");
    for (const checkpoint of [early, late]) {
      const v = verifyChain({ ...seed, checkpoint }, trust, { demoMode: true });
      expect(v.checkpoint).toEqual({ ok: true, reason: null, seq: head.seq, keyId: SERVER_LEDGER_KEY_ID });
      // seeded officer keys keep the whole bundle a Sample, never Verified
      expect(v.status).toBe("sample");
    }
  });

  it("never signs over a chain that does not verify, nor an empty one", () => {
    const tampered = seed.ledger.map((e, i) =>
      i === 10 ? { ...e, payload: { ...(e.payload as Record<string, unknown>), serials: ["9999"] } } : e,
    );
    expect(checkLedger(tampered)).toMatchObject({ ok: false, brokenAtSeq: 11 });
    expect(() => signProofCheckpoint(tampered, seed.runId, key, new Date())).toThrowError(ApiProblem);
    expect(() => signProofCheckpoint(tampered, seed.runId, key, new Date())).toThrow(
      /does not verify at entry 11/,
    );
    expect(() => signProofCheckpoint([], seed.runId, key, new Date())).toThrow(/nothing to prove/);
  });
});
