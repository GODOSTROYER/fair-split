CREATE TABLE "webhook_transmissions" (
	"transmission_id" text PRIMARY KEY NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "webhook_transmissions_id_ck" CHECK ("webhook_transmissions"."transmission_id" ~ '^[A-Za-z0-9_-]{1,64}$')
);
--> statement-breakpoint
CREATE INDEX "webhook_transmissions_expires_idx" ON "webhook_transmissions" USING btree ("expires_at");