-- W1 / IC-04: retain the verified delivery without fabricating payloads for historical events.
-- No backfill, default, privilege change or rewrite of the existing evidence.
ALTER TABLE "webhook_events" ADD COLUMN "delivery" jsonb;
