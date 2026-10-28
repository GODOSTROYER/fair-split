// The officer key registry and the published trust anchors (S3.8 keys, S3.12 plate 5, contracts `OfficerKey`,
// `PublishedKeys`).
//
// The registry is `device_keys` joined with the officer's role. A row's approver is read, in order, from its
// `persona` when that already is an approver id (`treasurer:analyn`, `board:ernesto`), from the workspace's
// officer `memberships`, or from the `key.registered` ledger entry for that key (whose `persona` is the approver
// id by contract). A row that names no officer is not an officer key. Seeded sample keys never live in
// `device_keys`; they come from the seed snapshot and are always published as kind "seeded" (Proof: "Sample").
import {
  type ApprovalRole,
  DeviceKeyId,
  type DeviceKeyKind,
  deviceKeyIdFitsKind,
  Ed25519PublicKeyHex,
  LedgerPayloads,
  type OfficerKey,
  type PublishedKeys,
} from "@fairsplit/contracts";
import { type DbOrTx, schema } from "@fairsplit/db";
import { getPublishedKeys } from "@fairsplit/seed";
import { and, eq, inArray } from "drizzle-orm";
import type { Logger } from "pino";
import { type LedgerSigningKey, publishedLedgerKeys } from "../ledger/keys.js";

/** `treasurer:analyn` → treasurer; `board:ernesto` (or `chair:…`) → chair; anything else → null. */
export function approvalRoleOf(approverId: string): ApprovalRole | null {
  const role = approverId.split(":", 1)[0];
  if (role === "treasurer") return "treasurer";
  if (role === "board" || role === "chair") return "chair";
  return null;
}

/** The approver id a credential role and persona sign as (the actor id format, `{role}:{persona}`). */
export function approverIdOf(role: "treasurer" | "board", persona: string): string {
  return `${role}:${persona}`;
}

/** `device_keys.public_key` is base64url of the raw 32 bytes; a 64-hex value is accepted as is. */
export function publicKeyHexOf(stored: string): string | null {
  if (Ed25519PublicKeyHex.safeParse(stored).success) return stored;
  if (!/^[A-Za-z0-9_-]{43}=?$/.test(stored)) return null;
  const bytes = Buffer.from(stored.replace(/=$/, ""), "base64url");
  return bytes.length === 32 ? bytes.toString("hex") : null;
}

/** The base64url form `device_keys.public_key` stores. */
export function storedPublicKeyOf(publicKeyHex: string): string {
  return Buffer.from(publicKeyHex, "hex").toString("base64url");
}

interface DeviceKeyRow {
  keyId: string;
  persona: string;
  publicKey: string;
  kind: string;
  revokedAt: Date | null;
}

/** Officer keys of one workspace, as the server trusts them (plate 5 and approval checks). */
export async function officerRegistry(db: DbOrTx, workspaceId: string): Promise<OfficerKey[]> {
  const dk = schema.deviceKeys;
  const rows: DeviceKeyRow[] = await db
    .select({
      keyId: dk.keyId,
      persona: dk.persona,
      publicKey: dk.publicKey,
      kind: dk.kind,
      revokedAt: dk.revokedAt,
    })
    .from(dk)
    .where(eq(dk.workspaceId, workspaceId));
  if (rows.length === 0) return [];
  const officers = await db
    .select({ persona: schema.memberships.persona, role: schema.memberships.role })
    .from(schema.memberships)
    .where(
      and(
        eq(schema.memberships.workspaceId, workspaceId),
        inArray(schema.memberships.role, ["treasurer", "board"]),
      ),
    );
  const registered = await db
    .select({ payload: schema.ledgerEntries.payload })
    .from(schema.ledgerEntries)
    .where(
      and(eq(schema.ledgerEntries.workspaceId, workspaceId), eq(schema.ledgerEntries.kind, "key.registered")),
    );
  const ledgerPersona = new Map<string, string>();
  for (const r of registered) {
    const p = LedgerPayloads["key.registered"].safeParse(r.payload);
    if (p.success && !ledgerPersona.has(p.data.keyId)) ledgerPersona.set(p.data.keyId, p.data.persona);
  }
  const out: OfficerKey[] = [];
  for (const row of rows) {
    if (!DeviceKeyId.safeParse(row.keyId).success) continue;
    // Published with its own kind, and only when that kind fits its ID (`app` a{n}, `web` w{n}, `web_demo`
    // demo-{6}): one misfit row would make the whole `OfficerKey` list unreadable, and Proof fail everywhere.
    if (!deviceKeyIdFitsKind(row.kind, row.keyId)) continue;
    const kind = row.kind as DeviceKeyKind;
    const publicKeyHex = publicKeyHexOf(row.publicKey);
    if (!publicKeyHex) continue;
    const approverId = resolveApprover(row, officers, ledgerPersona.get(row.keyId));
    const role = approverId ? approvalRoleOf(approverId) : null;
    if (!approverId || !role) continue;
    out.push({
      keyId: row.keyId,
      approverId,
      role,
      publicKeyHex,
      kind,
      revokedAt: row.revokedAt ? row.revokedAt.toISOString() : null,
    });
  }
  return out.sort((a, b) => (a.keyId < b.keyId ? -1 : a.keyId > b.keyId ? 1 : 0));
}

