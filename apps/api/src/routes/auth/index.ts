// src/routes/auth: owned by the JUDGE slice (apps/api/SPLIT.md).
// Credential issuance: single-use pairing (QR 10 min or a 6-digit code), stage frame tokens (2 h, sent over
// IC-12, never in a URL), operator login (scrypt → `fs_ops`), member links `/s/:token` and brand links
// `/b/:token` (Ed25519, 30 days, member links revocable), and "who am I" for any credential. The shell forwards
// `/s/:token` to the app and serves `/b/:token` to the console; both pages read their link's facts from
// `GET /v1/credential` with the link as the bearer (the link exchange). The shared resolver refuses a revoked
// link there and on every other route.
// Wire formats live in src/credentials/verify/codec.ts; issuance helpers in src/credentials/issue.
// IC-01 commands here: createPairing, claimPairing.
//
// Two rules hold for every route here that returns a secret: it refuses an Idempotency-Key (the shell would
// store the secret for replay; `refuseReplayOfSecret`), and the credential it mints never outlives the one
// that asked (a pairing's device token is capped by its issuer's expiry). Outside Judge Mode the treasurer
// pairs only itself, clerks and members; the operator pairs the other officers (`POST /v1/ops/pairing`).
import { CreatePairingResponse } from "@fairsplit/contracts";
import { appendLedger, schema, systemScope, type WorkspaceScope, withWorkspaceTx } from "@fairsplit/db";
import { and, desc, eq } from "drizzle-orm";
import {
  type CreatedPairing,
  canIssue,
  clearOperatorCookie,
  consumePairing,
  createPairingRow,
  findPairing,
  issueBrandLink,
  issueMemberLink,
  linkWasIssued,
  mayPair,
  mintBearerToken,
  type PersonaRef,
  type PersonaResult,
  pairingCap,
  parsePersonaRef,
  recordLinkIssued,
  refuseReplayOfSecret,
  resolvePersona,
  revokeLink,
  sessionOfWorkspace,
  setOperatorCookie,
  verifyOperatorPassword,
} from "../../credentials/issue/index.js";
import {
  actorOf,
  type Credential,
  DEVICE_TOKEN_TTL_MS,
  type JudgeSessionCredential,
} from "../../credentials/verify/index.js";
import { JUDGE_RATE_RULES } from "../../judge/runtime.js";
import {
  BrandLinkRequest,
  CredentialView,
  FrameTokenRequest,
  FrameTokenResponse,
  LinkResponse,
  MemberLinkRequest,
  OkResponse,
  OpsLoginRequest,
  OpsLoginResponse,
  OpsPairingRequest,
  RevokeLinkRequest,
  RevokeLinkResponse,
} from "../../judge/schemas.js";
import { requireOwnSession, type WorkspaceRow, workspaceAlive, workspaceRow } from "../../judge/session.js";
import { clientIpKey } from "../../lib/client-ip.js";
import { reply } from "../../lib/command.js";
import type { AppDeps } from "../../lib/context.js";
import { ApiProblem, problem } from "../../lib/problem.js";
import { RATE_RULES } from "../../lib/rate-limit.js";
import { defineRouteFolder } from "../../lib/slice.js";

/** The brand a brand link names when the operator does not say (the seed's payer). */
const DEFAULT_BRAND = "lantern-bay";

function personaProblem(r: Extract<PersonaResult, { ok: false }>): ApiProblem {
  return r.code === "FORBIDDEN" ? problem.forbidden(r.message) : problem.validation(r.message);
}

function pairingInvalid(message = "This pairing was used or has expired. Make a new one."): ApiProblem {
  return new ApiProblem("PAIRING_TOKEN_INVALID", message);
}

function credentialKey(cred: Credential): string {
  switch (cred.kind) {
    case "frame":
    case "device":
      return `tok:${cred.tokenId}`;
    case "judge_session":
      return `judge:${cred.sessionId}`;
    case "member_link":
    case "brand_link":
      return `link:${cred.jti}`;
    case "operator":
      return "operator";
  }
}

/**
 * Writes a pairing and its `pairing.created` ledger entry in one transaction. `capAt` is the issuing
 * credential's own expiry (null for the operator): the pairing, and the device token claimed from it,
 * never outlive it.
 */
