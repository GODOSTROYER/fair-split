-- Fair Split: a claim lasts the judge session, and no expiry sits on the purge boundary
-- (automated security review of 0009, 2 MEDIUM).
--
-- 0009 let an expiry move only later and never "into the past", tested as NEW.expires_at < now(). Two gaps remained:
--   1. the boundary: an expiry equal to now() is not < now(), so it was accepted, and fs_purge_workspace (which
--      refused only expires_at > now()) purged the workspace in the same transaction;
--   2. no minimum lifetime: NULL → a few seconds ahead claimed a pooled judge workspace that the app could purge
--      moments later, with the session's run_events, ledger_entries and agent_sessions.
--
-- Now, for every role, a change to expires_at must leave it
--   * set, and no earlier than it was (0009);
--   * more than a minute ahead of the database's wall clock (clock_timestamp(), not the transaction's start), so a
--     changed expiry is never purgeable in the transaction that wrote it, nor for at least a minute after;
--   * on a claim (NULL → value), at least 24 hours after the claim — the judge session's lifetime (S3.9: the cookie
--     and the workspace live 24 h) — measured from the transaction's now() truncated to the millisecond, the
--     precision clients read timestamps back with. claimJudgeWorkspace() (src/judge-pool.ts) writes exactly that.
-- And fs_purge_workspace takes a judge workspace only when its expiry is strictly before its now().
-- Inserts are still unaffected: a workspace that is born has no history to lose, and the pool's workspaces are born
-- unclaimed (expires_at NULL) and claimed by an UPDATE.

CREATE OR REPLACE FUNCTION fs_workspaces_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  claim_floor timestamptz;
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
  IF NEW.expires_at IS DISTINCT FROM OLD.expires_at THEN
    IF NEW.expires_at IS NULL OR NEW.expires_at < OLD.expires_at THEN
      RAISE EXCEPTION 'FROZEN_COLUMN:workspaces.expires_at'
        USING ERRCODE = 'FS409',
              DETAIL = format('Workspace %s expires at %s; an expiry only moves later (not to %s).',
                              OLD.id, coalesce(OLD.expires_at::text, 'no set time'),
                              coalesce(NEW.expires_at::text, 'NULL')),
              HINT = 'A judge Reset ends the session; the hourly purge removes the workspace once it has expired.';
    END IF;
    claim_floor := date_trunc('milliseconds', now()) + interval '24 hours';
    IF OLD.expires_at IS NULL AND NEW.expires_at < claim_floor THEN
      RAISE EXCEPTION 'FROZEN_COLUMN:workspaces.expires_at'
        USING ERRCODE = 'FS409',
              DETAIL = format('Workspace %s is claimed for at least 24 hours: its first expiry must be %s or later '
                              '(not %s).', OLD.id, claim_floor, NEW.expires_at),
              HINT = 'Claim with claimJudgeWorkspace(), which writes expires_at = now() + 24 hours by the database clock.';
    END IF;
    IF NEW.expires_at <= clock_timestamp() + interval '1 minute' THEN
      RAISE EXCEPTION 'FROZEN_COLUMN:workspaces.expires_at'
        USING ERRCODE = 'FS409',
              DETAIL = format('Workspace %s: an expiry is set more than a minute ahead of the database clock (%s), '
                              'never at or near it (not %s).', OLD.id, clock_timestamp(), NEW.expires_at),
              HINT = 'An expiry at the current instant would be purgeable at once.';
    END IF;
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION fs_purge_workspace(ws uuid) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  w record;
BEGIN
  SELECT kind, expires_at INTO w FROM workspaces WHERE id = ws FOR UPDATE;
  IF NOT FOUND THEN
    RETURN false;
  END IF;
  -- strictly past: at its expiry instant a session has not yet ended
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
