-- Fair Split: the database's clock says when a rate card was ratified (I2; review minor, 0002).
--
-- 0002 trusted rate_cards.ratified_at as the app wrote it: a card could be inserted already ratified, or moved from
-- NULL to any past instant, backdating the ratification so that slips dated before the real one were accepted.
-- Now the moment a card becomes ratified (INSERT with ratified_at, or UPDATE from NULL) the row stores now(),
-- whatever the app wrote. The one exception is loading a seeded snapshot (the showcase and Judge clones, ratified on
-- 14 Mar): inside a seed window, rows labelled provenance 'seeded' keep their instant. A window is an owner-only
-- ticket for (workspace, transaction), opened by fs_open_seed(ws) and only for a fresh showcase or judge workspace —
-- never a real one, and never one that already has a ratified card. It ends with its transaction.

CREATE TABLE fs_private.seed_tickets (
  workspace_id uuid NOT NULL,
  txid bigint NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT seed_tickets_pk PRIMARY KEY (workspace_id, txid)
);
--> statement-breakpoint
REVOKE ALL ON fs_private.seed_tickets FROM PUBLIC;
--> statement-breakpoint
-- true inside fs_open_seed(ws)'s transaction; owner-only (the SECURITY DEFINER trigger below calls it)
CREATE OR REPLACE FUNCTION fs_seeding(ws uuid) RETURNS boolean
LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT EXISTS (SELECT 1 FROM fs_private.seed_tickets t WHERE t.workspace_id = ws AND t.txid = txid_current())
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION fs_seeding(uuid) FROM PUBLIC;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION fs_open_seed(ws uuid) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  w record;
BEGIN
  SELECT kind INTO w FROM workspaces WHERE id = ws;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'SEED_REFUSED:%', ws USING ERRCODE = 'FS409', DETAIL = 'No such workspace.';
  END IF;
  IF w.kind NOT IN ('showcase', 'judge') THEN
    RAISE EXCEPTION 'SEED_REFUSED:%', ws
      USING ERRCODE = 'FS409',
            DETAIL = format('A %s workspace is never seeded: its ratifications carry the database clock.', w.kind);
  END IF;
  -- FOR SHARE: a concurrent ratification or slip either commits first (and is seen here) or waits for this window
  PERFORM 1 FROM rate_cards WHERE workspace_id = ws FOR SHARE;
  IF EXISTS (SELECT 1 FROM rate_cards WHERE workspace_id = ws AND ratified_at IS NOT NULL)
     OR EXISTS (SELECT 1 FROM slip_rows WHERE workspace_id = ws) THEN
    RAISE EXCEPTION 'SEED_REFUSED:%', ws
      USING ERRCODE = 'FS409',
            DETAIL = 'The workspace already has a ratified card or facts; a snapshot loads only into a fresh one.';
  END IF;
  -- tickets of finished transactions open nothing; drop them on the way
  DELETE FROM fs_private.seed_tickets WHERE txid < txid_snapshot_xmin(txid_current_snapshot());
  INSERT INTO fs_private.seed_tickets (workspace_id, txid) VALUES (ws, txid_current()) ON CONFLICT DO NOTHING;
  RETURN true;
END
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION fs_open_seed(uuid) FROM PUBLIC;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION fs_rate_card_ratified_now() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NEW.ratified_at IS NOT NULL AND (TG_OP = 'INSERT' OR OLD.ratified_at IS NULL)
     AND NOT (NEW.provenance = 'seeded' AND fs_seeding(NEW.workspace_id)) THEN
    NEW.ratified_at := now();
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
-- after rate_cards_ratified_guard (alphabetical within BEFORE UPDATE), which refuses any change to a ratified card
CREATE TRIGGER rate_cards_ratified_now BEFORE INSERT OR UPDATE OF ratified_at ON rate_cards
  FOR EACH ROW EXECUTE FUNCTION fs_rate_card_ratified_now();
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'fs_app') THEN
    EXECUTE 'REVOKE ALL ON fs_private.seed_tickets FROM fs_app';
    EXECUTE 'GRANT EXECUTE ON FUNCTION fs_open_seed(uuid) TO fs_app';
  END IF;
END
$$;