async function makePairing(
  deps: AppDeps,
  o: { scope: WorkspaceScope; ws: WorkspaceRow; ref: PersonaRef; now: Date; capAt: Date | null },
): Promise<CreatedPairing> {
  return withWorkspaceTx(deps.db, o.scope, async (tx) => {
    const p = await createPairingRow(tx, {
      keys: deps.credentials.keys,
      publicOrigin: deps.env.publicOrigin,
      workspaceId: o.ws.id,
      ref: o.ref,
      now: o.now,
      workspaceExpiresAt: o.ws.expiresAt,
      capAt: o.capAt,
    });
    await appendLedger(tx, o.scope, {
      kind: "pairing.created",
      payload: {
        pairingId: p.id,
        role: o.ref.role,
        persona: o.ref.persona,
        exp: p.expiresAt.toISOString(),
        capAt: o.capAt?.toISOString() ?? null,
      },
      at: o.now,
    });
    return p;
  });
}

async function newestRunSlug(deps: AppDeps, workspaceId: string): Promise<string | null> {
  const [row] = await deps.db
    .select({ runSlug: schema.payRuns.runSlug })
    .from(schema.payRuns)
    .where(eq(schema.payRuns.workspaceId, workspaceId))
    .orderBy(desc(schema.payRuns.runSeq))
    .limit(1);
  return row?.runSlug ?? null;
}

