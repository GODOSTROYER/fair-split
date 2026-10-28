// Demo signing keys (S3.8 "Judge sessions create session-only … keys, labelled 'Demo key'"; plan C-13).
// The Chair's and the treasurer's stage frames each make a WebCrypto Ed25519 key in the judge's browser and
// register its public half here, proving possession by signing the registration itself. The key is a
// `web_demo` row of `device_keys` (approvals verify against that registry, never a bundled key) and a
// `key.registered` ledger entry before it ever signs, so Proof plate 5 finds it and reads "Sample".
// Only in judge workspaces: a real officer key is registered from /ops (or the app), never here.
//
// Two rules keep "two people, two keys" true:
//   - one key, one signer: a public key already registered in this workspace (for any persona), or as a
//     real officer key in any workspace, is refused. PayoutsService compares key ids, so one browser key
//     registered as both the treasurer and the Chair would otherwise sign both approvals;
//   - a demo key's id is C-13's `fs-{persona}-demo-{6 of [a-z0-9]}`, the one shape contracts `DeviceKey` (and
//     the database's per-kind CHECK) allow for `web_demo`, so a demo key can never share an id with a real one
//     (`fs-ernesto-a1`, `fs-analyn-w1`), in keys.json or on Proof.
import { randomInt } from "node:crypto";
import { DeviceKeyId, Ed25519PublicKeyHex } from "@fairsplit/contracts";
import { appendLedger, isUniqueViolation, schema, withWorkspaceTx } from "@fairsplit/db";
import { ed25519Verify, jcs } from "@fairsplit/domain";
import { and, eq, ne, or } from "drizzle-orm";
import { z } from "zod";
import { type ActingCredential, scopeOf } from "../credentials/verify/index.js";
import type { AppDeps } from "../lib/context.js";
import { deviceKeyRow, storedPublicKey } from "../lib/device-keys.js";
import { problem } from "../lib/problem.js";
import { isJudgeWorkspace } from "./quota.js";

/** Who signs a pay run: the treasurer always, the Chair above the card's thresholds (R5). */
export const SIGNING_ROLES = ["treasurer", "board"] as const;

/** The six characters a demo key's id ends in (C-13). */
const DEMO_SUFFIX_ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";
const DEMO_SUFFIX_LENGTH = 6;

/** `fs-{persona}-demo-{6 of [a-z0-9]}` (see the header), drawn with the CSPRNG. */
export function demoKeyId(persona: string): string {
  let suffix = "";
  for (let i = 0; i < DEMO_SUFFIX_LENGTH; i++) {
    suffix += DEMO_SUFFIX_ALPHABET[randomInt(DEMO_SUFFIX_ALPHABET.length)];
  }
  return `fs-${persona}-demo-${suffix}`;
}

const DEMO_KEY_LABEL = "Demo key (this browser only)";

/** A demo key of this persona (its own kind's shape). */
const isDemoKeyOf = (persona: string, keyId: string) =>
  new RegExp(`^fs-${persona}-demo-[a-z0-9]{${DEMO_SUFFIX_LENGTH}}$`).test(keyId);

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
  const raw = storedPublicKey(input.publicKeyHex);
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      // the workspace lock serialises every registration of this workspace, so the check below holds
      const keyId = await withWorkspaceTx(deps.db, scope, async (tx) => {
        const dk = schema.deviceKeys;
        const holders = await tx
          .select({
            keyId: dk.keyId,
            workspaceId: dk.workspaceId,
            persona: dk.persona,
            kind: dk.kind,
            revokedAt: dk.revokedAt,
          })
          .from(dk)
          .where(
            and(eq(dk.publicKey, raw), or(eq(dk.workspaceId, cred.workspaceId), ne(dk.kind, "web_demo"))),
          );
        const own = holders.find(
          (h) =>
            h.workspaceId === cred.workspaceId &&
            h.kind === "web_demo" &&
            h.persona === cred.persona &&
            isDemoKeyOf(cred.persona, h.keyId) &&
            h.revokedAt === null,
        );
        if (own && holders.length === 1) return own.keyId; // the same key registered twice: idempotent
        if (holders.length > 0) {
          throw problem.forbidden("This browser key already signs for someone else: one key, one signer.");
        }
        const id = demoKeyId(cred.persona);
        // Through contracts DeviceKey: a web_demo key with its own kind's ID shape, or nothing is written.
        const built = deviceKeyRow({
          workspaceId: cred.workspaceId,
          keyId: id,
          persona: cred.persona,
          publicKeyHex: input.publicKeyHex,
          kind: "web_demo",
          label: DEMO_KEY_LABEL,
          platform: "web",
        });
        if (!built.ok) throw problem.internal(`A demo key id did not fit its kind: ${built.reason}`);
        await tx.insert(dk).values(built.row);
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
        label: DEMO_KEY_LABEL,
        publicKeyHex: input.publicKeyHex,
      };
    } catch (err) {
      // two registrations drew the same six characters (one in 36^6): draw again
      if (!isUniqueViolation(err) || attempt === 2) throw err;
    }
  }
  throw problem.internal("The key could not be registered.");
}
