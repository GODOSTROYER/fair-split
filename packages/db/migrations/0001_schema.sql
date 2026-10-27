CREATE SEQUENCE "public"."fs_run_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1;--> statement-breakpoint
CREATE TABLE "auth_account" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp with time zone,
	"refresh_token_expires_at" timestamp with time zone,
	"scope" text,
	"password" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "auth_session" (
	"id" text PRIMARY KEY NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"token" text NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"user_id" text NOT NULL,
	"impersonated_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "auth_session_token_uq" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "auth_user" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"role" text,
	"banned" boolean,
	"ban_reason" text,
	"ban_expires" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "auth_user_email_uq" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "auth_verification" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "coops" (
	"id" uuid PRIMARY KEY DEFAULT fs_uuidv7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"name" text NOT NULL,
	"region" text NOT NULL,
	"commodity" text DEFAULT 'cacao' NOT NULL,
	"provenance" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "coops_ws_id_uq" UNIQUE("workspace_id","id"),
	CONSTRAINT "coops_provenance_ck" CHECK ("coops"."provenance" in ('live', 'replay', 'simulated_rail', 'seeded'))
);
--> statement-breakpoint
CREATE TABLE "lots" (
	"id" uuid PRIMARY KEY DEFAULT fs_uuidv7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"season_id" uuid NOT NULL,
	"lot_code" text NOT NULL,
	"sacks" integer NOT NULL,
	"shipped_g" bigint NOT NULL,
	"grade1_shipped_g" bigint NOT NULL,
	"shipped_on" date,
	"provenance" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "lots_lot_code_uq" UNIQUE("workspace_id","lot_code"),
	CONSTRAINT "lots_ws_id_uq" UNIQUE("workspace_id","id"),
	CONSTRAINT "lots_grams_ck" CHECK ("lots"."grade1_shipped_g" between 0 and "lots"."shipped_g"),
	CONSTRAINT "lots_provenance_ck" CHECK ("lots"."provenance" in ('live', 'replay', 'simulated_rail', 'seeded'))
);
--> statement-breakpoint
CREATE TABLE "members" (
	"id" uuid PRIMARY KEY DEFAULT fs_uuidv7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"coop_id" uuid NOT NULL,
	"member_no" text NOT NULL,
	"display_name" text NOT NULL,
	"honorific" text,
	"lang" text NOT NULL,
	"receiver_ref" text,
	"rail" text GENERATED ALWAYS AS (case when receiver_ref is null then 'OFF' else 'ON' end) STORED NOT NULL,
	"provenance" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "members_member_no_uq" UNIQUE("workspace_id","member_no"),
	CONSTRAINT "members_ws_id_uq" UNIQUE("workspace_id","id"),
	CONSTRAINT "members_lang_ck" CHECK ("members"."lang" in ('ceb', 'fil', 'en')),
	CONSTRAINT "members_provenance_ck" CHECK ("members"."provenance" in ('live', 'replay', 'simulated_rail', 'seeded'))
);
--> statement-breakpoint
CREATE TABLE "plots" (
	"id" uuid PRIMARY KEY DEFAULT fs_uuidv7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"plot_code" text NOT NULL,
	"trees" integer NOT NULL,
	"area_ha" numeric(8, 4),
	"lat" numeric(9, 6),
	"lon" numeric(9, 6),
	"registered_at" timestamp with time zone,
	"provenance" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "plots_plot_code_uq" UNIQUE("workspace_id","plot_code"),
	CONSTRAINT "plots_ws_id_uq" UNIQUE("workspace_id","id"),
	CONSTRAINT "plots_trees_ck" CHECK ("plots"."trees" >= 0),
	CONSTRAINT "plots_provenance_ck" CHECK ("plots"."provenance" in ('live', 'replay', 'simulated_rail', 'seeded'))
);
--> statement-breakpoint
CREATE TABLE "rate_cards" (
	"id" uuid PRIMARY KEY DEFAULT fs_uuidv7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"season_id" uuid NOT NULL,
	"code" text NOT NULL,
	"canonical_jcs" text NOT NULL,
	"sha256" text NOT NULL,
	"ratified_at" timestamp with time zone,
	"provenance" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "rate_cards_season_uq" UNIQUE("workspace_id","season_id"),
	CONSTRAINT "rate_cards_sha256_uq" UNIQUE("workspace_id","sha256"),
	CONSTRAINT "rate_cards_ws_id_uq" UNIQUE("workspace_id","id"),
	CONSTRAINT "rate_cards_sha256_ck" CHECK ("rate_cards"."sha256" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "rate_cards_sha256_matches_ck" CHECK ("rate_cards"."sha256" = encode(sha256(convert_to("rate_cards"."canonical_jcs", 'UTF8')), 'hex')),
	CONSTRAINT "rate_cards_provenance_ck" CHECK ("rate_cards"."provenance" in ('live', 'replay', 'simulated_rail', 'seeded'))
);
--> statement-breakpoint
CREATE TABLE "rate_rules" (
	"id" uuid PRIMARY KEY DEFAULT fs_uuidv7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"rate_card_id" uuid NOT NULL,
	"rule_id" text NOT NULL,
	"kind" text NOT NULL,
	"category" text NOT NULL,
	"basis" text NOT NULL,
	"params" jsonb NOT NULL,
	"source_page" integer,
	"source_bbox" jsonb,
	"source_quote" text NOT NULL,
	"provenance" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "rate_rules_rule_uq" UNIQUE("rate_card_id","rule_id"),
	CONSTRAINT "rate_rules_ws_id_uq" UNIQUE("workspace_id","id"),
	CONSTRAINT "rate_rules_kind_ck" CHECK ("rate_rules"."kind" in ('SHARE', 'DEDUCTION')),
	CONSTRAINT "rate_rules_rule_id_ck" CHECK ("rate_rules"."rule_id" ~ '^R[0-9]+$'),
	CONSTRAINT "rate_rules_provenance_ck" CHECK ("rate_rules"."provenance" in ('live', 'replay', 'simulated_rail', 'seeded'))
);
--> statement-breakpoint
CREATE TABLE "ratifications" (
	"id" uuid PRIMARY KEY DEFAULT fs_uuidv7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"rate_card_id" uuid NOT NULL,
	"approver_id" text NOT NULL,
	"role" text NOT NULL,
	"key_id" text,
	"payload_jcs" text,
	"signature" text,
	"signed_at" timestamp with time zone NOT NULL,
	"provenance" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ratifications_approver_uq" UNIQUE("rate_card_id","approver_id"),
	CONSTRAINT "ratifications_ws_id_uq" UNIQUE("workspace_id","id"),
	CONSTRAINT "ratifications_provenance_ck" CHECK ("ratifications"."provenance" in ('live', 'replay', 'simulated_rail', 'seeded'))
);
--> statement-breakpoint
CREATE TABLE "seasons" (
	"id" uuid PRIMARY KEY DEFAULT fs_uuidv7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"coop_id" uuid NOT NULL,
	"code" text NOT NULL,
	"label" text NOT NULL,
	"opens_on" date NOT NULL,
	"closes_on" date NOT NULL,
	"tz" text DEFAULT 'Asia/Manila' NOT NULL,
	"currency" char(3) NOT NULL,
	"cosign_batch_cents" bigint NOT NULL,
	"cosign_line_cents" bigint NOT NULL,
	"mass_balance_tol_bp" integer NOT NULL,
	"kg_per_tree_max_g" integer NOT NULL,
	"auto_accept_bp" integer NOT NULL,
	"provenance" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "seasons_code_uq" UNIQUE("workspace_id","code"),
	CONSTRAINT "seasons_ws_id_uq" UNIQUE("workspace_id","id"),
	CONSTRAINT "seasons_code_ck" CHECK ("seasons"."code" ~ '^[0-9]{4}[A-Z]$'),
	CONSTRAINT "seasons_dates_ck" CHECK ("seasons"."opens_on" <= "seasons"."closes_on"),
	CONSTRAINT "seasons_currency_ck" CHECK ("seasons"."currency" ~ '^[A-Z]{3}$'),
	CONSTRAINT "seasons_auto_accept_bp_ck" CHECK ("seasons"."auto_accept_bp" between 0 and 10000),
	CONSTRAINT "seasons_provenance_ck" CHECK ("seasons"."provenance" in ('live', 'replay', 'simulated_rail', 'seeded'))
);
--> statement-breakpoint
CREATE TABLE "deduction_marks" (
	"id" uuid PRIMARY KEY DEFAULT fs_uuidv7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"slip_row_id" uuid NOT NULL,
	"text_verbatim" text NOT NULL,
	"rule_id" text,
	"written_cents" bigint,
	"currency" char(3) NOT NULL,
	"provenance" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "deduction_marks_ws_id_uq" UNIQUE("workspace_id","id"),
	CONSTRAINT "deduction_marks_rule_id_ck" CHECK ("deduction_marks"."rule_id" is null or "deduction_marks"."rule_id" ~ '^(R[0-9]+|NO_MATCH)$'),
	CONSTRAINT "deduction_marks_currency_ck" CHECK ("deduction_marks"."currency" ~ '^[A-Z]{3}$'),
	CONSTRAINT "deduction_marks_provenance_ck" CHECK ("deduction_marks"."provenance" in ('live', 'replay', 'simulated_rail', 'seeded'))
);
--> statement-breakpoint
CREATE TABLE "documents" (
	"id" uuid PRIMARY KEY DEFAULT fs_uuidv7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"season_id" uuid,
	"kind" text NOT NULL,
	"sha256" text NOT NULL,
	"phash" text,
	"storage" text NOT NULL,
	"path" text,
	"bytes" "bytea",
	"byte_size" integer NOT NULL,
	"mime" text NOT NULL,
	"width" integer,
	"height" integer,
	"capture_id" uuid,
	"exact_duplicate_of" uuid,
	"copy_color" text,
	"template_serial" text,
	"photo_code" text,
	"captured_at" timestamp with time zone,
	"captured_by" text,
	"provenance" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "documents_capture_uq" UNIQUE("workspace_id","capture_id"),
	CONSTRAINT "documents_ws_id_uq" UNIQUE("workspace_id","id"),
	CONSTRAINT "documents_kind_ck" CHECK ("documents"."kind" in ('slip_photo', 'slip_page', 'logbook_page', 'rate_card_pdf', 'rate_card_page')),
	CONSTRAINT "documents_storage_ck" CHECK ("documents"."storage" in ('static', 'db')),
	CONSTRAINT "documents_sha256_ck" CHECK ("documents"."sha256" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "documents_phash_ck" CHECK ("documents"."phash" is null or "documents"."phash" ~ '^[0-9a-f]{16}$'),
	CONSTRAINT "documents_storage_payload_ck" CHECK (("documents"."storage" = 'static' and "documents"."path" is not null) or ("documents"."storage" = 'db' and "documents"."bytes" is not null)),
	CONSTRAINT "documents_byte_size_ck" CHECK ("documents"."byte_size" >= 0),
	CONSTRAINT "documents_provenance_ck" CHECK ("documents"."provenance" in ('live', 'replay', 'simulated_rail', 'seeded'))
);
--> statement-breakpoint
CREATE TABLE "extraction_reads" (
	"id" uuid PRIMARY KEY DEFAULT fs_uuidv7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"variant" text NOT NULL,
	"llm_call_id" uuid,
	"model" text NOT NULL,
	"model_served" text,
	"effort" text NOT NULL,
	"prompt_v" text NOT NULL,
	"schema_v" text NOT NULL,
	"cache_key" text NOT NULL,
	"stop_reason" text,
	"raw_content" jsonb,
	"cost_micros" bigint NOT NULL,
	"provenance" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "extraction_reads_ws_id_uq" UNIQUE("workspace_id","id"),
	CONSTRAINT "extraction_reads_variant_ck" CHECK ("extraction_reads"."variant" in ('A', 'B', 'ZOOM')),
	CONSTRAINT "extraction_reads_cache_key_ck" CHECK ("extraction_reads"."cache_key" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "extraction_reads_provenance_ck" CHECK ("extraction_reads"."provenance" in ('live', 'replay', 'simulated_rail', 'seeded'))
);
--> statement-breakpoint
CREATE TABLE "slip_anomalies" (
	"id" uuid PRIMARY KEY DEFAULT fs_uuidv7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"slip_row_id" uuid,
	"kind" text NOT NULL,
	"detail" jsonb,
	"quarantined_text" text,
	"provenance" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "slip_anomalies_ws_id_uq" UNIQUE("workspace_id","id"),
	CONSTRAINT "slip_anomalies_provenance_ck" CHECK ("slip_anomalies"."provenance" in ('live', 'replay', 'simulated_rail', 'seeded'))
);
--> statement-breakpoint
CREATE TABLE "slip_fields" (
	"id" uuid PRIMARY KEY DEFAULT fs_uuidv7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"slip_row_id" uuid NOT NULL,
	"field" text NOT NULL,
	"read_a" jsonb,
	"read_b" jsonb,
	"zoom" jsonb,
	"legibility" text,
	"agreement" double precision,
	"final_value" text,
	"decided_by" text,
	"decided_by_actor" text,
	"decided_at" timestamp with time zone,
	"provenance" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "slip_fields_field_uq" UNIQUE("slip_row_id","field"),
	CONSTRAINT "slip_fields_ws_id_uq" UNIQUE("workspace_id","id"),
	CONSTRAINT "slip_fields_decided_by_ck" CHECK ("slip_fields"."decided_by" in ('agreement', 'zoom', 'person')),
	CONSTRAINT "slip_fields_agreement_ck" CHECK ("slip_fields"."agreement" is null or "slip_fields"."agreement" between 0 and 1),
	CONSTRAINT "slip_fields_provenance_ck" CHECK ("slip_fields"."provenance" in ('live', 'replay', 'simulated_rail', 'seeded'))
);
--> statement-breakpoint
CREATE TABLE "slip_rows" (
	"id" uuid PRIMARY KEY DEFAULT fs_uuidv7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"season_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"serial" text NOT NULL,
	"row_no" integer NOT NULL,
	"member_id" uuid,
	"slip_date" date,
	"gross_g" bigint,
	"tare_g" bigint,
	"net_g" bigint,
	"grade" text,
	"min_confidence" double precision,
	"state" text NOT NULL,
	"crop_rect" jsonb,
	"copy_color" text,
	"version" integer DEFAULT 0 NOT NULL,
	"provenance" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "slip_rows_document_row_uq" UNIQUE("document_id","serial","row_no"),
	CONSTRAINT "slip_rows_ws_id_uq" UNIQUE("workspace_id","id"),
	CONSTRAINT "slip_rows_state_ck" CHECK ("slip_rows"."state" in ('AUTO_ACCEPTED', 'NEEDS_HUMAN', 'CONFIRMED', 'REJECTED')),
	CONSTRAINT "slip_rows_date_ck" CHECK ("slip_rows"."slip_date" is not null or "slip_rows"."state" in ('NEEDS_HUMAN', 'REJECTED')),
	CONSTRAINT "slip_rows_confidence_ck" CHECK ("slip_rows"."min_confidence" is null or "slip_rows"."min_confidence" between 0 and 1),
	CONSTRAINT "slip_rows_grams_ck" CHECK (coalesce("slip_rows"."net_g", 0) >= 0 and coalesce("slip_rows"."gross_g", 0) >= 0 and coalesce("slip_rows"."tare_g", 0) >= 0),
	CONSTRAINT "slip_rows_row_no_ck" CHECK ("slip_rows"."row_no" >= 1),
	CONSTRAINT "slip_rows_provenance_ck" CHECK ("slip_rows"."provenance" in ('live', 'replay', 'simulated_rail', 'seeded'))
);
--> statement-breakpoint
CREATE TABLE "device_keys" (
	"id" uuid PRIMARY KEY DEFAULT fs_uuidv7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"key_id" text NOT NULL,
	"persona" text NOT NULL,
	"user_id" text,
	"public_key" text NOT NULL,
	"kind" text NOT NULL,
	"platform" text,
	"biometric_class" text,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "device_keys_key_id_uq" UNIQUE("workspace_id","key_id"),
	CONSTRAINT "device_keys_ws_id_uq" UNIQUE("workspace_id","id"),
	CONSTRAINT "device_keys_kind_ck" CHECK ("device_keys"."kind" in ('app', 'web_demo')),
	CONSTRAINT "device_keys_key_id_ck" CHECK ("device_keys"."key_id" ~ '^fs-[a-z0-9]+-[aw][0-9]+$')
);
--> statement-breakpoint
CREATE TABLE "frame_tokens" (
	"id" uuid PRIMARY KEY DEFAULT fs_uuidv7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"token_sha256" text NOT NULL,
	"session_id" uuid,
	"persona" text NOT NULL,
	"role" text NOT NULL,
	"member_id" uuid,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "frame_tokens_token_sha256_uq" UNIQUE("token_sha256"),
	CONSTRAINT "frame_tokens_ws_id_uq" UNIQUE("workspace_id","id"),
	CONSTRAINT "frame_tokens_role_ck" CHECK ("frame_tokens"."role" in ('brand', 'treasurer', 'board', 'clerk', 'member', 'judge', 'operator')),
	CONSTRAINT "frame_tokens_token_sha256_ck" CHECK ("frame_tokens"."token_sha256" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
CREATE TABLE "memberships" (
	"id" uuid PRIMARY KEY DEFAULT fs_uuidv7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"user_id" text,
	"persona" text,
	"role" text NOT NULL,
	"member_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "memberships_user_role_uq" UNIQUE("workspace_id","user_id","role"),
	CONSTRAINT "memberships_persona_role_uq" UNIQUE("workspace_id","persona","role"),
	CONSTRAINT "memberships_ws_id_uq" UNIQUE("workspace_id","id"),
	CONSTRAINT "memberships_role_ck" CHECK ("memberships"."role" in ('brand', 'treasurer', 'board', 'clerk', 'member', 'judge', 'operator')),
	CONSTRAINT "memberships_principal_ck" CHECK ("memberships"."user_id" is not null or "memberships"."persona" is not null)
);
--> statement-breakpoint
CREATE TABLE "pairing_tokens" (
	"id" uuid PRIMARY KEY DEFAULT fs_uuidv7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"token_sha256" text NOT NULL,
	"code6_sha256" text NOT NULL,
	"persona" text NOT NULL,
	"role" text NOT NULL,
	"member_id" uuid,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pairing_tokens_token_sha256_uq" UNIQUE("token_sha256"),
	CONSTRAINT "pairing_tokens_ws_id_uq" UNIQUE("workspace_id","id"),
	CONSTRAINT "pairing_tokens_role_ck" CHECK ("pairing_tokens"."role" in ('brand', 'treasurer', 'board', 'clerk', 'member', 'judge', 'operator')),
	CONSTRAINT "pairing_tokens_token_sha256_ck" CHECK ("pairing_tokens"."token_sha256" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "pairing_tokens_code6_sha256_ck" CHECK ("pairing_tokens"."code6_sha256" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
CREATE TABLE "push_tokens" (
	"id" uuid PRIMARY KEY DEFAULT fs_uuidv7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"persona" text NOT NULL,
	"device_key_id" uuid,
	"expo_token" text NOT NULL,
	"platform" text NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "push_tokens_token_uq" UNIQUE("workspace_id","expo_token"),
	CONSTRAINT "push_tokens_ws_id_uq" UNIQUE("workspace_id","id")
);
--> statement-breakpoint
CREATE TABLE "agent_sessions" (
	"id" uuid PRIMARY KEY DEFAULT fs_uuidv7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"seq" integer NOT NULL,
	"run_id" uuid,
	"role" text NOT NULL,
	"raw_message" jsonb NOT NULL,
	"model_served" text,
	"provenance" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agent_sessions_seq_uq" UNIQUE("session_id","seq"),
	CONSTRAINT "agent_sessions_ws_id_uq" UNIQUE("workspace_id","id"),
	CONSTRAINT "agent_sessions_seq_ck" CHECK ("agent_sessions"."seq" >= 0),
	CONSTRAINT "agent_sessions_provenance_ck" CHECK ("agent_sessions"."provenance" in ('live', 'replay', 'simulated_rail', 'seeded'))
);
--> statement-breakpoint
CREATE TABLE "idempotency_keys" (
	"workspace_id" uuid NOT NULL,
	"key" text NOT NULL,
	"method" text NOT NULL,
	"route" text NOT NULL,
	"request_sha256" text NOT NULL,
	"response_status" integer,
	"response_body" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone DEFAULT now() + interval '24 hours' NOT NULL,
	CONSTRAINT "idempotency_keys_pk" PRIMARY KEY("workspace_id","key"),
	CONSTRAINT "idempotency_keys_request_sha256_ck" CHECK ("idempotency_keys"."request_sha256" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
CREATE TABLE "ledger_entries" (
	"id" uuid PRIMARY KEY DEFAULT fs_uuidv7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"seq" bigint NOT NULL,
	"kind" text NOT NULL,
	"actor_kind" text NOT NULL,
	"actor_id" text NOT NULL,
	"impersonated_by" text,
	"payload" jsonb NOT NULL,
	"at" timestamp with time zone NOT NULL,
	"prev_hash" text NOT NULL,
	"entry_hash" text NOT NULL,
	"run_id" uuid,
	CONSTRAINT "ledger_entries_seq_uq" UNIQUE("workspace_id","seq"),
	CONSTRAINT "ledger_entries_hash_uq" UNIQUE("workspace_id","entry_hash"),
	CONSTRAINT "ledger_entries_actor_kind_ck" CHECK ("ledger_entries"."actor_kind" in ('human', 'agent', 'engine', 'paypal', 'system')),
	CONSTRAINT "ledger_entries_seq_ck" CHECK ("ledger_entries"."seq" >= 1),
	CONSTRAINT "ledger_entries_prev_hash_ck" CHECK ("ledger_entries"."prev_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "ledger_entries_entry_hash_ck" CHECK ("ledger_entries"."entry_hash" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
CREATE TABLE "ledger_heads" (
	"workspace_id" uuid PRIMARY KEY NOT NULL,
	"seq" bigint DEFAULT 0 NOT NULL,
	"entry_hash" text DEFAULT repeat('0', 64) NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ledger_heads_seq_ck" CHECK ("ledger_heads"."seq" >= 0),
	CONSTRAINT "ledger_heads_entry_hash_ck" CHECK ("ledger_heads"."entry_hash" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
CREATE TABLE "run_events" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "run_events_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"workspace_id" uuid NOT NULL,
	"run_id" uuid,
	"line_id" uuid,
	"type" text NOT NULL,
	"at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	"actor_kind" text NOT NULL,
	"actor_id" text NOT NULL,
	"impersonated_by" text,
	"provenance" text NOT NULL,
	"payload" jsonb NOT NULL,
	CONSTRAINT "run_events_actor_kind_ck" CHECK ("run_events"."actor_kind" in ('human', 'agent', 'engine', 'paypal', 'system')),
	CONSTRAINT "run_events_provenance_ck" CHECK ("run_events"."provenance" in ('live', 'replay', 'simulated_rail', 'seeded')),
	CONSTRAINT "run_events_payload_size_ck" CHECK (octet_length("run_events"."payload"::text) <= 65536)
);
--> statement-breakpoint
CREATE TABLE "system_flags" (
	"workspace_id" uuid NOT NULL,
	"flag" text NOT NULL,
	"on" boolean DEFAULT false NOT NULL,
	"set_by" text,
	"reason" text,
	"set_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "system_flags_pk" PRIMARY KEY("workspace_id","flag"),
	CONSTRAINT "system_flags_flag_ck" CHECK ("system_flags"."flag" in ('kill_payouts', 'kill_paypal_live', 'kill_ai_live'))
);
--> statement-breakpoint
CREATE TABLE "task_outbox" (
	"id" uuid PRIMARY KEY DEFAULT fs_uuidv7() NOT NULL,
	"workspace_id" uuid,
	"name" text NOT NULL,
	"args" jsonb NOT NULL,
	"dedupe_key" text NOT NULL,
	"state" text DEFAULT 'queued' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 8 NOT NULL,
	"run_after" timestamp with time zone DEFAULT now() NOT NULL,
	"executor" text,
	"claimed_by" text,
	"workflow_run_id" text,
	"dispatched_at" timestamp with time zone,
	"started_at" timestamp with time zone,
	"heartbeat_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "task_outbox_dedupe_key_uq" UNIQUE("dedupe_key"),
	CONSTRAINT "task_outbox_state_ck" CHECK ("task_outbox"."state" in ('queued', 'dispatched', 'running', 'done', 'dead')),
	CONSTRAINT "task_outbox_executor_ck" CHECK ("task_outbox"."executor" in ('inline', 'workflow', 'worker')),
	CONSTRAINT "task_outbox_args_size_ck" CHECK (octet_length("task_outbox"."args"::text) <= 8192),
	CONSTRAINT "task_outbox_attempts_ck" CHECK ("task_outbox"."attempts" >= 0 and "task_outbox"."max_attempts" >= 1)
);
--> statement-breakpoint
CREATE TABLE "llm_calls" (
	"id" uuid PRIMARY KEY DEFAULT fs_uuidv7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"cache_key" text NOT NULL,
	"purpose" text NOT NULL,
	"budget_key" text NOT NULL,
	"model" text NOT NULL,
	"model_served" text,
	"effort" text NOT NULL,
	"prompt_v" text NOT NULL,
	"schema_v" text,
	"usage" jsonb,
	"cost_micros" bigint NOT NULL,
	"stop_reason" text,
	"raw_content" jsonb,
	"replay_timeline" jsonb,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"provenance" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "llm_calls_cache_key_uq" UNIQUE("cache_key"),
	CONSTRAINT "llm_calls_cache_key_ck" CHECK ("llm_calls"."cache_key" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "llm_calls_cost_ck" CHECK ("llm_calls"."cost_micros" >= 0),
	CONSTRAINT "llm_calls_provenance_ck" CHECK ("llm_calls"."provenance" in ('live', 'replay', 'simulated_rail', 'seeded'))
);
--> statement-breakpoint
CREATE TABLE "payout_batches" (
	"id" uuid PRIMARY KEY DEFAULT fs_uuidv7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"run_id" uuid NOT NULL,
	"sender_batch_id" text NOT NULL,
	"request_id" text NOT NULL,
	"paypal_batch_id" text,
	"batch_sha256" text NOT NULL,
	"kind" text NOT NULL,
	"status" text DEFAULT 'SUBMITTED' NOT NULL,
	"item_count" integer NOT NULL,
	"total_cents" bigint NOT NULL,
	"currency" char(3) NOT NULL,
	"adopted" boolean DEFAULT false NOT NULL,
	"submitted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 0 NOT NULL,
	"provenance" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payout_batches_sender_batch_id_uq" UNIQUE("sender_batch_id"),
	CONSTRAINT "payout_batches_paypal_batch_id_uq" UNIQUE("paypal_batch_id"),
	CONSTRAINT "payout_batches_ws_id_uq" UNIQUE("workspace_id","id"),
	CONSTRAINT "payout_batches_kind_ck" CHECK ("payout_batches"."kind" in ('primary', 'reroute')),
	CONSTRAINT "payout_batches_status_ck" CHECK ("payout_batches"."status" in ('SUBMITTED', 'PENDING', 'PROCESSING', 'SUCCESS', 'DENIED', 'CANCELED')),
	CONSTRAINT "payout_batches_sender_batch_id_ck" CHECK (length("payout_batches"."sender_batch_id") between 1 and 256),
	CONSTRAINT "payout_batches_items_ck" CHECK ("payout_batches"."item_count" between 1 and 15000 and "payout_batches"."total_cents" > 0),
	CONSTRAINT "payout_batches_request_id_ck" CHECK ("payout_batches"."request_id" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "payout_batches_batch_sha256_ck" CHECK ("payout_batches"."batch_sha256" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "payout_batches_currency_ck" CHECK ("payout_batches"."currency" ~ '^[A-Z]{3}$'),
	CONSTRAINT "payout_batches_provenance_ck" CHECK ("payout_batches"."provenance" in ('live', 'replay', 'simulated_rail', 'seeded'))
);
--> statement-breakpoint
CREATE TABLE "payout_items" (
	"id" uuid PRIMARY KEY DEFAULT fs_uuidv7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"batch_id" uuid NOT NULL,
	"line_id" uuid NOT NULL,
	"sender_item_id" text NOT NULL,
	"payout_item_id" text,
	"receiver" text NOT NULL,
	"amount_cents" bigint NOT NULL,
	"currency" char(3) NOT NULL,
	"status" text DEFAULT 'SUBMITTED' NOT NULL,
	"status_rank" integer DEFAULT 0 NOT NULL,
	"transaction_status" text,
	"fee_cents" bigint,
	"fee_currency" char(3),
	"errors" jsonb,
	"cancel_requested_at" timestamp with time zone,
	"cancel_intent" text,
	"supersedes_item_id" uuid,
	"version" integer DEFAULT 0 NOT NULL,
	"provenance" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payout_items_sender_item_id_uq" UNIQUE("sender_item_id"),
	CONSTRAINT "payout_items_payout_item_id_uq" UNIQUE("payout_item_id"),
	CONSTRAINT "payout_items_ws_id_uq" UNIQUE("workspace_id","id"),
	CONSTRAINT "payout_items_status_ck" CHECK ("payout_items"."status" in ('SUBMITTED', 'PENDING', 'ONHOLD', 'UNCLAIMED', 'RETURNED', 'FAILED', 'BLOCKED', 'SUCCESS', 'REFUNDED', 'REVERSED')),
	CONSTRAINT "payout_items_status_rank_ck" CHECK ("payout_items"."status_rank" = case "payout_items"."status" when 'SUBMITTED' then 0 when 'PENDING' then 10 when 'ONHOLD' then 20 when 'UNCLAIMED' then 30 when 'RETURNED' then 40 when 'FAILED' then 50 when 'BLOCKED' then 50 when 'SUCCESS' then 60 when 'REFUNDED' then 70 when 'REVERSED' then 70 end),
	CONSTRAINT "payout_items_cancel_intent_ck" CHECK ("payout_items"."cancel_intent" in ('cash', 'reroute')),
	CONSTRAINT "payout_items_sender_item_id_ck" CHECK (length("payout_items"."sender_item_id") between 1 and 63),
	CONSTRAINT "payout_items_receiver_ck" CHECK (length("payout_items"."receiver") between 3 and 127),
	CONSTRAINT "payout_items_amount_ck" CHECK ("payout_items"."amount_cents" > 0),
	CONSTRAINT "payout_items_currency_ck" CHECK ("payout_items"."currency" ~ '^[A-Z]{3}$'),
	CONSTRAINT "payout_items_fee_currency_ck" CHECK ("payout_items"."fee_currency" is null or "payout_items"."fee_currency" ~ '^[A-Z]{3}$'),
	CONSTRAINT "payout_items_provenance_ck" CHECK ("payout_items"."provenance" in ('live', 'replay', 'simulated_rail', 'seeded'))
);
--> statement-breakpoint
CREATE TABLE "paypal_calls" (
	"id" uuid PRIMARY KEY DEFAULT fs_uuidv7() NOT NULL,
	"workspace_id" uuid,
	"at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	"purpose" text NOT NULL,
	"priority" text NOT NULL,
	"method" text,
	"path" text,
	"status" integer,
	"debug_id" text,
	"request_id" text,
	"ms" integer,
	"error" text,
	"responded_at" timestamp with time zone,
	CONSTRAINT "paypal_calls_priority_ck" CHECK ("paypal_calls"."priority" in ('live', 'background'))
);
--> statement-breakpoint
CREATE TABLE "reconciliation_reports" (
	"id" uuid PRIMARY KEY DEFAULT fs_uuidv7() NOT NULL,
	"workspace_id" uuid,
	"kind" text NOT NULL,
	"window_start" timestamp with time zone,
	"window_end" timestamp with time zone,
	"summary" jsonb NOT NULL,
	"lagging" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reconciliation_reports_kind_ck" CHECK ("reconciliation_reports"."kind" in ('hot', 'sweep', 'nightly', 'catchup', 'health', 'balance'))
);
--> statement-breakpoint
CREATE TABLE "webhook_events" (
	"id" uuid PRIMARY KEY DEFAULT fs_uuidv7() NOT NULL,
	"workspace_id" uuid,
	"paypal_event_id" text NOT NULL,
	"event_type" text NOT NULL,
	"resource_type" text,
	"resource_key" text,
	"verified" text,
	"raw" text NOT NULL,
	"status" text NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"applied_at" timestamp with time zone,
	"error" text,
	"provenance" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "webhook_events_paypal_event_id_uq" UNIQUE("paypal_event_id"),
	CONSTRAINT "webhook_events_verified_ck" CHECK ("webhook_events"."verified" in ('self', 'postback', 'dev_mock', 'fetched')),
	CONSTRAINT "webhook_events_status_ck" CHECK ("webhook_events"."status" in ('received', 'applied', 'orphan', 'rejected')),
	CONSTRAINT "webhook_events_verified_status_ck" CHECK (("webhook_events"."status" = 'rejected') = ("webhook_events"."verified" is null)),
	CONSTRAINT "webhook_events_provenance_ck" CHECK ("webhook_events"."provenance" in ('live', 'replay', 'simulated_rail', 'seeded'))
);
--> statement-breakpoint
CREATE TABLE "approvals" (
	"id" uuid PRIMARY KEY DEFAULT fs_uuidv7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"run_id" uuid NOT NULL,
	"role" text NOT NULL,
	"decision" text NOT NULL,
	"approver_id" text NOT NULL,
	"key_id" text,
	"payload_jcs" text,
	"signature" text,
	"batch_sha256" text,
	"nonce" text,
	"exp" timestamp with time zone,
	"reason" text,
	"voided_at" timestamp with time zone,
	"void_reason" text,
	"provenance" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "approvals_nonce_uq" UNIQUE("nonce"),
	CONSTRAINT "approvals_ws_id_uq" UNIQUE("workspace_id","id"),
	CONSTRAINT "approvals_role_ck" CHECK ("approvals"."role" in ('treasurer', 'board')),
	CONSTRAINT "approvals_decision_ck" CHECK ("approvals"."decision" in ('SIGNED', 'DECLINED')),
	CONSTRAINT "approvals_signed_fields_ck" CHECK ("approvals"."decision" <> 'SIGNED' or ("approvals"."key_id" is not null and "approvals"."payload_jcs" is not null and "approvals"."signature" is not null and "approvals"."batch_sha256" is not null and "approvals"."nonce" is not null and "approvals"."exp" is not null)),
	CONSTRAINT "approvals_batch_sha256_ck" CHECK ("approvals"."batch_sha256" is null or "approvals"."batch_sha256" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "approvals_provenance_ck" CHECK ("approvals"."provenance" in ('live', 'replay', 'simulated_rail', 'seeded'))
);
--> statement-breakpoint
CREATE TABLE "cash_receipts" (
	"id" uuid PRIMARY KEY DEFAULT fs_uuidv7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"line_id" uuid NOT NULL,
	"amount_cents" bigint NOT NULL,
	"currency" char(3) NOT NULL,
	"paid_at" timestamp with time zone NOT NULL,
	"attested_by" text NOT NULL,
	"attestation" jsonb,
	"provenance" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cash_receipts_line_uq" UNIQUE("line_id"),
	CONSTRAINT "cash_receipts_ws_id_uq" UNIQUE("workspace_id","id"),
	CONSTRAINT "cash_receipts_amount_ck" CHECK ("cash_receipts"."amount_cents" >= 0),
	CONSTRAINT "cash_receipts_currency_ck" CHECK ("cash_receipts"."currency" ~ '^[A-Z]{3}$'),
	CONSTRAINT "cash_receipts_provenance_ck" CHECK ("cash_receipts"."provenance" in ('live', 'replay', 'simulated_rail', 'seeded'))
);
--> statement-breakpoint
CREATE TABLE "holds" (
	"id" uuid PRIMARY KEY DEFAULT fs_uuidv7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"run_id" uuid NOT NULL,
	"line_id" uuid,
	"code" text,
	"kind" text NOT NULL,
	"gate" text NOT NULL,
	"state" text DEFAULT 'OPEN' NOT NULL,
	"version" integer DEFAULT 0 NOT NULL,
	"engine_params" jsonb,
	"claude_line" text,
	"evidence" jsonb,
	"raised_by" text NOT NULL,
	"resolved_by" text,
	"resolution" jsonb,
	"resolved_at" timestamp with time zone,
	"provenance" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "holds_ws_id_uq" UNIQUE("workspace_id","id"),
	CONSTRAINT "holds_kind_ck" CHECK ("holds"."kind" in ('DUPLICATE_SLIP', 'IMPLAUSIBLE_YIELD', 'NO_RULE', 'RATE_MISMATCH', 'SUSPECTED_INJECTION', 'LOW_CONFIDENCE', 'MASS_BALANCE')),
	CONSTRAINT "holds_gate_ck" CHECK ("holds"."gate" in ('BLOCKS_APPROVAL', 'RESERVES_LINE')),
	CONSTRAINT "holds_state_ck" CHECK ("holds"."state" in ('OPEN', 'ASKED_CHAIR', 'RESOLVED', 'EXCLUDED')),
	CONSTRAINT "holds_claude_line_no_digits_ck" CHECK ("holds"."claude_line" is null or "holds"."claude_line" !~ '[0-9]'),
	CONSTRAINT "holds_mass_balance_season_ck" CHECK ("holds"."kind" <> 'MASS_BALANCE' or "holds"."line_id" is null),
	CONSTRAINT "holds_provenance_ck" CHECK ("holds"."provenance" in ('live', 'replay', 'simulated_rail', 'seeded'))
);
--> statement-breakpoint
CREATE TABLE "invoices" (
	"id" uuid PRIMARY KEY DEFAULT fs_uuidv7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"run_id" uuid NOT NULL,
	"paypal_invoice_id" text,
	"invoice_number" text NOT NULL,
	"status" text DEFAULT 'NEW' NOT NULL,
	"amount_cents" bigint NOT NULL,
	"due_cents" bigint,
	"currency" char(3) NOT NULL,
	"payer_view_url" text,
	"auto_cancel_on" date,
	"created_at_paypal" timestamp with time zone,
	"sent_at" timestamp with time zone,
	"rule_created_at" timestamp with time zone,
	"payment_recorded_at" timestamp with time zone,
	"funded_at" timestamp with time zone,
	"version" integer DEFAULT 0 NOT NULL,
	"provenance" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invoices_paypal_invoice_id_uq" UNIQUE("paypal_invoice_id"),
	CONSTRAINT "invoices_invoice_number_uq" UNIQUE("invoice_number"),
	CONSTRAINT "invoices_run_uq" UNIQUE("run_id"),
	CONSTRAINT "invoices_ws_id_uq" UNIQUE("workspace_id","id"),
	CONSTRAINT "invoices_status_ck" CHECK ("invoices"."status" in ('NEW', 'DRAFT', 'SENT', 'SCHEDULED', 'UNPAID', 'PAYMENT_PENDING', 'PARTIALLY_PAID', 'PAID', 'MARKED_AS_PAID', 'CANCELLED', 'REFUNDED', 'PARTIALLY_REFUNDED', 'MARKED_AS_REFUNDED')),
	CONSTRAINT "invoices_number_ck" CHECK ("invoices"."invoice_number" ~ '^FS-' and length("invoices"."invoice_number") <= 25),
	CONSTRAINT "invoices_amount_ck" CHECK ("invoices"."amount_cents" > 0 and ("invoices"."due_cents" is null or "invoices"."due_cents" >= 0)),
	CONSTRAINT "invoices_currency_ck" CHECK ("invoices"."currency" ~ '^[A-Z]{3}$'),
	CONSTRAINT "invoices_provenance_ck" CHECK ("invoices"."provenance" in ('live', 'replay', 'simulated_rail', 'seeded'))
);
--> statement-breakpoint
CREATE TABLE "member_lines" (
	"id" uuid PRIMARY KEY DEFAULT fs_uuidv7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"run_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"state" text DEFAULT 'COMPUTED' NOT NULL,
	"version" integer DEFAULT 0 NOT NULL,
	"rail" text NOT NULL,
	"currency" char(3) NOT NULL,
	"verified_g" bigint NOT NULL,
	"grade1_g" bigint NOT NULL,
	"premium_cents" bigint NOT NULL,
	"bonus_cents" bigint NOT NULL,
	"deductions_cents" bigint NOT NULL,
	"credits_cents" bigint NOT NULL,
	"net_cents" bigint NOT NULL,
	"deductions" jsonb NOT NULL,
	"line_sha256" text,
	"trace" jsonb,
	"provenance" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "member_lines_member_uq" UNIQUE("run_id","member_id"),
	CONSTRAINT "member_lines_ws_id_uq" UNIQUE("workspace_id","id"),
	CONSTRAINT "member_lines_state_ck" CHECK ("member_lines"."state" in ('COMPUTED', 'READY', 'HELD', 'EXCLUDED', 'OFF_RAIL_DUE', 'OFF_RAIL_PAID', 'LOCKED', 'SUBMITTED', 'PAYPAL_PENDING', 'PAID', 'UNCLAIMED', 'PAYPAL_HELD', 'NEEDS_ACTION', 'REVERSED', 'RETURNED', 'REROUTED')),
	CONSTRAINT "member_lines_rail_ck" CHECK ("member_lines"."rail" in ('ON', 'OFF')),
	CONSTRAINT "member_lines_currency_ck" CHECK ("member_lines"."currency" ~ '^[A-Z]{3}$'),
	CONSTRAINT "member_lines_net_ck" CHECK ("member_lines"."net_cents" = "member_lines"."premium_cents" + "member_lines"."bonus_cents" - "member_lines"."deductions_cents" + "member_lines"."credits_cents"),
	CONSTRAINT "member_lines_nonneg_ck" CHECK ("member_lines"."premium_cents" >= 0 and "member_lines"."bonus_cents" >= 0 and "member_lines"."deductions_cents" >= 0 and "member_lines"."credits_cents" >= 0 and "member_lines"."verified_g" >= 0 and "member_lines"."grade1_g" between 0 and "member_lines"."verified_g"),
	CONSTRAINT "member_lines_line_sha256_ck" CHECK ("member_lines"."line_sha256" is null or "member_lines"."line_sha256" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "member_lines_provenance_ck" CHECK ("member_lines"."provenance" in ('live', 'replay', 'simulated_rail', 'seeded'))
);
--> statement-breakpoint
CREATE TABLE "pay_runs" (
	"id" uuid PRIMARY KEY DEFAULT fs_uuidv7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"season_id" uuid NOT NULL,
	"lot_id" uuid,
	"rate_card_id" uuid NOT NULL,
	"season_code" text NOT NULL,
	"run_seq" bigint DEFAULT nextval('fs_run_seq') NOT NULL,
	"run_slug" text GENERATED ALWAYS AS (season_code || '-r' || run_seq::text) STORED NOT NULL,
	"state" text DEFAULT 'DRAFT' NOT NULL,
	"version" integer DEFAULT 0 NOT NULL,
	"currency" char(3) NOT NULL,
	"distribution_cents" bigint,
	"fee_reserve_cents" bigint,
	"audit_fee_cents" bigint,
	"fx_num" bigint,
	"fx_den" bigint,
	"fx_source" text,
	"quote_sha256" text,
	"rate_card_sha256" text NOT NULL,
	"batch_sha256" text,
	"sender_batch_id" text,
	"halted_reason" text,
	"provenance" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pay_runs_sender_batch_id_uq" UNIQUE("sender_batch_id"),
	CONSTRAINT "pay_runs_run_seq_uq" UNIQUE("run_seq"),
	CONSTRAINT "pay_runs_run_slug_uq" UNIQUE("run_slug"),
	CONSTRAINT "pay_runs_ws_id_uq" UNIQUE("workspace_id","id"),
	CONSTRAINT "pay_runs_state_ck" CHECK ("pay_runs"."state" in ('DRAFT', 'QUOTED', 'INVOICED', 'FUNDED', 'EXTRACTING', 'COMPUTED', 'IN_REVIEW', 'TREASURER_APPROVED', 'AWAITING_BOARD', 'APPROVED', 'POSTING', 'POSTED', 'SETTLING', 'NEEDS_FOLLOW_UP', 'SETTLED', 'CLOSED', 'CANCELLED', 'DENIED', 'HALTED')),
	CONSTRAINT "pay_runs_digest_from_posting_ck" CHECK ("pay_runs"."state" not in ('POSTING', 'POSTED', 'SETTLING', 'NEEDS_FOLLOW_UP', 'SETTLED', 'CLOSED', 'DENIED') or ("pay_runs"."batch_sha256" is not null and "pay_runs"."sender_batch_id" is not null)),
	CONSTRAINT "pay_runs_fx_ck" CHECK ("pay_runs"."fx_den" is null or "pay_runs"."fx_den" > 0),
	CONSTRAINT "pay_runs_quote_sha256_ck" CHECK ("pay_runs"."quote_sha256" is null or "pay_runs"."quote_sha256" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "pay_runs_rate_card_sha256_ck" CHECK ("pay_runs"."rate_card_sha256" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "pay_runs_batch_sha256_ck" CHECK ("pay_runs"."batch_sha256" is null or "pay_runs"."batch_sha256" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "pay_runs_currency_ck" CHECK ("pay_runs"."currency" ~ '^[A-Z]{3}$'),
	CONSTRAINT "pay_runs_provenance_ck" CHECK ("pay_runs"."provenance" in ('live', 'replay', 'simulated_rail', 'seeded'))
);
--> statement-breakpoint
CREATE TABLE "review_requests" (
	"id" uuid PRIMARY KEY DEFAULT fs_uuidv7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"line_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"message" text NOT NULL,
	"state" text DEFAULT 'OPEN' NOT NULL,
	"answer" text,
	"answered_by" text,
	"answered_at" timestamp with time zone,
	"provenance" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "review_requests_ws_id_uq" UNIQUE("workspace_id","id"),
	CONSTRAINT "review_requests_state_ck" CHECK ("review_requests"."state" in ('OPEN', 'ANSWERED', 'CLOSED')),
	CONSTRAINT "review_requests_provenance_ck" CHECK ("review_requests"."provenance" in ('live', 'replay', 'simulated_rail', 'seeded'))
);
--> statement-breakpoint
CREATE TABLE "statements" (
	"id" uuid PRIMARY KEY DEFAULT fs_uuidv7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"line_id" uuid NOT NULL,
	"lang" text NOT NULL,
	"sentences" jsonb NOT NULL,
	"sms_text" text,
	"audio" jsonb,
	"llm_call_id" uuid,
	"provenance" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "statements_line_lang_uq" UNIQUE("line_id","lang"),
	CONSTRAINT "statements_ws_id_uq" UNIQUE("workspace_id","id"),
	CONSTRAINT "statements_lang_ck" CHECK ("statements"."lang" in ('ceb', 'fil', 'en')),
	CONSTRAINT "statements_provenance_ck" CHECK ("statements"."provenance" in ('live', 'replay', 'simulated_rail', 'seeded'))
);
--> statement-breakpoint
CREATE TABLE "workspaces" (
	"id" uuid PRIMARY KEY DEFAULT fs_uuidv7() NOT NULL,
	"kind" text NOT NULL,
	"name" text NOT NULL,
	"seeded_from" uuid,
	"claimed_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workspaces_kind_ck" CHECK ("workspaces"."kind" in ('showcase', 'judge', 'real'))
);
--> statement-breakpoint
ALTER TABLE "auth_account" ADD CONSTRAINT "auth_account_user_id_auth_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."auth_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth_session" ADD CONSTRAINT "auth_session_user_id_auth_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."auth_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coops" ADD CONSTRAINT "coops_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lots" ADD CONSTRAINT "lots_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lots" ADD CONSTRAINT "lots_season_fk" FOREIGN KEY ("workspace_id","season_id") REFERENCES "public"."seasons"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "members" ADD CONSTRAINT "members_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "members" ADD CONSTRAINT "members_coop_fk" FOREIGN KEY ("workspace_id","coop_id") REFERENCES "public"."coops"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plots" ADD CONSTRAINT "plots_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plots" ADD CONSTRAINT "plots_member_fk" FOREIGN KEY ("workspace_id","member_id") REFERENCES "public"."members"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rate_cards" ADD CONSTRAINT "rate_cards_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rate_cards" ADD CONSTRAINT "rate_cards_season_fk" FOREIGN KEY ("workspace_id","season_id") REFERENCES "public"."seasons"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rate_rules" ADD CONSTRAINT "rate_rules_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rate_rules" ADD CONSTRAINT "rate_rules_card_fk" FOREIGN KEY ("workspace_id","rate_card_id") REFERENCES "public"."rate_cards"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ratifications" ADD CONSTRAINT "ratifications_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ratifications" ADD CONSTRAINT "ratifications_card_fk" FOREIGN KEY ("workspace_id","rate_card_id") REFERENCES "public"."rate_cards"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "seasons" ADD CONSTRAINT "seasons_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "seasons" ADD CONSTRAINT "seasons_coop_fk" FOREIGN KEY ("workspace_id","coop_id") REFERENCES "public"."coops"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deduction_marks" ADD CONSTRAINT "deduction_marks_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deduction_marks" ADD CONSTRAINT "deduction_marks_row_fk" FOREIGN KEY ("workspace_id","slip_row_id") REFERENCES "public"."slip_rows"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_season_fk" FOREIGN KEY ("workspace_id","season_id") REFERENCES "public"."seasons"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_exact_duplicate_fk" FOREIGN KEY ("workspace_id","exact_duplicate_of") REFERENCES "public"."documents"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "extraction_reads" ADD CONSTRAINT "extraction_reads_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "extraction_reads" ADD CONSTRAINT "extraction_reads_document_fk" FOREIGN KEY ("workspace_id","document_id") REFERENCES "public"."documents"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "extraction_reads" ADD CONSTRAINT "extraction_reads_llm_call_fk" FOREIGN KEY ("llm_call_id") REFERENCES "public"."llm_calls"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "slip_anomalies" ADD CONSTRAINT "slip_anomalies_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "slip_anomalies" ADD CONSTRAINT "slip_anomalies_document_fk" FOREIGN KEY ("workspace_id","document_id") REFERENCES "public"."documents"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "slip_anomalies" ADD CONSTRAINT "slip_anomalies_row_fk" FOREIGN KEY ("workspace_id","slip_row_id") REFERENCES "public"."slip_rows"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "slip_fields" ADD CONSTRAINT "slip_fields_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "slip_fields" ADD CONSTRAINT "slip_fields_row_fk" FOREIGN KEY ("workspace_id","slip_row_id") REFERENCES "public"."slip_rows"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "slip_rows" ADD CONSTRAINT "slip_rows_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "slip_rows" ADD CONSTRAINT "slip_rows_season_fk" FOREIGN KEY ("workspace_id","season_id") REFERENCES "public"."seasons"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "slip_rows" ADD CONSTRAINT "slip_rows_document_fk" FOREIGN KEY ("workspace_id","document_id") REFERENCES "public"."documents"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "slip_rows" ADD CONSTRAINT "slip_rows_member_fk" FOREIGN KEY ("workspace_id","member_id") REFERENCES "public"."members"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "device_keys" ADD CONSTRAINT "device_keys_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "device_keys" ADD CONSTRAINT "device_keys_user_id_auth_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."auth_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "frame_tokens" ADD CONSTRAINT "frame_tokens_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "frame_tokens" ADD CONSTRAINT "frame_tokens_member_fk" FOREIGN KEY ("workspace_id","member_id") REFERENCES "public"."members"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_user_id_auth_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."auth_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_member_fk" FOREIGN KEY ("workspace_id","member_id") REFERENCES "public"."members"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pairing_tokens" ADD CONSTRAINT "pairing_tokens_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pairing_tokens" ADD CONSTRAINT "pairing_tokens_member_fk" FOREIGN KEY ("workspace_id","member_id") REFERENCES "public"."members"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "push_tokens" ADD CONSTRAINT "push_tokens_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "push_tokens" ADD CONSTRAINT "push_tokens_device_key_fk" FOREIGN KEY ("workspace_id","device_key_id") REFERENCES "public"."device_keys"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_sessions" ADD CONSTRAINT "agent_sessions_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_sessions" ADD CONSTRAINT "agent_sessions_run_fk" FOREIGN KEY ("workspace_id","run_id") REFERENCES "public"."pay_runs"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "idempotency_keys" ADD CONSTRAINT "idempotency_keys_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_run_fk" FOREIGN KEY ("workspace_id","run_id") REFERENCES "public"."pay_runs"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_heads" ADD CONSTRAINT "ledger_heads_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_events" ADD CONSTRAINT "run_events_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_events" ADD CONSTRAINT "run_events_run_fk" FOREIGN KEY ("workspace_id","run_id") REFERENCES "public"."pay_runs"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_events" ADD CONSTRAINT "run_events_line_fk" FOREIGN KEY ("workspace_id","line_id") REFERENCES "public"."member_lines"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "system_flags" ADD CONSTRAINT "system_flags_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_outbox" ADD CONSTRAINT "task_outbox_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "llm_calls" ADD CONSTRAINT "llm_calls_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payout_batches" ADD CONSTRAINT "payout_batches_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payout_batches" ADD CONSTRAINT "payout_batches_run_fk" FOREIGN KEY ("workspace_id","run_id") REFERENCES "public"."pay_runs"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payout_items" ADD CONSTRAINT "payout_items_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payout_items" ADD CONSTRAINT "payout_items_batch_fk" FOREIGN KEY ("workspace_id","batch_id") REFERENCES "public"."payout_batches"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payout_items" ADD CONSTRAINT "payout_items_line_fk" FOREIGN KEY ("workspace_id","line_id") REFERENCES "public"."member_lines"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payout_items" ADD CONSTRAINT "payout_items_supersedes_fk" FOREIGN KEY ("workspace_id","supersedes_item_id") REFERENCES "public"."payout_items"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "paypal_calls" ADD CONSTRAINT "paypal_calls_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reconciliation_reports" ADD CONSTRAINT "reconciliation_reports_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_events" ADD CONSTRAINT "webhook_events_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_run_fk" FOREIGN KEY ("workspace_id","run_id") REFERENCES "public"."pay_runs"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_receipts" ADD CONSTRAINT "cash_receipts_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_receipts" ADD CONSTRAINT "cash_receipts_line_fk" FOREIGN KEY ("workspace_id","line_id") REFERENCES "public"."member_lines"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "holds" ADD CONSTRAINT "holds_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "holds" ADD CONSTRAINT "holds_run_fk" FOREIGN KEY ("workspace_id","run_id") REFERENCES "public"."pay_runs"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "holds" ADD CONSTRAINT "holds_line_fk" FOREIGN KEY ("workspace_id","line_id") REFERENCES "public"."member_lines"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_run_fk" FOREIGN KEY ("workspace_id","run_id") REFERENCES "public"."pay_runs"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_lines" ADD CONSTRAINT "member_lines_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_lines" ADD CONSTRAINT "member_lines_run_fk" FOREIGN KEY ("workspace_id","run_id") REFERENCES "public"."pay_runs"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_lines" ADD CONSTRAINT "member_lines_member_fk" FOREIGN KEY ("workspace_id","member_id") REFERENCES "public"."members"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pay_runs" ADD CONSTRAINT "pay_runs_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pay_runs" ADD CONSTRAINT "pay_runs_season_fk" FOREIGN KEY ("workspace_id","season_id") REFERENCES "public"."seasons"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pay_runs" ADD CONSTRAINT "pay_runs_lot_fk" FOREIGN KEY ("workspace_id","lot_id") REFERENCES "public"."lots"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pay_runs" ADD CONSTRAINT "pay_runs_rate_card_fk" FOREIGN KEY ("workspace_id","rate_card_id") REFERENCES "public"."rate_cards"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_requests" ADD CONSTRAINT "review_requests_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_requests" ADD CONSTRAINT "review_requests_line_fk" FOREIGN KEY ("workspace_id","line_id") REFERENCES "public"."member_lines"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_requests" ADD CONSTRAINT "review_requests_member_fk" FOREIGN KEY ("workspace_id","member_id") REFERENCES "public"."members"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "statements" ADD CONSTRAINT "statements_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "statements" ADD CONSTRAINT "statements_llm_call_id_llm_calls_id_fk" FOREIGN KEY ("llm_call_id") REFERENCES "public"."llm_calls"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "statements" ADD CONSTRAINT "statements_line_fk" FOREIGN KEY ("workspace_id","line_id") REFERENCES "public"."member_lines"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspaces" ADD CONSTRAINT "workspaces_seeded_from_fk" FOREIGN KEY ("seeded_from") REFERENCES "public"."workspaces"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "auth_account_user_idx" ON "auth_account" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "auth_session_user_idx" ON "auth_session" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "auth_verification_identifier_idx" ON "auth_verification" USING btree ("identifier");--> statement-breakpoint
CREATE INDEX "documents_sha256_idx" ON "documents" USING btree ("workspace_id","sha256");--> statement-breakpoint
CREATE INDEX "extraction_reads_document_idx" ON "extraction_reads" USING btree ("workspace_id","document_id");--> statement-breakpoint
CREATE INDEX "slip_rows_serial_idx" ON "slip_rows" USING btree ("workspace_id","serial");--> statement-breakpoint
CREATE INDEX "slip_rows_member_idx" ON "slip_rows" USING btree ("workspace_id","member_id");--> statement-breakpoint
CREATE INDEX "agent_sessions_ws_idx" ON "agent_sessions" USING btree ("workspace_id","session_id");--> statement-breakpoint
CREATE INDEX "idempotency_keys_expires_idx" ON "idempotency_keys" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "ledger_entries_run_idx" ON "ledger_entries" USING btree ("run_id","seq");--> statement-breakpoint
CREATE INDEX "run_events_ws_idx" ON "run_events" USING btree ("workspace_id","id");--> statement-breakpoint
CREATE INDEX "run_events_run_idx" ON "run_events" USING btree ("run_id","id");--> statement-breakpoint
CREATE INDEX "run_events_line_idx" ON "run_events" USING btree ("line_id","id");--> statement-breakpoint
CREATE INDEX "task_outbox_queued_idx" ON "task_outbox" USING btree ("run_after") WHERE state = 'queued';--> statement-breakpoint
CREATE INDEX "task_outbox_inflight_idx" ON "task_outbox" USING btree ("state","updated_at") WHERE state in ('dispatched', 'running');--> statement-breakpoint
CREATE INDEX "llm_calls_budget_idx" ON "llm_calls" USING btree ("budget_key","created_at");--> statement-breakpoint
CREATE INDEX "llm_calls_ws_idx" ON "llm_calls" USING btree ("workspace_id","created_at");--> statement-breakpoint
CREATE INDEX "payout_batches_run_idx" ON "payout_batches" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "payout_items_batch_idx" ON "payout_items" USING btree ("batch_id");--> statement-breakpoint
CREATE INDEX "payout_items_line_idx" ON "payout_items" USING btree ("line_id");--> statement-breakpoint
CREATE INDEX "paypal_calls_at_idx" ON "paypal_calls" USING btree ("at");--> statement-breakpoint
CREATE INDEX "paypal_calls_429_idx" ON "paypal_calls" USING btree ("responded_at") WHERE status = 429;--> statement-breakpoint
CREATE INDEX "reconciliation_reports_kind_idx" ON "reconciliation_reports" USING btree ("kind","created_at");--> statement-breakpoint
CREATE INDEX "webhook_events_status_idx" ON "webhook_events" USING btree ("status","received_at");--> statement-breakpoint
CREATE INDEX "webhook_events_resource_idx" ON "webhook_events" USING btree ("resource_key");--> statement-breakpoint
CREATE UNIQUE INDEX "approvals_live_role_uq" ON "approvals" USING btree ("run_id","role") WHERE voided_at is null and decision = 'SIGNED';--> statement-breakpoint
CREATE INDEX "holds_run_state_idx" ON "holds" USING btree ("run_id","state");--> statement-breakpoint
CREATE INDEX "member_lines_run_state_idx" ON "member_lines" USING btree ("run_id","state");--> statement-breakpoint
CREATE INDEX "pay_runs_ws_state_idx" ON "pay_runs" USING btree ("workspace_id","state");--> statement-breakpoint
CREATE INDEX "workspaces_kind_expires_idx" ON "workspaces" USING btree ("kind","expires_at");