export default defineRouteFolder({
  folder: "auth",
  commands: {
    createPairing: async (ctx) => {
      refuseReplayOfSecret(ctx.header);
      const { deps, credential: cred, input } = ctx;
      if (!canIssue(cred.role)) {
        throw problem.forbidden("Pairing a phone needs the treasurer's console or the judge stage.");
      }
      const limit = deps.rateLimits.take(JUDGE_RATE_RULES.pairingCreate, credentialKey(cred));
      if (!limit.ok) throw problem.rateLimited(limit.retryAfterMs);
      const resolved = await resolvePersona(deps.db, cred.workspaceId, input);
      if (!resolved.ok) throw personaProblem(resolved);
      const now = ctx.now();
      const ws = await workspaceRow(deps.db, cred.workspaceId);
      if (!workspaceAlive(ws, now)) throw problem.expired("This workspace has ended.");
      const may = mayPair({ role: cred.role, persona: cred.persona }, resolved.ref, ws.kind);
      if (!may.ok) throw problem.forbidden(may.message);
      const created = await makePairing(deps, {
        scope: ctx.scope,
        ws,
        ref: resolved.ref,
        now,
        capAt: cred.expiresAt,
      });
      return reply(201, {
        url: created.url,
        code6: created.code6,
        expiresAt: created.expiresAt.toISOString(),
      });
    },

    claimPairing: async (ctx) => {
      refuseReplayOfSecret(ctx.header);
      const { deps, input } = ctx;
      const now = ctx.now();
      const perIp = deps.rateLimits.take(RATE_RULES.pairingClaim, clientIpKey(ctx.c));
      if (!perIp.ok)
        throw problem.rateLimited(perIp.retryAfterMs, "Too many pairing attempts. Wait a minute.");
      if ("code6" in input) {
        const global = deps.rateLimits.take(JUDGE_RATE_RULES.pairingCode6Global, "all");
        if (!global.ok) {
          throw problem.rateLimited(
            global.retryAfterMs,
            "Six-digit pairing is busy. Scan the QR code instead.",
          );
        }
      }
      const found = await findPairing(deps.db, deps.credentials.keys, input, now);
      if (!found.ok) throw pairingInvalid();
      const row = found.row;
      const ws = await workspaceRow(deps.db, row.workspaceId);
      if (!workspaceAlive(ws, now)) throw pairingInvalid("This session has ended. Make a new pairing.");
      const minted = await withWorkspaceTx(deps.db, row.workspaceId, async (tx) => {
        if (!(await consumePairing(tx, row.id, now))) throw pairingInvalid();
        // never past the credential that made the pairing (S3.8: a 2 h console token never becomes 30 days)
        const cap = await pairingCap(tx, row.workspaceId, row.id);
        if (cap && cap.getTime() <= now.getTime()) {
          throw pairingInvalid("The credential that made this pairing has ended. Make a new one.");
        }
        const sessionId = await sessionOfWorkspace(tx, row.workspaceId);
        const token = await mintBearerToken(tx, {
          workspaceId: row.workspaceId,
          kind: "device",
          role: row.role,
          persona: row.persona,
          memberId: row.memberId,
          sessionId,
          now,
          workspaceExpiresAt: ws.expiresAt,
          ...(cap ? { ttlMs: Math.min(DEVICE_TOKEN_TTL_MS, cap.getTime() - now.getTime()) } : {}),
        });
        const actor = {
          kind: "human" as const,
          id: `${row.role}:${row.persona}`,
          impersonatedBy: sessionId ? `judge_session:${sessionId}` : null,
        };
        await appendLedger(tx, systemScope(row.workspaceId, actor), {
          kind: "credential.paired",
          payload: {
            pairingId: row.id,
            tokenId: token.tokenId,
            role: row.role,
            persona: row.persona,
            via: found.via,
          },
          at: now,
        });
        return token;
      });
      deps.logger.info({ workspaceId: row.workspaceId, role: row.role, via: found.via }, "phone paired");
      return {
        token: minted.token,
        role: row.role,
        persona: row.persona,
        workspaceId: row.workspaceId,
        expiresAt: minted.expiresAt.toISOString(),
      };
    },
  },

  routes: (r) => {
    r.route(
      {
        method: "POST",
        path: "/v1/judge/sessions/:sid/frames",
        auth: "frame_or_session",
        name: "frameToken",
        summary:
          "Mint a stage frame's token for one persona (2 h; sent to the frame over IC-12, never in a URL)",
        request: FrameTokenRequest,
        response: FrameTokenResponse,
        success: [201],
        errors: ["RATE_LIMITED"],
      },
      async (ctx) => {
        refuseReplayOfSecret(ctx.header);
        requireOwnSession(ctx.credential, ctx.params.sid);
        const cred = ctx.credential as JudgeSessionCredential;
        const deps = ctx.deps;
        const ref = parsePersonaRef(ctx.input.persona);
        if (!ref) throw problem.validation("A persona is {role}:{name}, e.g. board:ernesto or member:M-014.");
        const limit = deps.rateLimits.take(JUDGE_RATE_RULES.frames, cred.sessionId);
        if (!limit.ok) throw problem.rateLimited(limit.retryAfterMs);
        const resolved = await resolvePersona(deps.db, cred.workspaceId, ref);
        if (!resolved.ok) throw personaProblem(resolved);
        const now = ctx.now();
        const ws = await workspaceRow(deps.db, cred.workspaceId);
        if (!workspaceAlive(ws, now)) throw problem.expired("This judge session has ended.");
        const minted = await withWorkspaceTx(deps.db, cred.workspaceId, (tx) =>
          mintBearerToken(tx, {
            workspaceId: cred.workspaceId,
            kind: "frame",
            role: resolved.ref.role,
            persona: resolved.ref.persona,
            memberId: resolved.ref.memberId,
            sessionId: cred.sessionId,
            now,
            workspaceExpiresAt: ws.expiresAt,
          }),
        );
        return reply(201, {
          token: minted.token,
          role: resolved.ref.role,
          persona: resolved.ref.persona,
          workspaceId: cred.workspaceId,
          expiresAt: minted.expiresAt.toISOString(),
        });
      },
    );

    r.route(
      {
        method: "POST",
        path: "/v1/ops/login",
        auth: "none",
        name: "opsLogin",
        summary: "Operator sign-in for /ops (scrypt-checked password → HttpOnly `fs_ops` cookie, 8 h)",
        request: OpsLoginRequest,
        response: OpsLoginResponse,
        errors: ["UNAUTHENTICATED", "FORBIDDEN"],
      },
      async (ctx) => {
        const deps = ctx.deps;
        const perIp = deps.rateLimits.take(JUDGE_RATE_RULES.opsLoginPerIp, clientIpKey(ctx.c));
        if (!perIp.ok)
          throw problem.rateLimited(perIp.retryAfterMs, "Too many sign-in attempts. Wait a minute.");
        const global = deps.rateLimits.take(JUDGE_RATE_RULES.opsLoginGlobal, "all");
        if (!global.ok)
          throw problem.rateLimited(global.retryAfterMs, "Too many sign-in attempts. Wait a minute.");
        const stored = deps.env.secrets.operatorPasswordScrypt;
        if (!stored) throw problem.forbidden("Operator sign-in is not configured on this server.");
        if (!(await verifyOperatorPassword(stored, ctx.input.password))) {
          throw problem.unauthenticated("That password is not right.");
        }
        const expiresAt = setOperatorCookie(ctx.c, deps, ctx.now());
        ctx.log.info("operator signed in");
        return { ok: true as const, expiresAt: expiresAt.toISOString() };
      },
    );

    r.route(
      {
        method: "POST",
        path: "/v1/ops/logout",
        auth: "none",
        name: "opsLogout",
        summary: "End the operator session in this browser",
        response: OkResponse,
      },
      (ctx) => {
        clearOperatorCookie(ctx.c, ctx.deps);
        return { ok: true as const };
      },
    );

    r.route(
      {
        method: "POST",
        path: "/v1/ops/pairing",
        auth: "operator",
        name: "opsPairing",
        summary:
          "Pair an officer's phone in a live workspace (operator only; the treasurer pairs only itself, clerks and members)",
        description:
          "Outside Judge Mode the Chair, the brand and any other treasurer are paired by the operator, never by another officer (S3.8 separation of duties). Single use, 10 minutes; the claim is POST /v1/pairing/claim.",
        request: OpsPairingRequest,
        response: CreatePairingResponse,
        success: [201],
        errors: ["RATE_LIMITED"],
      },
      async (ctx) => {
        refuseReplayOfSecret(ctx.header);
        const deps = ctx.deps;
        const limit = deps.rateLimits.take(JUDGE_RATE_RULES.opsPairing, "operator");
        if (!limit.ok) throw problem.rateLimited(limit.retryAfterMs);
        const now = ctx.now();
        const ws = await workspaceRow(deps.db, ctx.input.workspaceId);
        if (!workspaceAlive(ws, now)) throw problem.notFound("No such workspace.");
        const resolved = await resolvePersona(deps.db, ws.id, ctx.input);
        if (!resolved.ok) throw personaProblem(resolved);
        const created = await makePairing(deps, {
          scope: systemScope(ws.id, { kind: "human", id: "operator" }),
          ws,
          ref: resolved.ref,
          now,
          capAt: null,
        });
        ctx.log.info({ workspaceId: ws.id, role: resolved.ref.role }, "operator made a pairing");
        return reply(201, {
          url: created.url,
          code6: created.code6,
          expiresAt: created.expiresAt.toISOString(),
        });
      },
    );

    r.route(
      {
        method: "GET",
        path: "/v1/credential",
        auth: "public",
        name: "whoami",
        summary: "The presented credential: kind, role, persona, workspace, expiry (never the secret)",
        response: CredentialView,
        errors: ["UNAUTHENTICATED", "FRAME_TOKEN_EXPIRED"],
      },
      async (ctx) => {
        if (ctx.credentialProblem) throw ctx.credentialProblem;
        const cred = ctx.credential;
        if (!cred) throw problem.unauthenticated();
        const deps = ctx.deps;
        const actor = actorOf(cred);
        const base = {
          kind: cred.kind,
          role: cred.role,
          persona: "persona" in cred ? cred.persona : cred.kind === "member_link" ? "member" : cred.brand,
          actor: actor.id,
          impersonatedBy: actor.impersonatedBy ?? null,
          workspaceId: cred.kind === "operator" ? null : cred.workspaceId,
          sessionId: cred.kind === "operator" || !("sessionId" in cred) ? null : (cred.sessionId ?? null),
          lineId: null as string | null,
          memberNo: null as string | null,
          brand: null as string | null,
          runSlug: null as string | null,
          expiresAt: cred.expiresAt.toISOString(),
        };
        // a revoked link never gets here: the shared resolver refused it (appCredentialStore)
        if (cred.kind === "member_link") {
          const [line] = await deps.db
            .select({ memberNo: schema.members.memberNo, runSlug: schema.payRuns.runSlug })
            .from(schema.memberLines)
            .innerJoin(schema.members, eq(schema.members.id, schema.memberLines.memberId))
            .innerJoin(schema.payRuns, eq(schema.payRuns.id, schema.memberLines.runId))
            .where(
              and(
                eq(schema.memberLines.workspaceId, cred.workspaceId),
                eq(schema.memberLines.id, cred.lineId),
              ),
            )
            .limit(1);
          if (!line) throw problem.notFound("This statement's line no longer exists.");
          return {
            ...base,
            persona: line.memberNo,
            lineId: cred.lineId,
            memberNo: line.memberNo,
            runSlug: line.runSlug,
          };
        }
        if (cred.kind === "brand_link") {
          return { ...base, brand: cred.brand, runSlug: await newestRunSlug(deps, cred.workspaceId) };
        }
        return base;
      },
    );

    r.route(
      {
        method: "POST",
        path: "/v1/links/member",
        auth: "frame_or_session",
        name: "issueMemberLink",
        summary:
          "A member's statement link for one line (Ed25519, 30 days, revocable; printed on the 80 mm slip)",
        request: MemberLinkRequest,
        response: LinkResponse,
        success: [201],
        errors: ["RATE_LIMITED"],
      },
      async (ctx) => {
        refuseReplayOfSecret(ctx.header);
        const { deps, credential: cred } = ctx;
        if (!canIssue(cred.role)) throw problem.forbidden("Statement links come from the treasurer.");
        const limit = deps.rateLimits.take(JUDGE_RATE_RULES.links, credentialKey(cred));
        if (!limit.ok) throw problem.rateLimited(limit.retryAfterMs);
        const now = ctx.now();
        const [line] = await deps.db
          .select({ id: schema.memberLines.id })
          .from(schema.memberLines)
          .where(
            and(
              eq(schema.memberLines.workspaceId, cred.workspaceId),
              eq(schema.memberLines.id, ctx.input.lineId),
            ),
          )
          .limit(1);
        if (!line) throw problem.notFound("No such line in this workspace.");
        const ws = await workspaceRow(deps.db, cred.workspaceId);
        if (!workspaceAlive(ws, now)) throw problem.expired("This workspace has ended.");
        const link = issueMemberLink(deps, {
          workspaceId: cred.workspaceId,
          lineId: line.id,
          now,
          workspaceExpiresAt: ws.expiresAt,
        });
        await withWorkspaceTx(deps.db, ctx.scope, (tx) =>
          recordLinkIssued(tx, ctx.scope, link, { lineId: line.id }, now),
        );
        return reply(201, {
          kind: link.kind,
          url: link.url,
          jti: link.jti,
          expiresAt: link.expiresAt.toISOString(),
        });
      },
    );

    r.route(
      {
        method: "POST",
        path: "/v1/links/member/revoke",
        auth: "frame_or_session",
        name: "revokeMemberLink",
        summary: "Revoke a statement link (a reprint rotates it): it stops opening anywhere",
        request: RevokeLinkRequest,
        response: RevokeLinkResponse,
      },
      async (ctx) => {
        const { deps, credential: cred } = ctx;
        if (!canIssue(cred.role)) throw problem.forbidden("Statement links are revoked by the treasurer.");
        if (!(await linkWasIssued(deps.db, cred.workspaceId, ctx.input.jti, "member"))) {
          throw problem.notFound("No statement link with that id was issued in this workspace.");
        }
        const revoked = await withWorkspaceTx(deps.db, ctx.scope, (tx) =>
          revokeLink(tx, ctx.scope, { jti: ctx.input.jti, at: ctx.now() }),
        );
        return { revoked, jti: ctx.input.jti };
      },
    );

    r.route(
      {
        method: "POST",
        path: "/v1/links/brand",
        auth: "operator",
        name: "issueBrandLink",
        summary: "A brand link to one workspace's Proof brand tier (operator only; 30 days)",
        request: BrandLinkRequest,
        response: LinkResponse,
        success: [201],
        errors: ["RATE_LIMITED"],
      },
      async (ctx) => {
        refuseReplayOfSecret(ctx.header);
        const deps = ctx.deps;
        const limit = deps.rateLimits.take(JUDGE_RATE_RULES.brandLinks, "operator");
        if (!limit.ok) throw problem.rateLimited(limit.retryAfterMs);
        const now = ctx.now();
        // The operator has no workspace of its own: it names one, and only an existing, live one.
        const ws = await workspaceRow(deps.db, ctx.input.workspaceId);
        if (!workspaceAlive(ws, now)) throw problem.notFound("No such workspace.");
        const brand = ctx.input.brand ?? DEFAULT_BRAND;
        const link = issueBrandLink(deps, {
          workspaceId: ws.id,
          brand,
          now,
          workspaceExpiresAt: ws.expiresAt,
        });
        const scope = systemScope(ws.id, { kind: "human", id: "operator" });
        await withWorkspaceTx(deps.db, scope, (tx) => recordLinkIssued(tx, scope, link, { brand }, now));
        return reply(201, {
          kind: link.kind,
          url: link.url,
          jti: link.jti,
          expiresAt: link.expiresAt.toISOString(),
        });
      },
    );
  },
});
