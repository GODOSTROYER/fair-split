/**
 * Identity group (register §7): memberships, frame/pairing tokens, device keys, push tokens.
 * `workspaces` lives in ./workspace.ts and the Better Auth tables in ./auth.ts.
 * Tokens are stored only as sha256 (frame tokens `fst_` + 32 random bytes, 2 h; pairing tokens 10 min, single use).
 */
import { DEVICE_KEY_ID_PATTERN_BY_KIND, type DeviceKeyKind } from "@fairsplit/contracts";
import { sql } from "drizzle-orm";
import { check, pgTable, text, unique, uuid } from "drizzle-orm/pg-core";
import { ROLES } from "../_shims/contracts.js";
import { checkIn, checkSha, createdAt, id, sha256, tstz, wsFk, wsIdUnique } from "./_columns.js";
import { authUser } from "./auth.js";
import { members } from "./coop.js";
import { workspaceId } from "./workspace.js";

export const memberships = pgTable(
  "memberships",
  {
    id: id(),
    workspaceId: workspaceId(),
    userId: text("user_id").references(() => authUser.id, { onDelete: "cascade" }),
    persona: text("persona"),
    role: text("role", { enum: ROLES }).notNull(),
    memberId: uuid("member_id"),
    createdAt: createdAt(),
  },
  (t) => [
    checkIn("memberships_role_ck", t.role, ROLES),
    check("memberships_principal_ck", sql`${t.userId} is not null or ${t.persona} is not null`),
    unique("memberships_user_role_uq").on(t.workspaceId, t.userId, t.role),
    unique("memberships_persona_role_uq").on(t.workspaceId, t.persona, t.role),
    wsIdUnique("memberships", t),
    wsFk("memberships_member_fk", t, t.memberId, members),
  ],
);

export const frameTokens = pgTable(
  "frame_tokens",
  {
    id: id(),
    workspaceId: workspaceId(),
    tokenSha256: sha256("token_sha256").notNull().unique("frame_tokens_token_sha256_uq"),
    /** judge session that minted it; recorded as impersonated_by `judge_session:{sid}` */
    sessionId: uuid("session_id"),
    persona: text("persona").notNull(),
    role: text("role", { enum: ROLES }).notNull(),
    memberId: uuid("member_id"),
    expiresAt: tstz("expires_at").notNull(),
    revokedAt: tstz("revoked_at"),
    createdAt: createdAt(),
  },
  (t) => [
    checkIn("frame_tokens_role_ck", t.role, ROLES),
    checkSha("frame_tokens_token_sha256_ck", t.tokenSha256),
    wsIdUnique("frame_tokens", t),
    wsFk("frame_tokens_member_fk", t, t.memberId, members),
  ],
);

export const pairingTokens = pgTable(
  "pairing_tokens",
  {
    id: id(),
    workspaceId: workspaceId(),
    tokenSha256: sha256("token_sha256").notNull().unique("pairing_tokens_token_sha256_uq"),
    code6Sha256: sha256("code6_sha256").notNull(),
    persona: text("persona").notNull(),
    role: text("role", { enum: ROLES }).notNull(),
    memberId: uuid("member_id"),
    expiresAt: tstz("expires_at").notNull(),
    usedAt: tstz("used_at"),
    createdAt: createdAt(),
  },
  (t) => [
    checkIn("pairing_tokens_role_ck", t.role, ROLES),
    checkSha("pairing_tokens_token_sha256_ck", t.tokenSha256),
    checkSha("pairing_tokens_code6_sha256_ck", t.code6Sha256),
    wsIdUnique("pairing_tokens", t),
    wsFk("pairing_tokens_member_fk", t, t.memberId, members),
  ],
);

/**
 * The kinds a registered key has (contracts `DeviceKeyKind`): `app` (a person's app key), `web` (a persisted
 * browser key, the treasurer's `fs-analyn-w1`) and `web_demo` (a judge session's labelled key). A seeded key is
 * never registered (S3.8). Read from contracts' `DEVICE_KEY_ID_PATTERN_BY_KIND`, the one source of each kind's ID.
 */
export const DEVICE_KEY_KINDS = Object.keys(DEVICE_KEY_ID_PATTERN_BY_KIND) as [
  DeviceKeyKind,
  ...DeviceKeyKind[],
];

/** A SQL string literal for a constraint (standard_conforming_strings: only the quote needs doubling). */
const literal = (s: string) => `'${s.replaceAll("'", "''")}'`;

export const deviceKeys = pgTable(
  "device_keys",
  {
    id: id(),
    workspaceId: workspaceId(),
    /** its kind's shape (C-13): app `fs-{persona}-a{n}`, web `fs-{persona}-w{n}`, web_demo `fs-{persona}-demo-{6}` */
    keyId: text("key_id").notNull(),
    persona: text("persona").notNull(),
    userId: text("user_id").references(() => authUser.id, { onDelete: "set null" }),
    /** Ed25519 public key, base64url of the raw 32 bytes */
    publicKey: text("public_key").notNull(),
    kind: text("kind", { enum: DEVICE_KEY_KINDS }).notNull(),
    platform: text("platform"),
    biometricClass: text("biometric_class"),
    revokedAt: tstz("revoked_at"),
    createdAt: createdAt(),
  },
  (t) => [
    checkIn("device_keys_kind_ck", t.kind, DEVICE_KEY_KINDS),
    // one CHECK per kind: a key's ID has its own kind's shape, so a demo key never takes a real key's ID (C-13)
    ...DEVICE_KEY_KINDS.map((kind) =>
      check(
        `device_keys_key_id_${kind}_ck`,
        sql`${t.kind} <> ${sql.raw(literal(kind))} or ${t.keyId} ~ ${sql.raw(literal(DEVICE_KEY_ID_PATTERN_BY_KIND[kind]))}`,
      ),
    ),
    unique("device_keys_key_id_uq").on(t.workspaceId, t.keyId),
    wsIdUnique("device_keys", t),
  ],
);

export const pushTokens = pgTable(
  "push_tokens",
  {
    id: id(),
    workspaceId: workspaceId(),
    persona: text("persona").notNull(),
    deviceKeyId: uuid("device_key_id"),
    expoToken: text("expo_token").notNull(),
    platform: text("platform").notNull(),
    revokedAt: tstz("revoked_at"),
    createdAt: createdAt(),
  },
  (t) => [
    unique("push_tokens_token_uq").on(t.workspaceId, t.expoToken),
    wsIdUnique("push_tokens", t),
    wsFk("push_tokens_device_key_fk", t, t.deviceKeyId, deviceKeys),
  ],
);
