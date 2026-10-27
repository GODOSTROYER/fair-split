// Treasurer web-key registration from /ops (S3.8: "The showcase treasurer's real key is `fs-analyn-w1`, a
// non-extractable WebCrypto key registered once from /ops"). The operator registers it, the treasurer's browser
// proves it holds the private half by signing a registration statement, and the key enters the officer registry
// (`device_keys`) and the ledger (`key.registered`) in one transaction, so Proof plate 5 can show it was
// registered before it signed (I6). Revocation is the same act in reverse, also on the chain.
//
// Never a seeded key (`-s{n}`), never a judge workspace (its keys are labelled browser demo keys), never a key
// ID reused for another public key: a key ID is immutable once registered; register the next number instead.
import { DeviceKeyId, Ed25519PublicKeyHex, IsoDateTime, OfficerKey, Uuid } from "@fairsplit/contracts";
import { appendLedger, type Db, schema, systemScope, withWorkspaceTx } from "@fairsplit/db";
import { ed25519Verify, jcsBytes, sha256Hex } from "@fairsplit/domain";
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { ApiProblem, problem } from "../lib/problem.js";
import { approverIdOf, publicKeyHexOf, storedPublicKeyOf } from "../proof/keys.js";

export const KEY_REGISTRATION_PURPOSE = "fairsplit.key.register";
/** How far a registration statement's `at` may be from the server's clock. */
export const REGISTRATION_SKEW_MS = 5 * 60_000;

export const RegisterKeyRequest = z.strictObject({
  workspaceId: Uuid,
  /** `fs-{persona}-w{n}`: a browser (WebCrypto) key. */
  keyId: DeviceKeyId.refine((id) => /-w\d+$/.test(id), "a browser key ID ends in -w{n}"),
  publicKeyHex: Ed25519PublicKeyHex,
  /** The approver the key signs as: `treasurer:{persona}`. */
  approverId: z.string().regex(/^treasurer:[a-z]+$/),
  /** Proof of possession: Ed25519 over JCS{purpose, v, workspaceId, keyId, publicKeyHex, approverId, at}. */
  proof: z.strictObject({ at: IsoDateTime, signatureHex: z.string().regex(/^[0-9a-f]{128}$/) }),
});
export type RegisterKeyRequest = z.infer<typeof RegisterKeyRequest>;

export const RegisterKeyResponse = z.strictObject({
  key: OfficerKey,
  /** False when this exact key was already registered (nothing was written). */
  registered: z.boolean(),
  ledgerSeq: z.int().positive(),
});

export const RevokeKeyRequest = z.strictObject({
  workspaceId: Uuid,
  keyId: DeviceKeyId,
  reason: z.string().min(3).max(500),
});
export const RevokeKeyResponse = z.strictObject({ key: OfficerKey, revoked: z.boolean() });

/** The bytes the new key signs to prove possession. */
export function registrationBytes(r: Omit<RegisterKeyRequest, "proof"> & { at: string }): Uint8Array {
  return jcsBytes({
    purpose: KEY_REGISTRATION_PURPOSE,
    v: 1,
    workspaceId: r.workspaceId.toLowerCase(),
    keyId: r.keyId,
    publicKeyHex: r.publicKeyHex,
    approverId: r.approverId,
    at: r.at,
  });
}

const OPERATOR_ACTOR = { kind: "human" as const, id: "operator" };

async function officerWorkspace(db: Db, workspaceId: string): Promise<void> {
  const [w] = await db
    .select({ kind: schema.workspaces.kind })
    .from(schema.workspaces)
    .where(eq(schema.workspaces.id, workspaceId))
    .limit(1);
  if (!w) throw problem.notFound("No such workspace.");
  if (w.kind === "judge") {
    throw problem.forbidden(
      "A judge session makes its own labelled browser demo keys; nothing is registered here.",
    );
  }
}

function personaOf(keyId: string): string {
  return keyId.split("-")[1] ?? "";
}

