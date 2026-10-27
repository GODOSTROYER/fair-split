// Real Ed25519 approvals for tests, made with WS-CORE's own functions: domain `buildApprovalPayload`
// builds the register §8 payload as the approved plan amends it (with `linesDigest`), `approvalBytes`
// gives the JCS bytes an approver signs, and `ed25519Sign` signs them. Each signer stands for a row of
// the officer key registry (`device_keys` joined with the officer's role): the service looks the
// signer up there with domain `expectedSigner` and verifies against that row only, never against the
// approval's own publicKeyHex.

import { randomBytes } from "node:crypto";
import type { ApprovalPayload, ApprovalRole, OfficerKey, SignedApproval } from "@fairsplit/contracts";
import {
  approvalBytes,
  buildApprovalPayload,
  type Ed25519KeyPair,
  ed25519FromSeed,
  ed25519Sign,
  sha256Hex,
} from "@fairsplit/domain";

export interface TestSigner extends Ed25519KeyPair {
  role: ApprovalRole;
  approverId: string;
  keyId: string;
  /** The registry row's kind; a key's ID shape tells it (S3.8, C-13). */
  kind: OfficerKey["kind"];
}

/** The kind a key ID's shape names: `a{n}` app, `w{n}` web, `demo-{6}` web_demo, `s{n}` seeded. */
function kindOf(keyId: string): OfficerKey["kind"] {
  if (/-a\d+$/.test(keyId)) return "app";
  if (/-w\d+$/.test(keyId)) return "web";
  if (/-demo-[a-z0-9]{6}$/.test(keyId)) return "web_demo";
  return "seeded";
}

/**
 * A signer whose key pair derives from `seed` (by default its key ID), so two signers made with one
 * seed hold one key: what the distinct-keys rule must refuse.
 */
export function makeSigner(
  role: ApprovalRole,
  approverId: string,
  keyId: string,
  seed: string = keyId,
): TestSigner {
  return { role, approverId, keyId, kind: kindOf(keyId), ...ed25519FromSeed(sha256Hex(`test key ${seed}`)) };
}

/** Analyn signs as treasurer with her web key; Ernesto co-signs as Chair with his app key (S3.8). */
export const TREASURER = makeSigner("treasurer", "treasurer:analyn", "fs-analyn-w1");
export const CHAIR = makeSigner("chair", "board:ernesto", "fs-ernesto-a1");
/** A key nobody registered. */
export const STRANGER = makeSigner("treasurer", "treasurer:analyn", "fs-mallory-w9");

/** The registry row a signer stands for. */
export function officerKey(signer: TestSigner, extra: Partial<OfficerKey> = {}): OfficerKey {
  return {
    keyId: signer.keyId,
    approverId: signer.approverId,
    role: signer.role,
    publicKeyHex: signer.publicKeyHex,
    kind: signer.kind,
    revokedAt: null,
    ...extra,
  };
}

/** The officer key registry as the server reads it from `device_keys`: Analyn's and Ernesto's keys. */
export const OFFICER_KEYS: readonly OfficerKey[] = [officerKey(TREASURER), officerKey(CHAIR)];

export function signPayload(signer: TestSigner, payload: ApprovalPayload): SignedApproval {
  return {
    role: payload.role,
    keyId: signer.keyId,
    publicKeyHex: signer.publicKeyHex,
    payload,
    signatureHex: ed25519Sign(signer.privateKey, approvalBytes(payload)),
  };
}

export interface BatchFacts {
  runId: string;
  seasonId: string;
  rateCardSha256: string;
  batchSha256: string;
  /** Domain `linesDigest` over every member line of the run, cash lines included. */
  linesDigest: string;
  itemCount: number;
  totalCents: number;
}

/**
 * Domain `buildApprovalPayload` for one signer, signed. `payload` overrides fields after the build
 * (unchecked), so a test can sign what a client should never have been given.
 */
export function approve(
  signer: TestSigner,
  batch: BatchFacts,
  options: { exp: string; nonce?: string; payload?: Partial<ApprovalPayload> },
): SignedApproval {
  const built = buildApprovalPayload({
    runId: batch.runId,
    seasonId: batch.seasonId,
    rateCardSha256: batch.rateCardSha256,
    batch: { batchSha256: batch.batchSha256, itemCount: batch.itemCount, totalCents: batch.totalCents },
    linesDigest: batch.linesDigest,
    role: signer.role,
    approverId: signer.approverId,
    nonce: options.nonce ?? randomBytes(12).toString("hex"),
    exp: options.exp,
  });
  return signPayload(signer, { ...built, ...options.payload } as ApprovalPayload);
}
