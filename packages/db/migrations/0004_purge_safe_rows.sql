ALTER TABLE "task_outbox" DROP CONSTRAINT "task_outbox_attempts_ck";--> statement-breakpoint
ALTER TABLE "llm_calls" DROP CONSTRAINT "llm_calls_workspace_id_workspaces_id_fk";
--> statement-breakpoint
ALTER TABLE "paypal_calls" DROP CONSTRAINT "paypal_calls_workspace_id_workspaces_id_fk";
--> statement-breakpoint
ALTER TABLE "webhook_events" DROP CONSTRAINT "webhook_events_workspace_id_workspaces_id_fk";
--> statement-breakpoint
ALTER TABLE "llm_calls" ALTER COLUMN "workspace_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "task_outbox" ADD COLUMN "dispatches" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "llm_calls" ADD CONSTRAINT "llm_calls_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "paypal_calls" ADD CONSTRAINT "paypal_calls_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_events" ADD CONSTRAINT "webhook_events_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_outbox" ADD CONSTRAINT "task_outbox_attempts_ck" CHECK ("task_outbox"."attempts" >= 0 and "task_outbox"."max_attempts" >= 1 and "task_outbox"."dispatches" >= 0);