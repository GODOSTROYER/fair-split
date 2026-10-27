// Free text on a public chain (S3.12): ledger payloads carry IDs, enums, hashes and cents; free text stays in its
// own row and the chain keeps a hash of it. A bare sha256 of a short note ("kulang ang timbang") or a revocation
// reason is a dictionary away from the text itself, and the public Proof publishes the workspace's whole ledger
// segment, so the chain keeps a salted commitment instead:
//
//   textSha256 = sha256(salt ‖ utf8(text))
//   salt       = HMAC-SHA256(k, JCS{v: 1, purpose, ws, subject})   k = the `ledger:text-salt` subkey (HKDF from
//                                                                    FS_COOKIE_SECRET, src/credentials/verify/keys.ts)
//
// The salt is 32 bytes no outsider can compute: no dictionary or brute force opens a commitment, and two equal
// texts commit differently, so nothing links them. It is never stored: the server re-derives it to open one
// commitment for the people who may read the text (the member and the officers), who then check it with plain
// sha256 against the chain entry. An opening reveals nothing about any other commitment.
//
// Openings outlive only the key: rotating FS_COOKIE_SECRET (or an ephemeral dev key at restart) leaves earlier
// commitments intact on the chain but unopenable. A stored per-row salt (WS-DATA's `notes` table) would lift that.
import { createHash, createHmac } from "node:crypto";
import { jcs } from "@fairsplit/domain";
import type { CredentialKeys } from "../credentials/verify/index.js";

/** The HKDF purpose of the salt key: its own subkey, so no other HMAC use can produce these salts. */
export const TEXT_SALT_PURPOSE = "ledger:text-salt";

/** What a commitment binds: the text of one review request's note, or one key's revocation reason. */
export type CommitmentPurpose = "review.note" | "key.revoked.reason";

export interface CommitmentSubject {
  purpose: CommitmentPurpose;
  workspaceId: string;
  /** The row the text belongs to: a review request id, a key id. */
  subjectId: string;
}

/** The 32-byte salt of one subject's commitment (deterministic for the server, unpredictable to anyone else). */
export function commitmentSalt(keys: Pick<CredentialKeys, "hmacKey">, s: CommitmentSubject): Buffer {
  return createHmac("sha256", keys.hmacKey(TEXT_SALT_PURPOSE))
    .update(jcs({ v: 1, purpose: s.purpose, ws: s.workspaceId.toLowerCase(), subject: s.subjectId }), "utf8")
    .digest();
}

/** sha256(salt ‖ utf8(text)), hex: what anyone holding the opening recomputes. */
export function saltedSha256(salt: Uint8Array, text: string): string {
  return createHash("sha256").update(salt).update(text, "utf8").digest("hex");
}

export interface TextOpening {
  sha256: string;
  saltHex: string;
}

/** The commitment the chain records for `text`, with the salt that opens it (give the salt only to readers). */
export function commitText(
  keys: Pick<CredentialKeys, "hmacKey">,
  subject: CommitmentSubject,
  text: string,
): TextOpening {
  const salt = commitmentSalt(keys, subject);
  return { sha256: saltedSha256(salt, text), saltHex: salt.toString("hex") };
}
