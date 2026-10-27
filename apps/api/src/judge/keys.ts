// Demo signing keys (S3.8 "Judge sessions create session-only fs-{persona}-w{n} keys, labelled 'Demo key'";
// plan C-13). The Chair's and the treasurer's stage frames each make a WebCrypto Ed25519 key in the judge's
// browser and register its public half here, proving possession by signing the registration itself. The
// key is a `web_demo` row of `device_keys` (approvals verify against that registry, never a bundled key)
// and a `key.registered` ledger entry before it ever signs, so Proof plate 5 finds it and reads "Sample".
// Only in judge workspaces: a real officer key is registered from /ops (or the app), never here.
import { DeviceKeyId, Ed25519PublicKeyHex } from "@fairsplit/contracts";
import { appendLedger, isUniqueViolation, schema, withWorkspaceTx } from "@fairsplit/db";
import { ed25519Verify, jcs } from "@fairsplit/domain";
import { and, eq, like } from "drizzle-orm";
import { z } from "zod";
import { type ActingCredential, scopeOf } from "../credentials/verify/index.js";
import type { AppDeps } from "../lib/context.js";
import { problem } from "../lib/problem.js";
import { isJudgeWorkspace } from "./quota.js";

/** Who signs a pay run: the treasurer always, the Chair above the card's thresholds (R5). */
export const SIGNING_ROLES = ["treasurer", "board"] as const;

export const DemoKeyRequest = z.strictObject({
  publicKeyHex: Ed25519PublicKeyHex,
  /** Ed25519 signature (hex) over the JCS of `demoKeyStatement(...)`: proof the browser holds the key. */
  signatureHex: z.string().regex(/^[0-9a-f]{128}$/),
});
export type DemoKeyRequest = z.infer<typeof DemoKeyRequest>;

export const DemoKeyResponse = z.strictObject({
  keyId: DeviceKeyId,
  approverId: z.string(),
  kind: z.literal("web_demo"),
  label: z.string(),
  publicKeyHex: Ed25519PublicKeyHex,
});

/** What the frame signs to register its key (also exported for the console and the app). */
export function demoKeyStatement(o: { workspaceId: string; approverId: string; publicKeyHex: string }) {
  return {
    v: 1,
    purpose: "fs.register-demo-key",
    ws: o.workspaceId,
    approverId: o.approverId,
    publicKeyHex: o.publicKeyHex,
  };
}

export async function registerDemoKey(
  deps: AppDeps,
  cred: ActingCredential,
  input: DemoKeyRequest,
): Promise<z.infer<typeof DemoKeyResponse>> {
  if (cred.kind === "judge_session" || !(SIGNING_ROLES as readonly string[]).includes(cred.role)) {
    throw problem.forbidden("Only the treasurer's and the Chair's frames hold signing keys.");
  }
  if (!/^[a-z]+$/.test(cred.persona)) throw problem.forbidden("This persona cannot hold a signing key.");
  if (!(await isJudgeWorkspace(deps.db, cred.workspaceId))) {
    throw problem.forbidden("Demo keys exist only in Judge Mode.");
  }
  const approverId = `${cred.role}:${cred.persona}`;
  const statement = jcs(
    demoKeyStatement({ workspaceId: cred.workspaceId, approverId, publicKeyHex: input.publicKeyHex }),
  );
  if (!ed25519Verify(input.publicKeyHex, statement, input.signatureHex)) {
    throw problem.validation("The registration is not signed by this key.", [
      {
        path: "body.signatureHex",
        message: "does not verify against publicKeyHex",
        code: "invalid_signature",
      },
    ]);
  }
  const scope = scopeOf(cred);
  if (!scope) throw problem.forbidden();
  const prefix = `fs-${cred.persona}-w`;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const keyId = await withWorkspaceTx(deps.db, scope, async (tx) => {
        const dk = schema.deviceKeys;
        const taken = await tx
          .select({ keyId: dk.keyId, publicKey: dk.publicKey })
          .from(dk)
          .where(and(eq(dk.workspaceId, cred.workspaceId), like(dk.keyId, `${prefix}%`)));
        const raw = Buffer.from(input.publicKeyHex, "hex").toString("base64url");
        const same = taken.find((t) => t.publicKey === raw);
        if (same) return same.keyId; // the same key registered twice: idempotent
        const n = 1 + taken.reduce((max, t) => Math.max(max, Number(t.keyId.slice(prefix.length)) || 0), 0);
        const id = `${prefix}${n}`;
        await tx.insert(dk).values({
          workspaceId: cred.workspaceId,
          keyId: id,
          persona: cred.persona,
          publicKey: raw,
          kind: "web_demo",
          platform: "web",
        });
        await appendLedger(tx, scope, {
          kind: "key.registered",
          payload: { keyId: id, persona: approverId, kind: "web_demo", publicKeyHex: input.publicKeyHex },
          at: deps.clock.now(),
        });
        return id;
      });
      return {
        keyId,
        approverId,
        kind: "web_demo",
        label: "Demo key (this browser only)",
        publicKeyHex: input.publicKeyHex,
      };
    } catch (err) {
      if (!isUniqueViolation(err) || attempt === 2) throw err;
    }
  }
  throw problem.internal("The key could not be registered.");
}
