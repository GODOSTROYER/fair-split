// Credential resolution: request headers → one verified Credential (or none, or a typed refusal).
//
// Precedence: an explicit `Authorization: Bearer` wins over cookies, so the console token (treasurer:analyn)
// acts as Analyn even though the browser also carries the judge cookie. Bearer forms: opaque `fst_`/`fsd_`
// tokens (looked up by sha256 in frame_tokens), or signed `fsm_`/`fsb_` links. Cookies: `fs_js` (judge
// session), then `fs_ops` (operator). Nothing here trusts a workspace id from the request.

import type { Role } from "@fairsplit/contracts";
import { type Db, schema } from "@fairsplit/db";
import { and, eq, gt, isNotNull, isNull, or } from "drizzle-orm";
import type { Clock } from "../../lib/clock.js";
import { type ApiProblem, problem } from "../../lib/problem.js";
import {
  bearerToken,
  isLinkToken,
  JUDGE_COOKIE,
  JudgeCookiePayload,
  OPERATOR_COOKIE,
  OperatorCookiePayload,
  opaqueTokenSha256,
  parseOpaqueToken,
  verifyCookie,
  verifyLink,
} from "./codec.js";
import type { CredentialKeys } from "./keys.js";
import type { Credential } from "./types.js";

/** A bearer token row as the verifier needs it. */
export interface TokenRow {
  id: string;
  workspaceId: string;
  persona: string;
  role: Role;
  memberId: string | null;
  sessionId: string | null;
  expiresAt: Date;
  revokedAt: Date | null;
  /** The workspace's own expiry (judge workspaces: 24 h); null = never. */
  workspaceExpiresAt: Date | null;
}

/** Storage the verifier reads. `dbCredentialStore(db)` in the app; `memoryCredentialStore()` in tests. */
export interface CredentialStore {
  findTokenBySha256(sha256: string): Promise<TokenRow | null>;
  /** True when the workspace exists and has not expired at `now`. */
  workspaceAlive(workspaceId: string, now: Date): Promise<boolean>;
  /** Member and brand links are revocable by `jti`. */
  isLinkRevoked(jti: string): Promise<boolean>;
}

export type ResolveResult =
  | { kind: "none" }
  | { kind: "ok"; credential: Credential }
  | { kind: "invalid"; problem: ApiProblem };

export interface RequestCredentials {
  authorization?: string | null | undefined;
  cookies?: Readonly<Record<string, string | undefined>>;
}

export interface CredentialResolver {
  resolve(req: RequestCredentials): Promise<ResolveResult>;
}

export function createCredentialResolver(deps: {
  store: CredentialStore;
  keys: CredentialKeys;
  clock: Clock;
}): CredentialResolver {
  const { store, keys, clock } = deps;

  async function fromBearer(token: string): Promise<ResolveResult> {
    const now = clock.now();
    if (isLinkToken(token)) {
      const v = verifyLink(keys.linkPublicKeyHex, token, now.getTime());
      if (!v.ok)
        return invalid(
          v.reason === "expired" ? problem.expired("This link has expired.") : problem.unauthenticated(),
        );
      const p = v.payload;
      if (await store.isLinkRevoked(p.jti)) return invalid(problem.unauthenticated("This link was revoked."));
      if (!(await store.workspaceAlive(p.ws, now)))
        return invalid(problem.expired("This link's workspace has ended."));
      const expiresAt = new Date(p.exp * 1000);
      return p.k === "member"
        ? ok({
            kind: "member_link",
            workspaceId: p.ws,
            lineId: p.lineId,
            jti: p.jti,
            role: "member",
            expiresAt,
          })
        : ok({ kind: "brand_link", workspaceId: p.ws, brand: p.brand, jti: p.jti, role: "brand", expiresAt });
    }
    const opaque = parseOpaqueToken(token);
    if (!opaque) return invalid(problem.unauthenticated());
    const row = await store.findTokenBySha256(opaqueTokenSha256(token));
    if (!row || row.revokedAt) return invalid(problem.unauthenticated());
    if (row.expiresAt.getTime() <= now.getTime()) return invalid(problem.expired());
    if (row.workspaceExpiresAt && row.workspaceExpiresAt.getTime() <= now.getTime()) {
      return invalid(problem.expired("This session's workspace has ended. Start again."));
    }
    return ok({
      kind: opaque.kind,
      tokenId: row.id,
      workspaceId: row.workspaceId,
      persona: row.persona,
      role: row.role,
      memberId: row.memberId,
      sessionId: row.sessionId,
      expiresAt: row.expiresAt,
    });
  }

  async function fromCookies(cookies: Readonly<Record<string, string | undefined>>): Promise<ResolveResult> {
    const nowMs = clock.nowMs();
    const judge = cookies[JUDGE_COOKIE.name];
    if (judge !== undefined) {
      const v = verifyCookie(JudgeCookiePayload, keys.hmacKey(JUDGE_COOKIE.purpose), judge, nowMs);
      if (!v.ok)
        return invalid(
          v.reason === "expired"
            ? problem.expired("Your judge session has ended.")
            : problem.unauthenticated(),
        );
      if (!(await store.workspaceAlive(v.payload.ws, clock.now()))) {
        return invalid(problem.expired("Your judge session's workspace has ended. Start again."));
      }
      return ok({
        kind: "judge_session",
        sessionId: v.payload.sid,
        workspaceId: v.payload.ws,
        role: "judge",
        persona: "judge",
        expiresAt: new Date(v.payload.exp * 1000),
      });
    }
    const op = cookies[OPERATOR_COOKIE.name];
    if (op !== undefined) {
      const v = verifyCookie(OperatorCookiePayload, keys.hmacKey(OPERATOR_COOKIE.purpose), op, nowMs);
      if (!v.ok)
        return invalid(
          v.reason === "expired" ? problem.expired("Sign in to /ops again.") : problem.unauthenticated(),
        );
      return ok({
        kind: "operator",
        role: "operator",
        persona: "operator",
        expiresAt: new Date(v.payload.exp * 1000),
      });
    }
    return { kind: "none" };
  }

  return {
    async resolve(req) {
      const token = bearerToken(req.authorization);
      if (req.authorization && !token)
        return invalid(problem.unauthenticated("Use `Authorization: Bearer <token>`."));
      if (token) return fromBearer(token);
      return fromCookies(req.cookies ?? {});
    },
  };
}

