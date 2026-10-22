/**
 * The tenancy root. Every other table carries `workspace_id` referencing this table with ON DELETE CASCADE,
 * so `fs_purge_workspace(ws)` removes an expired Judge workspace in one statement.
 */
import { foreignKey, index, pgTable, text, uuid } from "drizzle-orm/pg-core";
import { WORKSPACE_KINDS } from "../_shims/contracts.js";
import { checkIn, createdAt, id, tstz } from "./_columns.js";

export const workspaces = pgTable(
  "workspaces",
  {
    id: id(),
    kind: text("kind", { enum: WORKSPACE_KINDS }).notNull(),
    name: text("name").notNull(),
    seededFrom: uuid("seeded_from"),
    claimedAt: tstz("claimed_at"),
    expiresAt: tstz("expires_at"),
    createdAt: createdAt(),
  },
  (t) => [
    checkIn("workspaces_kind_ck", t.kind, WORKSPACE_KINDS),
    foreignKey({
      name: "workspaces_seeded_from_fk",
      columns: [t.seededFrom],
      foreignColumns: [t.id],
    }).onDelete("set null"),
    index("workspaces_kind_expires_idx").on(t.kind, t.expiresAt),
  ],
);

/** `workspace_id uuid not null references workspaces(id) on delete cascade` */
export const workspaceId = () =>
  uuid("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" });

/** Nullable variant for system-wide rows: unresolved webhooks, PayPal calls, cron tasks, health reports. */
export const workspaceIdNullable = () =>
  uuid("workspace_id").references(() => workspaces.id, { onDelete: "cascade" });
