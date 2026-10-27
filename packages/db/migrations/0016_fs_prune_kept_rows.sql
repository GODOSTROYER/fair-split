-- Fair Split: retention for the rows a purge keeps (review minor, 0005).
--
-- 0005 took DELETE on paypal_calls, webhook_events and llm_calls away from fs_app, and the purge keeps them (SET NULL),
-- so nothing ever removed them: the limiter's window and the webhook dedupe index grew without bound. This owner-side
-- function is the one way out, for the cron (fs_app may EXECUTE it, nobody else), and it keeps what each table is for:
--   * paypal_calls: the limiter reads 60 s, the 429 circuit 6 minutes and /ops a day, so rows go only after
--     greatest(calls_older_than, 1 day) — default 30 days (PayPal keeps sender_batch_id unique that long);
--   * webhook_events, resolved (applied, orphan): the event-id dedupe must outlast PayPal's retries (25 over 3 days),
--     resends and catch-up passes, so they go after greatest(events_older_than, 30 days);
--   * webhook_events, rejected: forensic rows, rate-limited on insert, gone after 7 days by default (S3.9 judgeReset
--     step 3), never before a day;
--   * webhook_events, received (not yet processed): never;
--   * llm_calls: never. It is the Claude replay store (a Judge replays the recorded run by cache key) as well as the
--     spend meter, and its growth is bounded by the AI budget.
-- Intervals are measured from the transaction's now(); NULL means the default.

CREATE OR REPLACE FUNCTION fs_prune_kept_rows(
  calls_older_than interval DEFAULT interval '30 days',
  events_older_than interval DEFAULT interval '30 days',
  rejected_older_than interval DEFAULT interval '7 days'
) RETURNS TABLE (pruned_calls bigint, pruned_events bigint, pruned_rejected bigint)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  calls_cutoff timestamptz := now() - greatest(coalesce(calls_older_than, interval '30 days'), interval '1 day');
  events_cutoff timestamptz := now() - greatest(coalesce(events_older_than, interval '30 days'), interval '30 days');
  rejected_cutoff timestamptz := now() - greatest(coalesce(rejected_older_than, interval '7 days'), interval '1 day');
BEGIN
  DELETE FROM paypal_calls c WHERE c.at < calls_cutoff;
  GET DIAGNOSTICS pruned_calls = ROW_COUNT;
  DELETE FROM webhook_events e WHERE e.status IN ('applied', 'orphan') AND e.received_at < events_cutoff;
  GET DIAGNOSTICS pruned_events = ROW_COUNT;
  DELETE FROM webhook_events e WHERE e.status = 'rejected' AND e.received_at < rejected_cutoff;
  GET DIAGNOSTICS pruned_rejected = ROW_COUNT;
  RETURN NEXT;
END
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION fs_prune_kept_rows(interval, interval, interval) FROM PUBLIC;
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'fs_app') THEN
    EXECUTE 'GRANT EXECUTE ON FUNCTION fs_prune_kept_rows(interval, interval, interval) TO fs_app';
  END IF;
END
$$;
