// The officer key registry (I6): who may sign for which role, read server-side from `device_keys` joined with
// the officers' memberships. Never a key from the request or from a bundle; seeded keys (`fs-{persona}-s{n}`)
// are never written to `device_keys` and are refused by `expectedSigner` anyway.
//
// `device_keys.persona` holds the officer's persona ("analyn") or a full approver id ("treasurer:analyn");
// `public_key` is the raw 32-byte Ed25519 key as base64url (or hex). The approver id an officer signs as is
// `{role}:{persona}` ("treasurer:analyn", "board:ernesto"); the board's member who co-signs is the Chair.
import type { ApprovalRole, OfficerKey } from "@fairsplit/contracts";
import { type DbOrTx, schema, type WorkspaceScope } from "@fairsplit/db";
import { and, eq } from "drizzle-orm";

export function publicKeyHexOf(stored: string): string | null {
  const s = stored.trim();
  if (/^[0-9a-f]{64}$/i.test(s)) return s.toLowerCase();
  try {
    const bytes = Buffer.from(s, "base64url");
    return bytes.length === 32 ? bytes.toString("hex") : null;
  } catch {
    return null;
  }
}

export function approvalRoleOfApprover(approverId: string): ApprovalRole | null {
  if (approverId.startsWith("treasurer:")) return "treasurer";
  if (approverId.startsWith("board:")) return "chair";
  return null;
}

export async function officerRegistry(db: DbOrTx, scope: WorkspaceScope): Promise<OfficerKey[]> {
  const keys = await db
    .select()
    .from(schema.deviceKeys)
    .where(eq(schema.deviceKeys.workspaceId, scope.workspaceId));
  const memberships = await db
    .select({ persona: schema.memberships.persona, role: schema.memberships.role })
    .from(schema.memberships)
    .where(eq(schema.memberships.workspaceId, scope.workspaceId));
  const out: OfficerKey[] = [];
  for (const k of keys) {
    const publicKeyHex = publicKeyHexOf(k.publicKey);
    if (!publicKeyHex) continue;
    let approverId = k.persona;
    if (!approverId.includes(":")) {
      const m = memberships.find(
        (x) => x.persona === k.persona && (x.role === "treasurer" || x.role === "board"),
      );
      if (!m) continue;
      approverId = `${m.role}:${k.persona}`;
    }
    const role = approvalRoleOfApprover(approverId);
    if (!role) continue;
    out.push({
      keyId: k.keyId,
      approverId,
      role,
      publicKeyHex,
      // The row's own kind (app, web or web_demo; the database holds each to its ID shape). Domain
      // `expectedSigner` refuses a row whose kind does not fit its key ID, so a kind is never guessed here.
      kind: k.kind,
      revokedAt: k.revokedAt ? k.revokedAt.toISOString() : null,
    });
  }
  return out;
}

/** The persona that signs for `role` in this workspace (the judge signs as that officer with a demo key). */
export async function officerFor(
  db: DbOrTx,
  scope: WorkspaceScope,
  role: ApprovalRole,
): Promise<string | null> {
  const want = role === "treasurer" ? "treasurer" : "board";
  const rows = await db
    .select({ persona: schema.memberships.persona })
    .from(schema.memberships)
    .where(and(eq(schema.memberships.workspaceId, scope.workspaceId), eq(schema.memberships.role, want)));
  const personas = rows.map((r) => r.persona).filter((p): p is string => !!p);
  if (personas.length === 0) return role === "treasurer" ? "treasurer:analyn" : "board:ernesto";
  // The Chair among the board: the seeded officer list names her; otherwise the first board persona.
  const preferred = role === "treasurer" ? "analyn" : "ernesto";
  const pick = personas.find((p) => p === preferred || p.endsWith(`:${preferred}`)) ?? personas[0];
  return pick ? (pick.includes(":") ? pick : `${want}:${pick}`) : null;
}
