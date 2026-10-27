ALTER TABLE "device_keys" DROP CONSTRAINT "device_keys_key_id_ck";--> statement-breakpoint
ALTER TABLE "device_keys" DROP CONSTRAINT "device_keys_kind_ck";--> statement-breakpoint
ALTER TABLE "device_keys" ADD CONSTRAINT "device_keys_key_id_app_ck" CHECK ("device_keys"."kind" <> 'app' or "device_keys"."key_id" ~ '^fs-(?!(?:ledger|demo)-)[a-z]{1,24}-a[1-9][0-9]{0,3}$');--> statement-breakpoint
ALTER TABLE "device_keys" ADD CONSTRAINT "device_keys_key_id_web_ck" CHECK ("device_keys"."kind" <> 'web' or "device_keys"."key_id" ~ '^fs-(?!(?:ledger|demo)-)[a-z]{1,24}-w[1-9][0-9]{0,3}$');--> statement-breakpoint
ALTER TABLE "device_keys" ADD CONSTRAINT "device_keys_key_id_web_demo_ck" CHECK ("device_keys"."kind" <> 'web_demo' or "device_keys"."key_id" ~ '^fs-(?!(?:ledger|demo)-)[a-z]{1,24}-demo-[a-z0-9]{6}$');--> statement-breakpoint
ALTER TABLE "device_keys" ADD CONSTRAINT "device_keys_kind_ck" CHECK ("device_keys"."kind" in ('app', 'web', 'web_demo'));