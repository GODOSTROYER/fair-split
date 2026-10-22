-- Fair Split: purge tickets replace the forgeable fs.purge setting (S3.4; review blocker).
--
-- 0002 let every guard step aside while current_setting('fs.purge') = 'on'. That is a custom placeholder
-- setting, so any role could turn it on with set_config() and then rewrite a ratified rate card (I2) or delete a
-- workspace and cascade away its run_events, ledger_entries and agent_sessions. The bypass is now a row in
-- fs_private.purge_tickets, keyed by (workspace, transaction id):
--   * the fs_private schema and its tables belong to the owner alone (no USAGE or grant for PUBLIC or fs_app,
--     and 0002's default privileges cover only schema public);
--   * fs_purge_workspace() (SECURITY DEFINER) writes the ticket, deletes the workspace and removes the ticket,
--     all in the caller's transaction, so a ticket never outlives the purge that needed it;
--   * every guard is SECURITY DEFINER with a pinned search_path, so it can see a ticket the app cannot forge.
-- fs_app also loses DELETE on workspaces, and a workspace's id, kind and created_at never change, so a showcase
-- cannot be relabelled as an expired judge workspace and purged.

CREATE SCHEMA IF NOT EXISTS fs_private;
--> statement-breakpoint
REVOKE ALL ON SCHEMA fs_private FROM PUBLIC;
--> statement-breakpoint
CREATE TABLE fs_private.purge_tickets (
  workspace_id uuid NOT NULL,
  txid bigint NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT purge_tickets_pk PRIMARY KEY (workspace_id, txid)
);
--> statement-breakpoint
REVOKE ALL ON fs_private.purge_tickets FROM PUBLIC;
--> statement-breakpoint
-- true while fs_purge_workspace(ws) runs in the current transaction; callable only by the owner (and so by the
-- SECURITY DEFINER guards below)
CREATE OR REPLACE FUNCTION fs_purging(ws uuid) RETURNS boolean
LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT EXISTS (SELECT 1 FROM fs_private.purge_tickets t WHERE t.workspace_id = ws AND t.txid = txid_current())
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION fs_purging(uuid) FROM PUBLIC;
--> statement-breakpoint

-- ─── I2 · a ratified rate card is bolted (purge is the only way out) ────────────────────────────────────
CREATE OR REPLACE FUNCTION fs_rate_card_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF OLD.ratified_at IS NOT NULL AND NOT fs_purging(OLD.workspace_id) THEN
    RAISE EXCEPTION 'RATE_CARD_RATIFIED:%', OLD.sha256
      USING ERRCODE = 'FS409',
            DETAIL = format('Rate card %s was ratified at %s; it is closed.', OLD.code, OLD.ratified_at),
            HINT = 'A change needs a new Board resolution for the next season.';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION fs_rate_rules_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  card record;
BEGIN
  IF TG_OP = 'DELETE' AND fs_purging(OLD.workspace_id) THEN
    RETURN OLD;
  END IF;
  -- FOR SHARE: a concurrent ratification waits for this write, or this write sees the ratification
  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    SELECT code, sha256, ratified_at INTO card FROM rate_cards WHERE id = OLD.rate_card_id FOR SHARE;
    IF card.ratified_at IS NOT NULL THEN
      RAISE EXCEPTION 'RATE_CARD_RATIFIED:%', card.sha256
        USING ERRCODE = 'FS409',
              DETAIL = format('Rate card %s was ratified at %s; its rules are closed.', card.code, card.ratified_at);
    END IF;
  END IF;
  IF TG_OP IN ('INSERT', 'UPDATE') THEN
    SELECT code, sha256, ratified_at INTO card FROM rate_cards WHERE id = NEW.rate_card_id FOR SHARE;
    IF card.ratified_at IS NOT NULL THEN
      RAISE EXCEPTION 'RATE_CARD_RATIFIED:%', card.sha256
        USING ERRCODE = 'FS409',
              DETAIL = format('Rate card %s was ratified at %s; its rules are closed.', card.code, card.ratified_at);
    END IF;
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END
$$;
--> statement-breakpoint

-- ─── append-only: run_events, ledger_entries, agent_sessions ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION fs_append_only() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  -- row-level DELETE inside fs_purge_workspace() only; TRUNCATE (statement level, no OLD) never
  IF TG_LEVEL = 'ROW' AND TG_OP = 'DELETE' AND fs_purging(OLD.workspace_id) THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'APPEND_ONLY:%', TG_TABLE_NAME
    USING ERRCODE = 'FS409', DETAIL = format('%s on %s is refused: the table is append-only.', TG_OP, TG_TABLE_NAME);
END
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION fs_ledger_heads_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.seq <> 0 OR NEW.entry_hash <> repeat('0', 64) THEN
      RAISE EXCEPTION 'LEDGER_FORK:%', NEW.workspace_id
        USING ERRCODE = 'FS409', DETAIL = 'A ledger head starts at seq 0 with the genesis hash.';
    END IF;
    RETURN NEW;
  END IF;
  IF TG_OP = 'DELETE' THEN
    IF fs_purging(OLD.workspace_id) THEN
      RETURN OLD;
    END IF;
    RAISE EXCEPTION 'APPEND_ONLY:ledger_heads' USING ERRCODE = 'FS409';
  END IF;
  -- UPDATE: only fs_ledger_link (one trigger level down) may move a head
  IF pg_trigger_depth() < 2 THEN
    RAISE EXCEPTION 'LEDGER_FORK:%', OLD.workspace_id
      USING ERRCODE = 'FS409', DETAIL = 'ledger_heads moves only by appending to ledger_entries.';
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint

-- ─── workspaces: deleted only by a purge; id, kind and created_at never change ─────────────────────────
CREATE OR REPLACE FUNCTION fs_workspaces_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF fs_purging(OLD.id) THEN
      RETURN OLD;
    END IF;
    RAISE EXCEPTION 'PURGE_REFUSED:%', OLD.id
      USING ERRCODE = 'FS409',
            DETAIL = 'A workspace is deleted only by fs_purge_workspace(), and only an expired judge workspace.';
  END IF;
  IF NEW.id IS DISTINCT FROM OLD.id THEN
    RAISE EXCEPTION 'FROZEN_COLUMN:workspaces.id' USING ERRCODE = 'FS409';
  END IF;
  IF NEW.kind IS DISTINCT FROM OLD.kind THEN
    RAISE EXCEPTION 'FROZEN_COLUMN:workspaces.kind'
      USING ERRCODE = 'FS409', DETAIL = format('Workspace %s is a %s workspace; that never changes.', OLD.id, OLD.kind);
  END IF;
  IF NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'FROZEN_COLUMN:workspaces.created_at' USING ERRCODE = 'FS409';
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER workspaces_guard BEFORE UPDATE OR DELETE ON workspaces
  FOR EACH ROW EXECUTE FUNCTION fs_workspaces_guard();
--> statement-breakpoint

-- ─── purge: the only way rows of an expired Judge workspace leave ────────────────────────────────────────
CREATE OR REPLACE FUNCTION fs_purge_workspace(ws uuid) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  w record;
BEGIN
  SELECT kind, expires_at INTO w FROM workspaces WHERE id = ws FOR UPDATE;
  IF NOT FOUND THEN
    RETURN false;
  END IF;
  IF w.kind <> 'judge' OR w.expires_at IS NULL OR w.expires_at > now() THEN
    RAISE EXCEPTION 'PURGE_REFUSED:%', ws
      USING ERRCODE = 'FS409', DETAIL = 'Only an expired judge workspace can be purged.';
  END IF;
  IF EXISTS (SELECT 1 FROM pay_runs WHERE workspace_id = ws AND state = 'POSTING')
     OR EXISTS (SELECT 1 FROM payout_items WHERE workspace_id = ws
                 AND status IN ('SUBMITTED', 'PENDING', 'ONHOLD', 'UNCLAIMED')) THEN
    RAISE EXCEPTION 'PURGE_REFUSED:%', ws
      USING ERRCODE = 'FS409', DETAIL = 'Money is in flight: a run is POSTING or an item is not terminal.';
  END IF;
  INSERT INTO fs_private.purge_tickets (workspace_id, txid) VALUES (ws, txid_current()) ON CONFLICT DO NOTHING;
  DELETE FROM workspaces WHERE id = ws;
  DELETE FROM fs_private.purge_tickets WHERE workspace_id = ws AND txid = txid_current();
  RETURN true;
END
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION fs_purge_workspace(uuid) FROM PUBLIC;
--> statement-breakpoint

-- ─── grants: 0002's default privileges gave fs_app DML on every new table; take back what it must not have ──
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'fs_app') THEN
    EXECUTE 'REVOKE ALL ON SCHEMA fs_private FROM fs_app';
    EXECUTE 'REVOKE ALL ON fs_private.purge_tickets FROM fs_app';
    EXECUTE 'REVOKE DELETE, TRUNCATE ON workspaces FROM fs_app';
    EXECUTE 'GRANT EXECUTE ON FUNCTION fs_purge_workspace(uuid) TO fs_app';
  END IF;
END
$$;