function ok(credential: Credential): ResolveResult {
  return { kind: "ok", credential };
}

function invalid(p: ApiProblem): ResolveResult {
  return { kind: "invalid", problem: p };
}

/**
 * The production store: frame_tokens joined with workspaces. Link revocation is required, never defaulted: a
 * store without it would keep honouring revoked member and brand links (fail-open). fs-api passes the judge
 * slice's ledger-backed check through `appCredentialStore(db)` (src/lib/credential-store.ts).
 */
export function dbCredentialStore(
  db: Db,
  opts: { isLinkRevoked: (jti: string) => Promise<boolean> },
): CredentialStore {
  const ft = schema.frameTokens;
  const ws = schema.workspaces;
  return {
    async findTokenBySha256(sha256) {
      const [row] = await db
        .select({
          id: ft.id,
          workspaceId: ft.workspaceId,
          persona: ft.persona,
          role: ft.role,
          memberId: ft.memberId,
          sessionId: ft.sessionId,
          expiresAt: ft.expiresAt,
          revokedAt: ft.revokedAt,
          workspaceExpiresAt: ws.expiresAt,
        })
        .from(ft)
        .innerJoin(ws, eq(ws.id, ft.workspaceId))
        .where(eq(ft.tokenSha256, sha256))
        .limit(1);
      return row ? { ...row, role: row.role as Role } : null;
    },
    async workspaceAlive(workspaceId, now) {
      // In use: it never expires, or it is claimed and unexpired. A judge workspace whose session ended (a Reset
      // clears the claim; the database never moves an expiry earlier) is not, whatever its expiry says.
      const [row] = await db
        .select({ id: ws.id })
        .from(ws)
        .where(
          and(
            eq(ws.id, workspaceId),
            or(isNull(ws.expiresAt), and(isNotNull(ws.claimedAt), gt(ws.expiresAt, now))),
          ),
        )
        .limit(1);
      return !!row;
    },
    isLinkRevoked: opts.isLinkRevoked,
  };
}

/** An in-memory store for tests and the no-database harness. */
export function memoryCredentialStore(): CredentialStore & {
  tokens: Map<string, TokenRow>;
  workspaces: Map<string, Date | null>;
  revokedLinks: Set<string>;
} {
  const tokens = new Map<string, TokenRow>();
  const workspaces = new Map<string, Date | null>();
  const revokedLinks = new Set<string>();
  return {
    tokens,
    workspaces,
    revokedLinks,
    async findTokenBySha256(sha256) {
      return tokens.get(sha256) ?? null;
    },
    async workspaceAlive(workspaceId, now) {
      if (!workspaces.has(workspaceId)) return false;
      const exp = workspaces.get(workspaceId) ?? null;
      return exp === null || exp.getTime() > now.getTime();
    },
    async isLinkRevoked(jti) {
      return revokedLinks.has(jti);
    },
  };
}
