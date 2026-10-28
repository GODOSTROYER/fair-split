-- Fair Split: the purge follows the lock order too (review minor, 0003).
--
-- src/tx.ts documents one lock order for every transaction that touches a workspace's rows: the workspace lock (the
-- transaction-scoped advisory lock on 'fs:ws-log:<workspace id>') first, row locks after. fs_purge_workspace took the
-- workspaces row FOR UPDATE and then deleted the workspace's rows without the workspace lock. A transition running at
-- the same time holds the workspace lock and its run's row lock, and its run.state event then needs FOR KEY SHARE on
-- the workspaces row (the event's foreign key): the purge waited for the run row while the transition waited for the
-- workspace row, and Postgres aborted one of them (a judge Reset or the hourly judgeReset racing a running task).
-- Now the purge takes the workspace lock before anything else, so it waits for such a transaction to commit and
-- then removes the workspace with everything that transaction wrote. The key is the one lockWorkspaceLog() uses.

CREATE OR REPLACE FUNCTION fs_purge_workspace(ws uuid) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  w record;
BEGIN
  -- the workspace lock first (src/tx.ts lock order), then the workspace row
  PERFORM pg_advisory_xact_lock(hashtextextended('fs:ws-log:' || ws::text, 0));
  SELECT kind, expires_at INTO w FROM workspaces WHERE id = ws FOR UPDATE;
  IF NOT FOUND THEN
    RETURN false;
  END IF;
  -- strictly past: at its expiry instant a session has not yet ended (0013)
  IF w.kind <> 'judge' OR w.expires_at IS NULL OR w.expires_at >= now() THEN
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