function resolveApprover(
  row: DeviceKeyRow,
  officers: readonly { persona: string | null; role: string }[],
  fromLedger: string | undefined,
): string | null {
  if (approvalRoleOf(row.persona)) return row.persona;
  const bare = row.persona.includes(":") ? null : row.persona;
  if (bare) {
    const m = officers.find((o) => o.persona === bare);
    if (m && (m.role === "treasurer" || m.role === "board")) return approverIdOf(m.role, bare);
  }
  if (fromLedger && approvalRoleOf(fromLedger)) return fromLedger;
  return null;
}

/** The seeded sample officer keys (kind "seeded"): the showcase's approvals verify against them, as Samples. */
export function sampleOfficerKeys(): OfficerKey[] {
  return getPublishedKeys().officers.map((k) => ({ ...k }));
}

/**
 * Drops every key ID that two sources publish with different public keys: the verifier requires exactly one
 * published key per ID, and an ambiguous ID must fail closed rather than verify against the wrong person.
 */
export function uniqueOfficers(keys: readonly OfficerKey[], log?: Pick<Logger, "warn">): OfficerKey[] {
  const byId = new Map<string, OfficerKey[]>();
  for (const k of keys) byId.set(k.keyId, [...(byId.get(k.keyId) ?? []), k]);
  const out: OfficerKey[] = [];
  for (const [keyId, list] of byId) {
    const first = list[0] as OfficerKey;
    const same = list.every(
      (k) =>
        k.publicKeyHex === first.publicKeyHex &&
        k.approverId === first.approverId &&
        k.role === first.role &&
        k.kind === first.kind,
    );
    if (!same) {
      log?.warn({ keyId }, "officer key published twice with different keys; withheld");
      continue;
    }
    out.push(first);
  }
  return out.sort((a, b) => (a.keyId < b.keyId ? -1 : a.keyId > b.keyId ? 1 : 0));
}

/** Officer keys of every non-judge workspace (judge workspaces publish theirs only per run, see below). */
export async function globalOfficerKeys(db: DbOrTx): Promise<OfficerKey[]> {
  const ws = await db
    .select({ id: schema.workspaces.id })
    .from(schema.workspaces)
    .where(inArray(schema.workspaces.kind, ["showcase", "real"]));
  const all: OfficerKey[] = [];
  for (const w of ws) all.push(...(await officerRegistry(db, w.id)));
  return all;
}

/**
 * `/.well-known/fairsplit-keys.json`: the officer keys and ledger keys a verifier pins, never a private half.
 * With a run's workspace, its officers (including a judge session's labelled demo keys) are published for that
 * run; without one, the non-judge workspaces' officers. The seeded sample keys are always present, labelled.
 */
export async function publishedKeys(
  db: DbOrTx,
  ledgerKey: LedgerSigningKey,
  opts: { workspaceId?: string | null; log?: Pick<Logger, "warn"> } = {},
): Promise<PublishedKeys> {
  const officers = opts.workspaceId
    ? await officerRegistry(db, opts.workspaceId)
    : await globalOfficerKeys(db);
  return {
    v: 1,
    officers: uniqueOfficers([...officers, ...sampleOfficerKeys()], opts.log),
    ledger: publishedLedgerKeys(ledgerKey),
  };
}
