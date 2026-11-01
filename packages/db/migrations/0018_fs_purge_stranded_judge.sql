-- A simulator restart records accepted batches as payout.stranded without fabricating terminal item statuses.
-- Only an expired judge workspace may discard those demo items. A POSTING run or even one open item whose
-- own batch has not been recorded stranded still blocks the purge. Keep the workspace-first lock order.
CREATE OR REPLACE FUNCTION fs_purge_workspace(ws uuid) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  w record;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('fs:ws-log:' || ws::text, 0));
  SELECT kind, expires_at INTO w FROM workspaces WHERE id = ws FOR UPDATE;
  IF NOT FOUND THEN
    RETURN false;
  END IF;
  IF w.kind <> 'judge' OR w.expires_at IS NULL OR w.expires_at >= now() THEN
    RAISE EXCEPTION 'PURGE_REFUSED:%', ws
      USING ERRCODE = 'FS409', DETAIL = 'Only an expired judge workspace can be purged.';
  END IF;
  IF EXISTS (SELECT 1 FROM pay_runs WHERE workspace_id = ws AND state = 'POSTING')
     OR EXISTS (SELECT 1 FROM payout_items i WHERE i.workspace_id = ws
                 AND i.status IN ('SUBMITTED', 'PENDING', 'ONHOLD', 'UNCLAIMED')
                 AND NOT EXISTS (SELECT 1 FROM ledger_entries l
                                  WHERE l.workspace_id = ws AND l.kind = 'payout.stranded'
                                    AND l.payload->>'batchId' = i.batch_id::text)) THEN
    RAISE EXCEPTION 'PURGE_REFUSED:%', ws
      USING ERRCODE = 'FS409', DETAIL = 'Money is in flight: a run is POSTING or an unstranded item is not terminal.';
  END IF;
  INSERT INTO fs_private.purge_tickets (workspace_id, txid) VALUES (ws, txid_current()) ON CONFLICT DO NOTHING;
  DELETE FROM workspaces WHERE id = ws;
  DELETE FROM fs_private.purge_tickets WHERE workspace_id = ws AND txid = txid_current();
  RETURN true;
END
$$;
