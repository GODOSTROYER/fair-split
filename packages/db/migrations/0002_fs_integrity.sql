-- Fair Split: integrity rules Drizzle cannot express (register §7, architecture §0/§3/§12, S3.4).
--
-- Error convention: SQLSTATE FS409 (conflict with frozen state) or FS422 (rules before facts); the message is
-- "<CODE>:<detail>" with CODE from DB_ERROR_CODES, so the API can map it (e.g. MM-4's 409 citing the hash).
-- fs.purge: a transaction-local setting that only fs_purge_workspace() turns on; it lets the purge cascade
-- through append-only and frozen rows of an expired Judge workspace, and nothing else.

-- ─── I2 · a ratified rate card is bolted ────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION fs_rate_card_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.ratified_at IS NOT NULL AND current_setting('fs.purge', true) IS DISTINCT FROM 'on' THEN
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
CREATE TRIGGER rate_cards_ratified_guard
  BEFORE UPDATE OR DELETE ON rate_cards
  FOR EACH ROW EXECUTE FUNCTION fs_rate_card_guard();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION fs_rate_rules_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  card record;
BEGIN
  IF current_setting('fs.purge', true) = 'on' THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
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
CREATE TRIGGER rate_rules_ratified_guard
  BEFORE INSERT OR UPDATE OR DELETE ON rate_rules
  FOR EACH ROW EXECUTE FUNCTION fs_rate_rules_guard();
--> statement-breakpoint

-- ─── I2 · rules before facts: no slip row before (or dated before) ratification ─────────────────────────
CREATE OR REPLACE FUNCTION fs_slip_rows_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  card record;
  ratified_day date;
BEGIN
  SELECT rc.sha256, rc.ratified_at, s.tz INTO card
    FROM seasons s
    LEFT JOIN rate_cards rc ON rc.workspace_id = s.workspace_id AND rc.season_id = s.id
   WHERE s.workspace_id = NEW.workspace_id AND s.id = NEW.season_id;
  IF card.ratified_at IS NULL THEN
    RAISE EXCEPTION 'RULES_BEFORE_FACTS:no ratified rate card for season %', NEW.season_id
      USING ERRCODE = 'FS422', DETAIL = 'Rules are frozen before facts: ratify the rate card first.';
  END IF;
  IF clock_timestamp() < card.ratified_at THEN
    RAISE EXCEPTION 'RULES_BEFORE_FACTS:slip % written before ratification at %', NEW.serial, card.ratified_at
      USING ERRCODE = 'FS422';
  END IF;
  ratified_day := (card.ratified_at AT TIME ZONE card.tz)::date;
  IF NEW.slip_date IS NOT NULL AND NEW.slip_date < ratified_day THEN
    RAISE EXCEPTION 'RULES_BEFORE_FACTS:slip % dated % before ratification on %', NEW.serial, NEW.slip_date, ratified_day
      USING ERRCODE = 'FS422', DETAIL = format('Rate card %s was ratified on %s.', card.sha256, ratified_day);
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER slip_rows_rules_before_facts
  BEFORE INSERT OR UPDATE OF slip_date, season_id ON slip_rows
  FOR EACH ROW EXECUTE FUNCTION fs_slip_rows_guard();
--> statement-breakpoint

-- ─── append-only: run_events, ledger_entries, agent_sessions ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION fs_append_only() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' AND current_setting('fs.purge', true) = 'on' THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'APPEND_ONLY:%', TG_TABLE_NAME
    USING ERRCODE = 'FS409', DETAIL = format('%s on %s is refused: the table is append-only.', TG_OP, TG_TABLE_NAME);
END
$$;
--> statement-breakpoint
CREATE TRIGGER run_events_append_only BEFORE UPDATE OR DELETE ON run_events
  FOR EACH ROW EXECUTE FUNCTION fs_append_only();
--> statement-breakpoint
CREATE TRIGGER run_events_no_truncate BEFORE TRUNCATE ON run_events
  FOR EACH STATEMENT EXECUTE FUNCTION fs_append_only();
--> statement-breakpoint
CREATE TRIGGER ledger_entries_append_only BEFORE UPDATE OR DELETE ON ledger_entries
  FOR EACH ROW EXECUTE FUNCTION fs_append_only();
--> statement-breakpoint
CREATE TRIGGER ledger_entries_no_truncate BEFORE TRUNCATE ON ledger_entries
  FOR EACH STATEMENT EXECUTE FUNCTION fs_append_only();
--> statement-breakpoint
CREATE TRIGGER agent_sessions_append_only BEFORE UPDATE OR DELETE ON agent_sessions
  FOR EACH ROW EXECUTE FUNCTION fs_append_only();
--> statement-breakpoint
CREATE TRIGGER agent_sessions_no_truncate BEFORE TRUNCATE ON agent_sessions
  FOR EACH STATEMENT EXECUTE FUNCTION fs_append_only();
--> statement-breakpoint

-- ─── the ledger chain is linked in SQL: one head per workspace, moved only by appending ──────────────────
CREATE OR REPLACE FUNCTION fs_ledger_link() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  head record;
BEGIN
  INSERT INTO ledger_heads (workspace_id) VALUES (NEW.workspace_id) ON CONFLICT (workspace_id) DO NOTHING;
  SELECT seq, entry_hash INTO head FROM ledger_heads WHERE workspace_id = NEW.workspace_id FOR UPDATE;
  IF NEW.seq <> head.seq + 1 OR NEW.prev_hash <> head.entry_hash THEN
    RAISE EXCEPTION 'LEDGER_FORK:%', NEW.workspace_id
      USING ERRCODE = 'FS409',
            DETAIL = format('Entry seq %s (prev %s) does not extend head seq %s (%s).',
                            NEW.seq, NEW.prev_hash, head.seq, head.entry_hash);
  END IF;
  UPDATE ledger_heads SET seq = NEW.seq, entry_hash = NEW.entry_hash, updated_at = now()
   WHERE workspace_id = NEW.workspace_id;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER ledger_entries_link BEFORE INSERT ON ledger_entries
  FOR EACH ROW EXECUTE FUNCTION fs_ledger_link();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION fs_ledger_heads_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.seq <> 0 OR NEW.entry_hash <> repeat('0', 64) THEN
      RAISE EXCEPTION 'LEDGER_FORK:%', NEW.workspace_id
        USING ERRCODE = 'FS409', DETAIL = 'A ledger head starts at seq 0 with the genesis hash.';
    END IF;
    RETURN NEW;
  END IF;
  IF TG_OP = 'DELETE' THEN
    IF current_setting('fs.purge', true) = 'on' THEN
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
CREATE TRIGGER ledger_heads_guard BEFORE INSERT OR UPDATE OR DELETE ON ledger_heads
  FOR EACH ROW EXECUTE FUNCTION fs_ledger_heads_guard();
--> statement-breakpoint

-- ─── I5 · payout item statuses only climb the register's ranks ───────────────────────────────────────────
CREATE OR REPLACE FUNCTION fs_payout_item_rank_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF NEW.status_rank <= OLD.status_rank THEN
      RAISE EXCEPTION 'ITEM_STATUS_REGRESSION:%', NEW.sender_item_id
        USING ERRCODE = 'FS409',
              DETAIL = format('%s (rank %s) cannot follow %s (rank %s).',
                              NEW.status, NEW.status_rank, OLD.status, OLD.status_rank);
    END IF;
    IF NEW.status = 'RETURNED' AND NEW.cancel_requested_at IS NULL THEN
      RAISE EXCEPTION 'RETURN_WITHOUT_CANCEL:%', NEW.sender_item_id
        USING ERRCODE = 'FS409', DETAIL = 'RETURNED is accepted only after our own cancel.';
    END IF;
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER payout_items_rank_guard BEFORE UPDATE OF status, status_rank ON payout_items
  FOR EACH ROW EXECUTE FUNCTION fs_payout_item_rank_guard();
--> statement-breakpoint

-- ─── realtime: NOTIFY is delivered on commit, never before ───────────────────────────────────────────────
CREATE OR REPLACE FUNCTION fs_notify_run_event() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_notify('run_events', NEW.workspace_id::text || ':' || NEW.id::text);
  RETURN NULL;
END
$$;
--> statement-breakpoint
CREATE TRIGGER run_events_notify AFTER INSERT ON run_events
  FOR EACH ROW EXECUTE FUNCTION fs_notify_run_event();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION fs_notify_outbox() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_notify('fs_outbox', NEW.id::text);
  RETURN NULL;
END
$$;
--> statement-breakpoint
CREATE TRIGGER task_outbox_notify AFTER INSERT ON task_outbox
  FOR EACH ROW EXECUTE FUNCTION fs_notify_outbox();
--> statement-breakpoint

-- ─── updated_at bookkeeping ──────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION fs_touch_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER slip_rows_touch BEFORE UPDATE ON slip_rows FOR EACH ROW EXECUTE FUNCTION fs_touch_updated_at();
--> statement-breakpoint
CREATE TRIGGER slip_fields_touch BEFORE UPDATE ON slip_fields FOR EACH ROW EXECUTE FUNCTION fs_touch_updated_at();
--> statement-breakpoint
CREATE TRIGGER pay_runs_touch BEFORE UPDATE ON pay_runs FOR EACH ROW EXECUTE FUNCTION fs_touch_updated_at();
--> statement-breakpoint
CREATE TRIGGER invoices_touch BEFORE UPDATE ON invoices FOR EACH ROW EXECUTE FUNCTION fs_touch_updated_at();
--> statement-breakpoint
CREATE TRIGGER member_lines_touch BEFORE UPDATE ON member_lines FOR EACH ROW EXECUTE FUNCTION fs_touch_updated_at();
--> statement-breakpoint
CREATE TRIGGER holds_touch BEFORE UPDATE ON holds FOR EACH ROW EXECUTE FUNCTION fs_touch_updated_at();
--> statement-breakpoint
CREATE TRIGGER payout_batches_touch BEFORE UPDATE ON payout_batches FOR EACH ROW EXECUTE FUNCTION fs_touch_updated_at();
--> statement-breakpoint
CREATE TRIGGER payout_items_touch BEFORE UPDATE ON payout_items FOR EACH ROW EXECUTE FUNCTION fs_touch_updated_at();
--> statement-breakpoint
CREATE TRIGGER task_outbox_touch BEFORE UPDATE ON task_outbox FOR EACH ROW EXECUTE FUNCTION fs_touch_updated_at();
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
  PERFORM set_config('fs.purge', 'on', true);
  DELETE FROM workspaces WHERE id = ws;
  PERFORM set_config('fs.purge', 'off', true);
  RETURN true;
END
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION fs_purge_workspace(uuid) FROM PUBLIC;
--> statement-breakpoint

-- ─── the application role: no UPDATE, DELETE or TRUNCATE on append-only tables ───────────────────────────
-- Migrations run as the owner. The app connects as the owner and assumes fs_app (SET ROLE, see client.ts).
-- If the owner may not CREATE ROLE (Render, UNVERIFIED in S6), the triggers above still refuse the writes.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'fs_app') THEN
    BEGIN
      CREATE ROLE fs_app NOLOGIN;
    EXCEPTION WHEN insufficient_privilege THEN
      RAISE WARNING 'fs_app not created (no CREATEROLE); append-only triggers still guard the tables';
    END;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'fs_app') THEN
    EXECUTE 'GRANT USAGE ON SCHEMA public TO fs_app';
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO fs_app';
    EXECUTE 'GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO fs_app';
    EXECUTE 'ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO fs_app';
    EXECUTE 'ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO fs_app';
    EXECUTE 'REVOKE UPDATE, DELETE, TRUNCATE ON run_events, ledger_entries, agent_sessions FROM fs_app';
    EXECUTE 'REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON ledger_heads FROM fs_app';
    EXECUTE 'GRANT EXECUTE ON FUNCTION fs_purge_workspace(uuid) TO fs_app';
    BEGIN
      EXECUTE format('GRANT fs_app TO %I', current_user);
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'could not grant fs_app to %: %', current_user, SQLERRM;
    END;
  END IF;
END
$$;
