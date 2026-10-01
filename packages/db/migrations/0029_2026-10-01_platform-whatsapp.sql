CREATE TABLE "platform_whatsapp_audit" (
	"id" uuid PRIMARY KEY NOT NULL,
	"recipient_hash" "bytea" NOT NULL,
	"hash_key_id" text NOT NULL,
	"source" text NOT NULL,
	"inbox_id" uuid,
	"operator_id" uuid,
	"action" text NOT NULL,
	"reason" text NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	CONSTRAINT "platform_whatsapp_audit_hash" CHECK (octet_length("platform_whatsapp_audit"."recipient_hash") = 32),
	CONSTRAINT "platform_whatsapp_audit_actor" CHECK (("platform_whatsapp_audit"."source" = 'STOP' AND "platform_whatsapp_audit"."inbox_id" IS NOT NULL AND "platform_whatsapp_audit"."operator_id" IS NULL AND "platform_whatsapp_audit"."reason" = 'RECIPIENT_STOP') OR ("platform_whatsapp_audit"."source" = 'MANUAL' AND "platform_whatsapp_audit"."inbox_id" IS NULL AND "platform_whatsapp_audit"."operator_id" IS NOT NULL AND "platform_whatsapp_audit"."reason" IN ('OPERATOR_REQUEST','ABUSE_PREVENTION'))),
	CONSTRAINT "platform_whatsapp_audit_action" CHECK ("platform_whatsapp_audit"."action" = 'OPT_OUT')
);
--> statement-breakpoint
CREATE TABLE "platform_whatsapp_inbox" (
	"id" uuid PRIMARY KEY NOT NULL,
	"provider_message_digest" "bytea" NOT NULL,
	"recipient_hash" "bytea" NOT NULL,
	"hash_key_id" text NOT NULL,
	"command" text NOT NULL,
	"provider_timestamp" timestamp with time zone NOT NULL,
	"received_at" timestamp with time zone NOT NULL,
	"raw_event" jsonb,
	"suppression_applied_at" timestamp with time zone,
	"processed_at" timestamp with time zone,
	"enqueue_confirmed_at" timestamp with time zone,
	CONSTRAINT "platform_whatsapp_inbox_digest" UNIQUE("provider_message_digest"),
	CONSTRAINT "platform_whatsapp_inbox_hash" CHECK (octet_length("platform_whatsapp_inbox"."recipient_hash") = 32 AND octet_length("platform_whatsapp_inbox"."provider_message_digest") = 32),
	CONSTRAINT "platform_whatsapp_inbox_command" CHECK ("platform_whatsapp_inbox"."command" IN ('STOP','OTHER'))
);
--> statement-breakpoint
CREATE TABLE "platform_whatsapp_suppressions" (
	"recipient_hash" "bytea" PRIMARY KEY NOT NULL,
	"hash_key_id" text NOT NULL,
	"source" text NOT NULL,
	"first_opted_out_at" timestamp with time zone NOT NULL,
	"last_opted_out_at" timestamp with time zone NOT NULL,
	"opted_back_in_at" timestamp with time zone,
	CONSTRAINT "platform_whatsapp_suppressions_hash" CHECK (octet_length("platform_whatsapp_suppressions"."recipient_hash") = 32),
	CONSTRAINT "platform_whatsapp_suppressions_source" CHECK ("platform_whatsapp_suppressions"."source" IN ('STOP','MANUAL')),
	CONSTRAINT "platform_whatsapp_suppressions_time" CHECK ("platform_whatsapp_suppressions"."last_opted_out_at" >= "platform_whatsapp_suppressions"."first_opted_out_at"),
	CONSTRAINT "platform_whatsapp_suppressions_null_only" CHECK ("platform_whatsapp_suppressions"."opted_back_in_at" IS NULL)
);
--> statement-breakpoint
ALTER TABLE "platform_whatsapp_audit" ADD CONSTRAINT "platform_whatsapp_audit_inbox_id_platform_whatsapp_inbox_id_fk" FOREIGN KEY ("inbox_id") REFERENCES "public"."platform_whatsapp_inbox"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "platform_whatsapp_audit_inbox_idx" ON "platform_whatsapp_audit" USING btree ("inbox_id");--> statement-breakpoint
CREATE INDEX "platform_whatsapp_inbox_enqueue_idx" ON "platform_whatsapp_inbox" USING btree ("received_at","id") WHERE "platform_whatsapp_inbox"."enqueue_confirmed_at" IS NULL;--> statement-breakpoint
CREATE INDEX "platform_whatsapp_inbox_processing_idx" ON "platform_whatsapp_inbox" USING btree ("received_at","id") WHERE "platform_whatsapp_inbox"."processed_at" IS NULL;--> statement-breakpoint
CREATE INDEX "platform_whatsapp_inbox_retention_idx" ON "platform_whatsapp_inbox" USING btree ("received_at","id") WHERE "platform_whatsapp_inbox"."raw_event" IS NOT NULL;