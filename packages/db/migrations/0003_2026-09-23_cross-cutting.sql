CREATE TABLE "outbox" (
	"company_id" uuid NOT NULL,
	"id" uuid NOT NULL,
	"aggregate_type" text NOT NULL,
	"aggregate_id" uuid NOT NULL,
	"event_type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"published_at" timestamp with time zone,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	CONSTRAINT "outbox_pkey" PRIMARY KEY("company_id","id"),
	CONSTRAINT "outbox_event_type_format" CHECK ("outbox"."event_type" ~ '^[A-Z][A-Za-z0-9]{1,99}$'),
	CONSTRAINT "outbox_aggregate_type_format" CHECK ("outbox"."aggregate_type" ~ '^[a-z][a-z0-9_]{1,62}$'),
	CONSTRAINT "outbox_attempts_non_negative" CHECK ("outbox"."attempts" >= 0)
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"company_id" uuid NOT NULL,
	"id" uuid NOT NULL,
	"actor_user_id" uuid,
	"entity" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"action" text NOT NULL,
	"before" jsonb,
	"after" jsonb,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "audit_log_pkey" PRIMARY KEY("company_id","id"),
	CONSTRAINT "audit_log_entity_format" CHECK ("audit_log"."entity" ~ '^[a-z][a-z0-9_]{1,62}$'),
	CONSTRAINT "audit_log_action_format" CHECK ("audit_log"."action" ~ '^[a-z][a-z0-9_.]{1,62}$')
);
--> statement-breakpoint
CREATE TABLE "idempotency_keys" (
	"scope_type" text NOT NULL,
	"scope_id" uuid NOT NULL,
	"company_id" uuid,
	"user_id" uuid,
	"operation" text NOT NULL,
	"key" text NOT NULL,
	"request_fingerprint" text NOT NULL,
	"response_status" integer,
	"response_body" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "idempotency_keys_pkey" PRIMARY KEY("scope_type","scope_id","operation","key"),
	CONSTRAINT "idempotency_keys_scope" CHECK (("idempotency_keys"."scope_type" = 'COMPANY' AND "idempotency_keys"."company_id" IS NOT NULL AND "idempotency_keys"."scope_id" = "idempotency_keys"."company_id")
          OR ("idempotency_keys"."scope_type" = 'USER' AND "idempotency_keys"."user_id" IS NOT NULL AND "idempotency_keys"."scope_id" = "idempotency_keys"."user_id")),
	CONSTRAINT "idempotency_keys_key_format" CHECK ("idempotency_keys"."key" ~ '^[!-~]{1,255}$'),
	CONSTRAINT "idempotency_keys_operation_format" CHECK ("idempotency_keys"."operation" ~ '^[a-z][a-z0-9-]{1,62}$'),
	CONSTRAINT "idempotency_keys_fingerprint_format" CHECK ("idempotency_keys"."request_fingerprint" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "idempotency_keys_response_status" CHECK ("idempotency_keys"."response_status" IS NULL OR "idempotency_keys"."response_status" BETWEEN 200 AND 599),
	CONSTRAINT "idempotency_keys_expiry" CHECK ("idempotency_keys"."expires_at" > "idempotency_keys"."created_at")
);
--> statement-breakpoint
ALTER TABLE "outbox" ADD CONSTRAINT "outbox_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "idempotency_keys" ADD CONSTRAINT "idempotency_keys_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "outbox_unpublished_idx" ON "outbox" USING btree ("created_at","id") WHERE "outbox"."published_at" IS NULL;--> statement-breakpoint
CREATE INDEX "audit_log_company_id_at_idx" ON "audit_log" USING btree ("company_id","at");--> statement-breakpoint
CREATE INDEX "audit_log_company_id_entity_idx" ON "audit_log" USING btree ("company_id","entity","entity_id");--> statement-breakpoint
CREATE INDEX "idempotency_keys_expires_at_idx" ON "idempotency_keys" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "idempotency_keys_company_id_idx" ON "idempotency_keys" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "idempotency_keys_user_id_idx" ON "idempotency_keys" USING btree ("user_id");