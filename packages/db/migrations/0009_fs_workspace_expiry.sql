-- Fair Split: a workspace's expiry only moves later (automated security review, MEDIUM, 0003).
--
-- 0003 froze a workspace's id, kind and created_at, and fs_purge_workspace() (which fs_app may call) purges a
-- judge workspace once its expires_at has passed. But expires_at itself was open: the app role could set a live
-- judge session's expiry to the past, or clear it and set it again, and then purge the session together with its
-- run_events, ledger_entries and agent_sessions.
--
-- Now, for every role, a change to expires_at must leave it
--   * set (never back to NULL once it has a value),
--   * no earlier than it was, and
--   * not already past (now(), the database clock fs_purge_workspace() compares it with).
-- So a workspace lives at least until the expiry it was claimed with, and nothing the app writes brings its purge
-- forward. Claiming a pooled workspace (NULL → now() + 24 h) and extending a session stay open: a later expiry only
-- keeps rows. Inserts are unaffected (a new workspace has no history to lose). A judge's Reset therefore ends the
-- session instead of expiring the workspace; the hourly judgeReset purges it once its expiry has passed.
-- The check comes after the id, kind and created_at checks, so their errors keep their subjects.

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
  IF NEW.expires_at IS DISTINCT FROM OLD.expires_at
     AND (NEW.expires_at IS NULL OR NEW.expires_at < OLD.expires_at OR NEW.expires_at < now()) THEN
    RAISE EXCEPTION 'FROZEN_COLUMN:workspaces.expires_at'
      USING ERRCODE = 'FS409',
            DETAIL = format('Workspace %s expires at %s; an expiry only moves later and never into the past (not to %s).',
                            OLD.id, coalesce(OLD.expires_at::text, 'no set time'), coalesce(NEW.expires_at::text, 'NULL')),
            HINT = 'A judge Reset ends the session; the hourly purge removes the workspace once it has expired.';
  END IF;
  RETURN NEW;
END
$$;
