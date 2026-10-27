// Single-use pairing (S3.8, M-ON-01): the stage or the treasurer makes a pairing for one persona; a phone
// claims it once, by scanning `https://<origin>/app/pair#t=<token>` (the token stays in the fragment, so it
// never reaches a server log or a Referer) or by typing the 6-digit code, within 10 minutes.
//
// Storage: `pairing_tokens.token_sha256` = sha256(token) (256 random bits); `code6_sha256` =
// HMAC-SHA256(cookie-secret subkey `pairing:code6`, code) in hex, so a database dump does not reveal live
// codes (a plain sha256 of six digits is reversed by trying a million). A claim is a compare-and-set
// (`used_at IS NULL AND expires_at > now`), so two phones racing for one code cannot both win.
import { createHash, createHmac, randomBytes, randomInt } from "node:crypto";
import type { Role } from "@fairsplit/contracts";
import { type DbOrTx, schema, uuidv7 } from "@fairsplit/db";
import { and, eq, gt, isNull } from "drizzle-orm";
import type { CredentialKeys } from "../verify/index.js";
import { PAIRING_TTL_MS } from "../verify/index.js";
import type { PersonaRef } from "./personas.js";

export const PAIRING_TOKEN_PREFIX = "fsp_";
const PAIRING_TOKEN_RE = /^fsp_[A-Za-z0-9_-]{43}$/;
const CODE6_PURPOSE = "pairing:code6";

export function generatePairingToken(): string {
  return `${PAIRING_TOKEN_PREFIX}${randomBytes(32).toString("base64url")}`;
}

export function isPairingToken(token: string): boolean {
  return PAIRING_TOKEN_RE.test(token);
}

/** Six digits from a CSPRNG (leading zeros kept). */
export function generateCode6(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
}

export function pairingTokenSha256(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function code6Digest(keys: CredentialKeys, code6: string): string {
  return createHmac("sha256", keys.hmacKey(CODE6_PURPOSE)).update(code6, "utf8").digest("hex");
}

export interface CreatedPairing {
  id: string;
  /** Goes only into the URL fragment. */
  token: string;
  code6: string;
  url: string;
  expiresAt: Date;
}

export interface PairingRow {
  id: string;
  workspaceId: string;
  persona: string;
  role: Role;
  memberId: string | null;
  expiresAt: Date;
  usedAt: Date | null;
}

const columns = {
  id: schema.pairingTokens.id,
  workspaceId: schema.pairingTokens.workspaceId,
  persona: schema.pairingTokens.persona,
  role: schema.pairingTokens.role,
  memberId: schema.pairingTokens.memberId,
  expiresAt: schema.pairingTokens.expiresAt,
  usedAt: schema.pairingTokens.usedAt,
};

/** Inserts a pairing (10 minutes, never past the workspace's end). */
export async function createPairingRow(
  tx: DbOrTx,
  o: {
    keys: CredentialKeys;
    publicOrigin: string;
    workspaceId: string;
    ref: PersonaRef;
    now: Date;
    workspaceExpiresAt: Date | null;
  },
): Promise<CreatedPairing> {
  const expiresAt = new Date(
    Math.min(o.now.getTime() + PAIRING_TTL_MS, o.workspaceExpiresAt?.getTime() ?? Number.POSITIVE_INFINITY),
  );
  if (expiresAt.getTime() <= o.now.getTime()) throw new RangeError("createPairing: the workspace has ended");
  // A code is claimed without naming a workspace, so it must be unique among live codes everywhere.
  let code6 = generateCode6();
  for (let attempt = 0; attempt < 8; attempt++) {
    if (!(await liveCodeExists(tx, code6Digest(o.keys, code6), o.now))) break;
    code6 = generateCode6();
  }
  const token = generatePairingToken();
  const id = uuidv7();
  await tx.insert(schema.pairingTokens).values({
    id,
    workspaceId: o.workspaceId,
    tokenSha256: pairingTokenSha256(token),
    code6Sha256: code6Digest(o.keys, code6),
    persona: o.ref.persona,
    role: o.ref.role,
    memberId: o.ref.memberId,
    expiresAt,
  });
  return { id, token, code6, url: `${o.publicOrigin}/app/pair#t=${token}`, expiresAt };
}

async function liveCodeExists(db: DbOrTx, digest: string, now: Date): Promise<boolean> {
  const [row] = await db
    .select({ id: schema.pairingTokens.id })
    .from(schema.pairingTokens)
    .where(
      and(
        eq(schema.pairingTokens.code6Sha256, digest),
        isNull(schema.pairingTokens.usedAt),
        gt(schema.pairingTokens.expiresAt, now),
      ),
    )
    .limit(1);
  return !!row;
}

export type PairingLookup =
  | { ok: true; row: PairingRow; via: "qr" | "code6" }
  | { ok: false; reason: "unknown" | "used" | "expired" | "ambiguous" };

/** Finds the pairing a claim names (no lock, no write): by token, or by a live code. */
export async function findPairing(
  db: DbOrTx,
  keys: CredentialKeys,
  claim: { token: string } | { code6: string },
  now: Date,
): Promise<PairingLookup> {
  if ("token" in claim) {
    if (!isPairingToken(claim.token)) return { ok: false, reason: "unknown" };
    const [row] = await db
      .select(columns)
      .from(schema.pairingTokens)
      .where(eq(schema.pairingTokens.tokenSha256, pairingTokenSha256(claim.token)))
      .limit(1);
    if (!row) return { ok: false, reason: "unknown" };
    if (row.usedAt) return { ok: false, reason: "used" };
    if (row.expiresAt.getTime() <= now.getTime()) return { ok: false, reason: "expired" };
    return { ok: true, row: { ...row, role: row.role as Role }, via: "qr" };
  }
  const rows = await db
    .select(columns)
    .from(schema.pairingTokens)
    .where(
      and(
        eq(schema.pairingTokens.code6Sha256, code6Digest(keys, claim.code6)),
        isNull(schema.pairingTokens.usedAt),
        gt(schema.pairingTokens.expiresAt, now),
      ),
    )
    .limit(2);
  if (rows.length === 0) return { ok: false, reason: "unknown" };
  // Two live pairings with one code (one in a million, and only under a race): refuse both; the QR still works.
  if (rows.length > 1) return { ok: false, reason: "ambiguous" };
  const row = rows[0] as (typeof rows)[number];
  return { ok: true, row: { ...row, role: row.role as Role }, via: "code6" };
}

/** Compare-and-set: marks the pairing used. False when another claim won or it expired meanwhile. */
export async function consumePairing(tx: DbOrTx, id: string, now: Date): Promise<boolean> {
  const rows = await tx
    .update(schema.pairingTokens)
    .set({ usedAt: now })
    .where(
      and(
        eq(schema.pairingTokens.id, id),
        isNull(schema.pairingTokens.usedAt),
        gt(schema.pairingTokens.expiresAt, now),
      ),
    )
    .returning({ id: schema.pairingTokens.id });
  return rows.length === 1;
}