export async function registerTreasurerKey(
  db: Db,
  req: RegisterKeyRequest,
  now: Date,
): Promise<z.infer<typeof RegisterKeyResponse>> {
  const workspaceId = req.workspaceId.toLowerCase();
  await officerWorkspace(db, workspaceId);
  const persona = personaOf(req.keyId);
  const [treasurer] = await db
    .select({ persona: schema.memberships.persona })
    .from(schema.memberships)
    .where(
      and(
        eq(schema.memberships.workspaceId, workspaceId),
        eq(schema.memberships.role, "treasurer"),
        eq(schema.memberships.persona, persona),
      ),
    )
    .limit(1);
  if (!treasurer) throw problem.forbidden(`${req.keyId} does not name this co-op's treasurer.`);
  const approverId = approverIdOf("treasurer", persona);
  if (req.approverId !== approverId) {
    throw problem.validation("The approver does not match the key's persona.", [
      { path: "body.approverId", message: `expected ${approverId}`, code: "approver_mismatch" },
    ]);
  }
  const at = Date.parse(req.proof.at);
  if (Math.abs(at - now.getTime()) > REGISTRATION_SKEW_MS) {
    throw problem.validation("The registration proof is stale; sign a fresh one.", [
      { path: "body.proof.at", message: "more than 5 minutes from the server's clock", code: "stale" },
    ]);
  }
  if (
    !ed25519Verify(
      req.publicKeyHex,
      registrationBytes({ ...req, workspaceId, at: req.proof.at }),
      req.proof.signatureHex,
    )
  ) {
    throw new ApiProblem("SIGNATURE_INVALID", "The browser did not prove it holds this key.");
  }

  const scope = systemScope(workspaceId, OPERATOR_ACTOR);
  return withWorkspaceTx(db, scope, async (tx) => {
    const existing = await tx
      .select()
      .from(schema.deviceKeys)
      .where(eq(schema.deviceKeys.workspaceId, workspaceId));
    const same = existing.find((k) => k.keyId === req.keyId);
    const key = {
      keyId: req.keyId,
      approverId,
      role: "treasurer" as const,
      publicKeyHex: req.publicKeyHex,
      kind: "app" as const,
      revokedAt: null,
    };
    if (same) {
      if (publicKeyHexOf(same.publicKey) !== req.publicKeyHex) {
        throw new ApiProblem(
          "INVALID_TRANSITION",
          `${req.keyId} is registered to another key; register the next number.`,
          {
            details: { reason: "KEY_ID_TAKEN" },
          },
        );
      }
      const head = await tx
        .select({ seq: schema.ledgerHeads.seq })
        .from(schema.ledgerHeads)
        .where(eq(schema.ledgerHeads.workspaceId, workspaceId));
      return {
        key: { ...key, revokedAt: same.revokedAt ? same.revokedAt.toISOString() : null },
        registered: false,
        ledgerSeq: Number(head[0]?.seq ?? 1),
      };
    }
    if (existing.some((k) => publicKeyHexOf(k.publicKey) === req.publicKeyHex)) {
      throw new ApiProblem(
        "INVALID_TRANSITION",
        "This public key is already registered under another key ID.",
        {
          details: { reason: "KEY_REUSED" },
        },
      );
    }
    await tx.insert(schema.deviceKeys).values({
      workspaceId,
      keyId: req.keyId,
      persona: approverId,
      publicKey: storedPublicKeyOf(req.publicKeyHex),
      kind: "app",
      platform: "web",
    });
    const entry = await appendLedger(tx, scope, {
      kind: "key.registered",
      payload: { keyId: req.keyId, persona: approverId, kind: "app", publicKeyHex: req.publicKeyHex },
      at: now,
    });
    return { key, registered: true, ledgerSeq: entry.seq };
  });
}

export async function revokeKey(
  db: Db,
  req: z.infer<typeof RevokeKeyRequest>,
  now: Date,
): Promise<z.infer<typeof RevokeKeyResponse>> {
  const workspaceId = req.workspaceId.toLowerCase();
  await officerWorkspace(db, workspaceId);
  const scope = systemScope(workspaceId, OPERATOR_ACTOR);
  return withWorkspaceTx(db, scope, async (tx) => {
    const [row] = await tx
      .select()
      .from(schema.deviceKeys)
      .where(and(eq(schema.deviceKeys.workspaceId, workspaceId), eq(schema.deviceKeys.keyId, req.keyId)))
      .limit(1);
    if (!row) throw problem.notFound(`${req.keyId} is not registered in this workspace.`);
    const publicKeyHex = publicKeyHexOf(row.publicKey) ?? "0".repeat(64);
    const approverId = row.persona.includes(":") ? row.persona : approverIdOf("treasurer", row.persona);
    const role = approverId.startsWith("board:") ? ("chair" as const) : ("treasurer" as const);
    if (row.revokedAt) {
      return {
        key: {
          keyId: row.keyId,
          approverId,
          role,
          publicKeyHex,
          kind: row.kind as "app" | "web_demo",
          revokedAt: row.revokedAt.toISOString(),
        },
        revoked: false,
      };
    }
    await tx
      .update(schema.deviceKeys)
      .set({ revokedAt: now })
      // compare-and-set: only a key that is still live is revoked (the workspace lock serialises callers)
      .where(
        and(
          eq(schema.deviceKeys.workspaceId, workspaceId),
          eq(schema.deviceKeys.id, row.id),
          isNull(schema.deviceKeys.revokedAt),
        ),
      );
    await appendLedger(tx, scope, {
      kind: "key.revoked",
      payload: { keyId: row.keyId, revokedAt: now.toISOString(), reasonSha256: sha256Hex(req.reason) },
      at: now,
    });
    return {
      key: {
        keyId: row.keyId,
        approverId,
        role,
        publicKeyHex,
        kind: row.kind as "app" | "web_demo",
        revokedAt: now.toISOString(),
      },
      revoked: true,
    };
  });
}
