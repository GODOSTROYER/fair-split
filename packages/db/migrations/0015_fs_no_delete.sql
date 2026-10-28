-- Fair Split: state rows leave only with their workspace (I4, I5, I6; review minor, 0006).
--
-- 0006 made state move only along the machines, but only for UPDATE. fs_app kept 0002's blanket DELETE on the tables
-- it guards, so a signed approval could be deleted (freeing its live slot with no void and no ledger row), a payout
-- item deleted and re-inserted at a lower status, a run or line without events deleted and re-inserted in any state,
-- and deleting the non-terminal items of an expired judge workspace defeated fs_purge_workspace's "money in flight"
-- refusal. No repository deletes these rows; only raw SQL could, which is what the backstop is for.
--
-- Now fs_app has no DELETE or TRUNCATE on pay_runs, member_lines, holds, payout_items and approvals, and BEFORE
-- DELETE / TRUNCATE triggers refuse every role (FS409 DELETE_REFUSED:<table>) unless fs_purge_workspace() is removing
-- the row's workspace (its owner-only ticket, 0003). The purge's cascade still removes them: referential actions run
-- as the table owner and the ticket opens the triggers. Rows move forward instead: a run or line to its exit state,
-- a hold to its resolution, an approval to void.

CREATE OR REPLACE FUNCTION fs_no_delete() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  -- row-level DELETE inside fs_purge_workspace() only; TRUNCATE (statement level, no OLD) never
  IF TG_LEVEL = 'ROW' AND fs_purging(OLD.workspace_id) THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'DELETE_REFUSED:%', TG_TABLE_NAME
    USING ERRCODE = 'FS409',
          DETAIL = format('%s on %s is refused: its rows leave only with their workspace (fs_purge_workspace).',
                          TG_OP, TG_TABLE_NAME),
          HINT = 'Move the row forward instead: a run or line to its exit state, a hold to its resolution, an approval to void.';
END
$$;
--> statement-breakpoint
CREATE TRIGGER pay_runs_no_delete BEFORE DELETE ON pay_runs
  FOR EACH ROW EXECUTE FUNCTION fs_no_delete();
--> statement-breakpoint
CREATE TRIGGER pay_runs_no_truncate BEFORE TRUNCATE ON pay_runs
  FOR EACH STATEMENT EXECUTE FUNCTION fs_no_delete();
--> statement-breakpoint
CREATE TRIGGER member_lines_no_delete BEFORE DELETE ON member_lines
  FOR EACH ROW EXECUTE FUNCTION fs_no_delete();
--> statement-breakpoint
CREATE TRIGGER member_lines_no_truncate BEFORE TRUNCATE ON member_lines
  FOR EACH STATEMENT EXECUTE FUNCTION fs_no_delete();
--> statement-breakpoint
CREATE TRIGGER holds_no_delete BEFORE DELETE ON holds
  FOR EACH ROW EXECUTE FUNCTION fs_no_delete();
--> statement-breakpoint
CREATE TRIGGER holds_no_truncate BEFORE TRUNCATE ON holds
  FOR EACH STATEMENT EXECUTE FUNCTION fs_no_delete();
--> statement-breakpoint
CREATE TRIGGER payout_items_no_delete BEFORE DELETE ON payout_items
  FOR EACH ROW EXECUTE FUNCTION fs_no_delete();
--> statement-breakpoint
CREATE TRIGGER payout_items_no_truncate BEFORE TRUNCATE ON payout_items
  FOR EACH STATEMENT EXECUTE FUNCTION fs_no_delete();
--> statement-breakpoint
CREATE TRIGGER approvals_no_delete BEFORE DELETE ON approvals
  FOR EACH ROW EXECUTE FUNCTION fs_no_delete();
--> statement-breakpoint
CREATE TRIGGER approvals_no_truncate BEFORE TRUNCATE ON approvals
  FOR EACH STATEMENT EXECUTE FUNCTION fs_no_delete();
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'fs_app') THEN
    EXECUTE 'REVOKE DELETE, TRUNCATE ON pay_runs, member_lines, holds, payout_items, approvals FROM fs_app';
  END IF;
END
$$;
