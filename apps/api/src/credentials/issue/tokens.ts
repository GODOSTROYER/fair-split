// Bearer token issuance (S3.8): console and frame tokens (`fst_`, 2 h) and app device tokens (`fsd_`, from a
// pairing claim). The token is returned to the caller once; only its sha256 is stored (`frame_tokens`), and
// it never outlives its workspace: a judge workspace ends after 24 h, so every token minted in it ends then
// too. The verifier (src/credentials/verify) reads the same rows through the same codec.
import type { Role } from "@fairsplit/contracts";
import { type DbOrTx, schema, uuidv7 } from "@fairsplit/db";
import { and, asc, eq, isNotNull, isNull } from "drizzle-orm";
import {
  DEVICE_TOKEN_TTL_MS,
  FRAME_TOKEN_TTL_MS,
  generateOpaqueToken,
  type OpaqueKind,
  opaqueTokenSha256,
} from "../verify/index.js";

/** The console acts as Analyn (S3.8): the treasurer persona of every judge workspace. */
export const CONSOLE_PERSONA = { role: "treasurer", persona: "analyn" } as const satisfies {
  role: Role;
  persona: string;
};

export interface MintTokenInput {
  workspaceId: string;
  /** `frame` → `fst_` (stage frames and the console, 2 h); `device` → `fsd_` (a paired phone). */
  kind: OpaqueKind;
  role: Role;
  persona: string;
  memberId?: string | null;
  /** The judge session that minted it: recorded as impersonated_by `judge_session:{sid}`. */
  sessionId?: string | null;
  now: Date;
  /** The workspace's own expiry (null = never); the token never outlives it. */
  workspaceExpiresAt: Date | null;
  /** Defaults: 2 h for frame tokens, 30 days for device tokens. */
  ttlMs?: number;
}

export interface MintedToken {
  /** The bearer secret. Return it once; it is never stored, logged or put in a URL. */
  token: string;
  tokenId: string;
  expiresAt: Date;
}

/** min(now + ttl, workspace expiry): a token never outlives its workspace. */
export function tokenExpiry(
  now: Date,
  kind: OpaqueKind,
  workspaceExpiresAt: Date | null,
  ttlMs?: number,
): Date {
  const ttl = ttlMs ?? (kind === "frame" ? FRAME_TOKEN_TTL_MS : DEVICE_TOKEN_TTL_MS);
  const own = now.getTime() + ttl;
  const cap = workspaceExpiresAt?.getTime() ?? Number.POSITIVE_INFINITY;
  return new Date(Math.min(own, cap));
}

/** Inserts a `frame_tokens` row (sha256 only) and returns the token once. */
export async function mintBearerToken(db: DbOrTx, i: MintTokenInput): Promise<MintedToken> {
  const expiresAt = tokenExpiry(i.now, i.kind, i.workspaceExpiresAt, i.ttlMs);
  if (expiresAt.getTime() <= i.now.getTime()) {
    throw new RangeError("mintBearerToken: the workspace has already ended");
  }
  const token = generateOpaqueToken(i.kind);
  const tokenId = uuidv7();
  await db.insert(schema.frameTokens).values({
    id: tokenId,
    workspaceId: i.workspaceId,
    tokenSha256: opaqueTokenSha256(token),
    sessionId: i.sessionId ?? null,
    persona: i.persona,
    role: i.role,
    memberId: i.memberId ?? null,
    expiresAt,
  });
  return { token, tokenId, expiresAt };
}

/** Revokes every live token of a workspace (judge Reset). Returns how many were revoked. */
export async function revokeWorkspaceTokens(db: DbOrTx, workspaceId: string, now: Date): Promise<number> {
  const rows = await db
    .update(schema.frameTokens)
    .set({ revokedAt: now })
    .where(and(eq(schema.frameTokens.workspaceId, workspaceId), isNull(schema.frameTokens.revokedAt)))
    .returning({ id: schema.frameTokens.id });
  return rows.length;
}

/**
 * The judge session that owns a judge workspace: the session id its console token was minted with. A judge
 * workspace is claimed by exactly one session, so every token minted in it carries the same id.
 */
export async function sessionOfWorkspace(db: DbOrTx, workspaceId: string): Promise<string | null> {
  const [row] = await db
    .select({ sessionId: schema.frameTokens.sessionId })
    .from(schema.frameTokens)
    .where(and(eq(schema.frameTokens.workspaceId, workspaceId), isNotNull(schema.frameTokens.sessionId)))
    .orderBy(asc(schema.frameTokens.createdAt))
    .limit(1);
  return row?.sessionId ?? null;
}
