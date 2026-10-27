// Signed links (S3.8): a member's statement link `/s/:token` (one line, read-only, 30 days, revocable,
// sent with Referrer-Policy: no-referrer) and a brand link `/b/:token` (the Proof brand tier of one
// workspace, 30 days). Both are Ed25519-signed with FS_LINK_SIGNING_KEY through the shared codec, so the
// verifier and this issuer agree on every byte. A link never outlives its workspace.
//
// Issuance and revocation are recorded in the workspace's attribution ledger (`link.issued`, `link.revoked`:
// ids and expiry only, never the token). `isLinkRevoked(db, jti)` reads those entries; the shell's
// `dbCredentialStore(db, { isLinkRevoked })` takes it, so a revoked link stops verifying everywhere.
import { randomBytes } from "node:crypto";
import { appendLedger, type DbOrTx, schema, type WorkspaceScope } from "@fairsplit/db";
import { and, eq, sql } from "drizzle-orm";
import type { AppDeps } from "../../lib/context.js";
import { LINK_TTL_MS, type LinkPayload, signLink, verifyLink } from "../verify/index.js";

export type LinkKind = "member" | "brand";

export interface IssuedLink {
  kind: LinkKind;
  /** The signed token. It is the link's secret: put it only in `url`, never in logs. */
  token: string;
  /** `https://<origin>/s/<token>` or `https://<origin>/b/<token>`. */
  url: string;
  jti: string;
  expiresAt: Date;
}

/** 128 random bits, base64url (22 characters): unique per link, rotated on every reprint. */
export function newJti(): string {
  return randomBytes(16).toString("base64url");
}

function expiryOf(now: Date, workspaceExpiresAt: Date | null, ttlMs = LINK_TTL_MS): Date {
  const own = now.getTime() + ttlMs;
  return new Date(Math.min(own, workspaceExpiresAt?.getTime() ?? Number.POSITIVE_INFINITY));
}

function sign(deps: AppDeps, payload: LinkPayload): string {
  return signLink(deps.credentials.keys.linkPrivateKey, payload);
}

/** A member's statement link for one line. */
export function issueMemberLink(
  deps: AppDeps,
  o: { workspaceId: string; lineId: string; now: Date; workspaceExpiresAt: Date | null; ttlMs?: number },
): IssuedLink {
  const jti = newJti();
  const expiresAt = expiryOf(o.now, o.workspaceExpiresAt, o.ttlMs);
  const token = sign(deps, {
    v: 1,
    k: "member",
    ws: o.workspaceId,
    lineId: o.lineId,
    jti,
    exp: Math.floor(expiresAt.getTime() / 1000),
  });
  return { kind: "member", token, url: `${deps.env.publicOrigin}/s/${token}`, jti, expiresAt };
}

/** A brand link: the Proof brand tier (names, masked e-mails, export) of one workspace. */
export function issueBrandLink(
  deps: AppDeps,
  o: { workspaceId: string; brand: string; now: Date; workspaceExpiresAt: Date | null; ttlMs?: number },
): IssuedLink {
  const jti = newJti();
  const expiresAt = expiryOf(o.now, o.workspaceExpiresAt, o.ttlMs);
  const token = sign(deps, {
    v: 1,
    k: "brand",
    ws: o.workspaceId,
    brand: o.brand,
    jti,
    exp: Math.floor(expiresAt.getTime() / 1000),
  });
  return { kind: "brand", token, url: `${deps.env.publicOrigin}/b/${token}`, jti, expiresAt };
}

/** Records an issued link in the workspace ledger (ids and expiry only). Call inside the issuing transaction. */
export async function recordLinkIssued(
  tx: DbOrTx,
  scope: WorkspaceScope,
  link: IssuedLink,
  subject: { lineId: string } | { brand: string },
  at: Date,
): Promise<void> {
  await appendLedger(tx, scope, {
    kind: "link.issued",
    payload: { kind: link.kind, jti: link.jti, exp: link.expiresAt.toISOString(), ...subject },
    at,
  });
}

/** Revokes a link by its id (idempotent). Returns false when it was already revoked. */
export async function revokeLink(
  tx: DbOrTx,
  scope: WorkspaceScope,
  o: { jti: string; reason?: string; at: Date },
): Promise<boolean> {
  if (await isLinkRevoked(tx, o.jti)) return false;
  await appendLedger(tx, scope, {
    kind: "link.revoked",
    payload: { jti: o.jti, ...(o.reason ? { reason: o.reason } : {}) },
    at: o.at,
  });
  return true;
}

/** True when a `link.revoked` entry names this jti (any workspace: a jti is 128 random bits). */
export async function isLinkRevoked(db: DbOrTx, jti: string): Promise<boolean> {
  const le = schema.ledgerEntries;
  const [row] = await db
    .select({ id: le.id })
    .from(le)
    .where(and(eq(le.kind, "link.revoked"), sql`${le.payload}->>'jti' = ${jti}`))
    .limit(1);
  return !!row;
}

/**
 * True when a `link.issued` entry for this jti (of this kind, when given) exists in the workspace: a
 * revocation must name a real link, and the treasurer's statement-link revoke names a member link only.
 */
export async function linkWasIssued(
  db: DbOrTx,
  workspaceId: string,
  jti: string,
  kind?: LinkKind,
): Promise<boolean> {
  const le = schema.ledgerEntries;
  const [row] = await db
    .select({ id: le.id })
    .from(le)
    .where(
      and(
        eq(le.workspaceId, workspaceId),
        eq(le.kind, "link.issued"),
        sql`${le.payload}->>'jti' = ${jti}`,
        ...(kind ? [sql`${le.payload}->>'kind' = ${kind}`] : []),
      ),
    )
    .limit(1);
  return !!row;
}

export type LinkCheck =
  | { ok: true; payload: LinkPayload; expiresAt: Date }
  | { ok: false; reason: "malformed" | "bad_signature" | "expired" | "revoked" | "workspace_ended" };

/**
 * Full verification of a link outside the resolver (the `/s` and `/b` redirects): signature, expiry,
 * revocation and the workspace, in that order. Never throws; never logs the token.
 */
export async function checkLink(deps: AppDeps, token: string, kind: LinkKind): Promise<LinkCheck> {
  const now = deps.clock.now();
  const v = verifyLink(deps.credentials.keys.linkPublicKeyHex, token, now.getTime());
  if (!v.ok) return { ok: false, reason: v.reason };
  if (v.payload.k !== kind) return { ok: false, reason: "malformed" };
  if (await isLinkRevoked(deps.db, v.payload.jti)) return { ok: false, reason: "revoked" };
  if (!(await deps.credentials.store.workspaceAlive(v.payload.ws, now))) {
    return { ok: false, reason: "workspace_ended" };
  }
  return { ok: true, payload: v.payload, expiresAt: new Date(v.payload.exp * 1000) };
}
