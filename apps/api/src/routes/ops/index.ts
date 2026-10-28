// src/routes/ops: owned by the PROOF slice (apps/api/SPLIT.md).
// /ops endpoints (W-OP-01): health, outbox, webhooks, kill switches, limiter, ledger heads, Claude spend,
// latency metrics, and the treasurer's web-key registration (fs-analyn-w1). Read: the operator for everything, a
// judge (or an officer) for their own workspace. Write: the operator only (`/ops/login` is the judge slice's).
//
//   GET  /v1/ops/overview        operator | judge | treasurer | Chair   (workspace-scoped unless operator)
//   GET  /v1/ops/metrics         same readers
//   GET  /v1/ops/keys?ws=        operator: one workspace's officer keys, as the registry trusts them
//   POST /v1/ops/keys            operator: register the treasurer's browser key (proof of possession)
//   POST /v1/ops/keys/revoke     operator: revoke an officer key (on the chain)
import { OfficerKey, Uuid } from "@fairsplit/contracts";
import { z } from "zod";
import { reply } from "../../lib/command.js";
import { defineRouteFolder } from "../../lib/slice.js";
import { opsView } from "../../ops/access.js";
import {
  RegisterKeyRequest,
  RegisterKeyResponse,
  RevokeKeyRequest,
  RevokeKeyResponse,
  registerTreasurerKey,
  revokeKey,
} from "../../ops/keys.js";
import { OpsMetrics, opsMetrics } from "../../ops/metrics.js";
import { OpsOverview, opsOverview } from "../../ops/overview.js";
import { officerRegistry } from "../../proof/keys.js";

const READ_ERRORS = ["UNAUTHENTICATED", "FRAME_TOKEN_EXPIRED", "FORBIDDEN"] as const;

export default defineRouteFolder({
  folder: "ops",
  commands: {},
  routes: (r) => {
    r.route(
      {
        method: "GET",
        path: "/v1/ops/overview",
        auth: "public",
        name: "overview",
        summary: "/ops: rail, kill switches, limiter, outbox, webhooks, SSE, ledger heads, Claude spend",
        description:
          "Plain tables for W-OP-01. The operator (`fs_ops`) sees every workspace; a judge, or the treasurer or Chair, sees their own workspace only. Never a secret, token, raw webhook body or receiver.",
        response: OpsOverview,
        errors: [...READ_ERRORS],
      },
      async (ctx) => opsOverview(ctx.deps, opsView(ctx.credential, ctx.credentialProblem)),
    );

    r.route(
      {
        method: "GET",
        path: "/v1/ops/metrics",
        auth: "public",
        name: "metrics",
        summary: "/ops: webhook latency p50/p95 and the counts behind the quotas",
        response: OpsMetrics,
        errors: [...READ_ERRORS],
      },
      async (ctx) => opsMetrics(ctx.deps.db, opsView(ctx.credential, ctx.credentialProblem), ctx.now()),
    );

    r.route(
      {
        method: "GET",
        path: "/v1/ops/keys",
        auth: "operator",
        name: "keys",
        summary: "One workspace's officer keys, as the approval checks and Proof plate 5 trust them",
        request: z.strictObject({ ws: Uuid }),
        response: z.strictObject({ officers: z.array(OfficerKey) }),
      },
      async (ctx) => ({ officers: await officerRegistry(ctx.deps.db, ctx.input.ws.toLowerCase()) }),
    );

    r.route(
      {
        method: "POST",
        path: "/v1/ops/keys",
        auth: "operator",
        name: "registerKey",
        summary: "Register the treasurer's browser key (fs-{persona}-w{n}) with proof of possession",
        description:
          'The treasurer\'s browser makes a non-extractable WebCrypto Ed25519 key and signs JCS{purpose: "fairsplit.key.register", v: 1, workspaceId, keyId, publicKeyHex, approverId, at} with it; the operator submits it. Writes `device_keys` and a `key.registered` ledger entry in one transaction. Repeating the same registration changes nothing (200); a key ID reused for another key is refused.',
        request: RegisterKeyRequest,
        response: RegisterKeyResponse,
        success: [201, 200],
        errors: ["SIGNATURE_INVALID", "INVALID_TRANSITION"],
      },
      async (ctx) => {
        const out = await registerTreasurerKey(ctx.deps.db, ctx.input, ctx.now());
        return reply(out.registered ? 201 : 200, out);
      },
    );

    r.route(
      {
        method: "POST",
        path: "/v1/ops/keys/revoke",
        auth: "operator",
        name: "revokeKey",
        summary: "Revoke an officer key (recorded on the chain; the reason only as a salted commitment)",
        request: RevokeKeyRequest,
        response: RevokeKeyResponse,
      },
      async (ctx) => revokeKey(ctx.deps.db, ctx.deps.credentials.keys, ctx.input, ctx.now()),
    );
  },
});
