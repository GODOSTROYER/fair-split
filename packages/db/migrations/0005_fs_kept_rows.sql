-- Fair Split: rows that outlive a Judge workspace (review major, schema/paypal.ts).
--
-- 0004 made paypal_calls, webhook_events and llm_calls reference workspaces ON DELETE SET NULL: they are global
-- memory that merely names a workspace — the limiter's 60 s window and 6-minute 429 circuit (the sandbox blocks the
-- IP for 5 minutes above 50 calls a minute), the webhook event-id dedupe, and the Claude spend meter per budget key
-- and day. A cascade let the hourly purge, or a judge's Reset, reopen the circuit, free slots that were really spent,
-- forget a delivered event or reset judge_read's daily cap. For the same reason the app may not delete them: it
-- inserts and completes these rows, nothing else. (Referential SET NULL runs as the table owner, so the purge is
-- unaffected.)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'fs_app') THEN
    EXECUTE 'REVOKE DELETE, TRUNCATE ON paypal_calls, webhook_events, llm_calls FROM fs_app';
  END IF;
END
$$;
