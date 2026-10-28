// Mint real credentials for tests (the same codec the verifier and the judge slice's issuer use).
// Memory mode registers tokens and workspaces in the in-memory store; Postgres mode inserts real rows.
import { randomUUID } from "node:crypto";
import type { Role } from "@fairsplit/contracts";
import { type Db, schema } from "@fairsplit/db";
import {
  FRAME_TOKEN_TTL_MS,
  generateOpaqueToken,
  JUDGE_COOKIE,
  JUDGE_COOKIE_TTL_MS,
  LINK_TTL_MS,
  type memoryCredentialStore,
  OPERATOR_COOKIE,
  OPERATOR_COOKIE_TTL_MS,
  opaqueTokenSha256,
  signCookie,
  signLink,
} from "../credentials/verify/index.js";
import type { AppDeps } from "../lib/context.js";

export interface FrameTokenOptions {
  workspaceId: string;
  role?: Role;
  persona?: string;
  memberId?: string | null;
  /** The judge session that minted it (actor impersonated_by). */
  sessionId?: string | null;
  kind?: "frame" | "device";
  expiresAt?: Date;
  revoked?: boolean;
}

/** Ready-made headers: `as: creds.bearer(token)` or `as: creds.cookie(value)` on harness requests. */
export type TestAuth = { authorization: string } | { cookie: string };

export class TestCredentials {
  constructor(
    private readonly deps: AppDeps,
    private readonly memory: ReturnType<typeof memoryCredentialStore> | null,
    private readonly db: Db | null,
  ) {}

  /** A workspace credentials can bind to. Memory: registered as alive. Postgres: use `fixtureWorkspace` instead. */
  workspace(expiresAt: Date | null = null): string {
    const id = randomUUID();
    if (this.memory) this.memory.workspaces.set(id, expiresAt);
    return id;
  }

  /** Mark a workspace as known (memory mode) so cookies and links bound to it verify. */
  registerWorkspace(id: string, expiresAt: Date | null = null): void {
    this.memory?.workspaces.set(id, expiresAt);
  }

  async frameToken(o: FrameTokenOptions): Promise<string> {
    const kind = o.kind ?? "frame";
    const token = generateOpaqueToken(kind);
    const role = o.role ?? "treasurer";
    const persona = o.persona ?? "analyn";
    const expiresAt = o.expiresAt ?? new Date(this.deps.clock.nowMs() + FRAME_TOKEN_TTL_MS);
    const row = {
      id: randomUUID(),
      workspaceId: o.workspaceId,
      persona,
      role,
      memberId: o.memberId ?? null,
      sessionId: o.sessionId ?? null,
      expiresAt,
      revokedAt: o.revoked ? new Date(this.deps.clock.nowMs()) : null,
    };
    if (this.memory) {
      if (!this.memory.workspaces.has(o.workspaceId)) this.memory.workspaces.set(o.workspaceId, null);
      this.memory.tokens.set(opaqueTokenSha256(token), {
        ...row,
        workspaceExpiresAt: this.memory.workspaces.get(o.workspaceId) ?? null,
      });
    } else if (this.db) {
      await this.db.insert(schema.frameTokens).values({
        id: row.id,
        workspaceId: row.workspaceId,
        tokenSha256: opaqueTokenSha256(token),
        sessionId: row.sessionId,
        persona,
        role,
        memberId: row.memberId,
        expiresAt,
        revokedAt: row.revokedAt,
      });
    }
    return token;
  }

  /** The `fs_js` cookie value for a judge session. */
  judgeCookie(o: { workspaceId: string; sessionId?: string; ttlMs?: number }): string {
    const now = Math.floor(this.deps.clock.nowMs() / 1000);
    return signCookie(this.deps.credentials.keys.hmacKey(JUDGE_COOKIE.purpose), {
      v: 1,
      sid: o.sessionId ?? randomUUID(),
      ws: o.workspaceId,
      iat: now,
      exp: now + Math.floor((o.ttlMs ?? JUDGE_COOKIE_TTL_MS) / 1000),
    });
  }

  /** The `fs_ops` cookie value for the operator. */
  operatorCookie(o: { ttlMs?: number } = {}): string {
    const now = Math.floor(this.deps.clock.nowMs() / 1000);
    return signCookie(this.deps.credentials.keys.hmacKey(OPERATOR_COOKIE.purpose), {
      v: 1,
      sub: "operator",
      iat: now,
      exp: now + Math.floor((o.ttlMs ?? OPERATOR_COOKIE_TTL_MS) / 1000),
    });
  }

  memberLink(o: { workspaceId: string; lineId: string; jti?: string; ttlMs?: number }): string {
    return signLink(this.deps.credentials.keys.linkPrivateKey, {
      v: 1,
      k: "member",
      ws: o.workspaceId,
      lineId: o.lineId,
      jti: o.jti ?? randomUUID(),
      exp: Math.floor((this.deps.clock.nowMs() + (o.ttlMs ?? LINK_TTL_MS)) / 1000),
    });
  }

  brandLink(o: { workspaceId: string; brand?: string; jti?: string; ttlMs?: number }): string {
    return signLink(this.deps.credentials.keys.linkPrivateKey, {
      v: 1,
      k: "brand",
      ws: o.workspaceId,
      brand: o.brand ?? "lantern-bay",
      jti: o.jti ?? randomUUID(),
      exp: Math.floor((this.deps.clock.nowMs() + (o.ttlMs ?? LINK_TTL_MS)) / 1000),
    });
  }

  bearer(token: string): TestAuth {
    return { authorization: `Bearer ${token}` };
  }

  judge(cookieValue: string): TestAuth {
    return { cookie: `${JUDGE_COOKIE.name}=${cookieValue}` };
  }

  operator(cookieValue: string): TestAuth {
    return { cookie: `${OPERATOR_COOKIE.name}=${cookieValue}` };
  }
}
