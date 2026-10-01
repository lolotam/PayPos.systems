CREATE TABLE "notification_attempts" (
	"company_id" uuid NOT NULL,
	"id" uuid NOT NULL,
	"business_id" uuid,
	"branch_id" uuid,
	"source_event_id" uuid NOT NULL,
	"channel" text NOT NULL,
	"template_key" text NOT NULL,
	"template_revision" integer NOT NULL,
	"locale" text,
	"provider_template_name" text,
	"recipient_phone" text,
	"recipient_hash" "bytea" NOT NULL,
	"hash_key_id" text NOT NULL,
	"phone_last3" text NOT NULL,
	"safe_parameters" jsonb NOT NULL,
	"status" text NOT NULL,
	"authorized_at" timestamp with time zone NOT NULL,
	"send_deadline" timestamp with time zone,
	"execution_id" uuid,
	"sending_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"provider_message_id" text,
	"failure_code" text,
	"outcome_known" boolean,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "notification_attempts_pkey" PRIMARY KEY("company_id","id"),
	CONSTRAINT "notification_attempts_identity" UNIQUE("company_id","source_event_id","channel","recipient_hash","template_key"),
	CONSTRAINT "notification_attempts_scope" CHECK ("notification_attempts"."branch_id" IS NULL OR "notification_attempts"."business_id" IS NOT NULL),
	CONSTRAINT "notification_attempts_status" CHECK ("notification_attempts"."status" IN ('PENDING','SENDING','SENT','FAILED','EXPIRED','SUPPRESSED')),
	CONSTRAINT "notification_attempts_locale" CHECK ("notification_attempts"."locale" IN ('ar','en') OR ("notification_attempts"."locale" IS NULL AND "notification_attempts"."status" = 'FAILED' AND "notification_attempts"."failure_code" IN ('LOCALE_MISSING','LOCALE_UNSUPPORTED'))),
	CONSTRAINT "notification_attempts_phone" CHECK (("notification_attempts"."status" NOT IN ('SENT','FAILED','EXPIRED','SUPPRESSED') OR "notification_attempts"."recipient_phone" IS NULL) AND ("notification_attempts"."status" <> 'PENDING' OR "notification_attempts"."recipient_phone" IS NOT NULL) AND ("notification_attempts"."recipient_phone" IS NULL OR "notification_attempts"."recipient_phone" ~ '^+[1-9][0-9]{7,14}$')),
	CONSTRAINT "notification_attempts_hash" CHECK (octet_length("notification_attempts"."recipient_hash") = 32 AND "notification_attempts"."phone_last3" ~ '^[0-9]{3}$'),
	CONSTRAINT "notification_attempts_revision" CHECK ("notification_attempts"."template_revision" > 0),
	CONSTRAINT "notification_attempts_execution" CHECK ("notification_attempts"."status" <> 'SENDING' OR ("notification_attempts"."execution_id" IS NOT NULL AND "notification_attempts"."sending_at" IS NOT NULL)),
	CONSTRAINT "notification_attempts_failure" CHECK ("notification_attempts"."failure_code" IS NULL OR "notification_attempts"."failure_code" IN ('LOCALE_MISSING','LOCALE_UNSUPPORTED','DESTINATION_INVALID','CONFIG_INVALID','PARAMETERS_INVALID','ADMISSION_REFUSED','DEADLINE_EXPIRED','SUPPRESSED','PROVIDER_4XX','PROVIDER_5XX','NETWORK_UNKNOWN','RESPONSE_INVALID')),
	CONSTRAINT "notification_attempts_parameters" CHECK (jsonb_typeof("notification_attempts"."safe_parameters") = 'array'),
	CONSTRAINT "notification_attempts_channel" CHECK ("notification_attempts"."channel" = 'whatsapp')
);
--> statement-breakpoint
ALTER TABLE "notification_attempts" ADD CONSTRAINT "notification_attempts_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_attempts" ADD CONSTRAINT "notification_attempts_business_fk" FOREIGN KEY ("company_id","business_id") REFERENCES "public"."businesses"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_attempts" ADD CONSTRAINT "notification_attempts_branch_fk" FOREIGN KEY ("company_id","branch_id") REFERENCES "public"."branches"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "notification_attempts_business_idx" ON "notification_attempts" USING btree ("company_id","business_id");--> statement-breakpoint
CREATE INDEX "notification_attempts_branch_idx" ON "notification_attempts" USING btree ("company_id","branch_id");--> statement-breakpoint
CREATE INDEX "notification_attempts_log_idx" ON "notification_attempts" USING btree ("company_id","created_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "notification_attempts_status_idx" ON "notification_attempts" USING btree ("company_id","status","created_at","id");