CREATE TABLE "notification_attempt_feedback" (
	"company_id" uuid NOT NULL,
	"id" uuid NOT NULL,
	"attempt_id" uuid NOT NULL,
	"event_type" text NOT NULL,
	"bounce_class" text,
	"provider_event_digest" "bytea" NOT NULL,
	"provider_timestamp" timestamp with time zone NOT NULL,
	"recorded_at" timestamp with time zone NOT NULL,
	CONSTRAINT "notification_attempt_feedback_pkey" PRIMARY KEY("company_id","id"),
	CONSTRAINT "notification_attempt_feedback_event" UNIQUE("company_id","provider_event_digest"),
	CONSTRAINT "notification_attempt_feedback_event_type" CHECK ("notification_attempt_feedback"."event_type" IN ('email.delivered','email.bounced','email.complained','email.failed','email.suppressed','email.delivery_delayed')),
	CONSTRAINT "notification_attempt_feedback_bounce_class" CHECK ("notification_attempt_feedback"."bounce_class" IS NULL OR "notification_attempt_feedback"."bounce_class" IN ('PERMANENT','TRANSIENT')),
	CONSTRAINT "notification_attempt_feedback_digest" CHECK (octet_length("notification_attempt_feedback"."provider_event_digest") = 32)
);
--> statement-breakpoint
CREATE TABLE "platform_email_audit" (
	"id" uuid PRIMARY KEY NOT NULL,
	"recipient_hash" "bytea" NOT NULL,
	"hash_key_id" text NOT NULL,
	"source" text NOT NULL,
	"inbox_id" uuid,
	"operator_id" uuid,
	"action" text NOT NULL,
	"reason" text NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	CONSTRAINT "platform_email_audit_hash" CHECK (octet_length("platform_email_audit"."recipient_hash") = 32),
	CONSTRAINT "platform_email_audit_actor" CHECK (("platform_email_audit"."source" IN ('BOUNCE','COMPLAINT','PROVIDER') AND "platform_email_audit"."inbox_id" IS NOT NULL AND "platform_email_audit"."operator_id" IS NULL AND "platform_email_audit"."reason" IN ('PERMANENT_BOUNCE','COMPLAINT','PROVIDER_SUPPRESSION')) OR ("platform_email_audit"."source" = 'MANUAL' AND "platform_email_audit"."inbox_id" IS NULL AND "platform_email_audit"."operator_id" IS NOT NULL AND "platform_email_audit"."reason" IN ('OPERATOR_REQUEST','ABUSE_PREVENTION'))),
	CONSTRAINT "platform_email_audit_action" CHECK ("platform_email_audit"."action" = 'SUPPRESS')
);
--> statement-breakpoint
CREATE TABLE "platform_email_feedback_inbox" (
	"id" uuid PRIMARY KEY NOT NULL,
	"provider_event_digest" "bytea" NOT NULL,
	"provider_email_id" text NOT NULL,
	"event_type" text NOT NULL,
	"bounce_class" text,
	"provider_timestamp" timestamp with time zone NOT NULL,
	"received_at" timestamp with time zone NOT NULL,
	"raw_event" jsonb,
	"enqueue_confirmed_at" timestamp with time zone,
	"attempts" smallint DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone,
	"resolved_at" timestamp with time zone,
	"quarantined_at" timestamp with time zone,
	"quarantine_reason" text,
	CONSTRAINT "platform_email_feedback_inbox_digest" UNIQUE("provider_event_digest"),
	CONSTRAINT "platform_email_feedback_inbox_digest_bytes" CHECK (octet_length("platform_email_feedback_inbox"."provider_event_digest") = 32),
	CONSTRAINT "platform_email_feedback_inbox_event_type" CHECK ("platform_email_feedback_inbox"."event_type" IN ('email.delivered','email.bounced','email.complained','email.failed','email.suppressed','email.delivery_delayed')),
	CONSTRAINT "platform_email_feedback_inbox_bounce_class" CHECK ("platform_email_feedback_inbox"."bounce_class" IS NULL OR "platform_email_feedback_inbox"."bounce_class" IN ('PERMANENT','TRANSIENT')),
	CONSTRAINT "platform_email_feedback_inbox_state" CHECK (NOT ("platform_email_feedback_inbox"."resolved_at" IS NOT NULL AND "platform_email_feedback_inbox"."quarantined_at" IS NOT NULL)),
	CONSTRAINT "platform_email_feedback_inbox_quarantine_reason" CHECK ("platform_email_feedback_inbox"."quarantine_reason" IS NULL OR "platform_email_feedback_inbox"."quarantine_reason" IN ('TAGS_INVALID','RETRIEVAL_EXHAUSTED','ATTEMPT_NOT_FOUND','HASH_MISMATCH','STATE_INELIGIBLE','EXECUTION_MISSING','PROVIDER_ID_CONFLICT','CROSS_TENANT')),
	CONSTRAINT "platform_email_feedback_inbox_attempts" CHECK ("platform_email_feedback_inbox"."attempts" >= 0)
);
--> statement-breakpoint
CREATE TABLE "platform_email_suppressions" (
	"recipient_hash" "bytea" PRIMARY KEY NOT NULL,
	"hash_key_id" text NOT NULL,
	"source" text NOT NULL,
	"first_suppressed_at" timestamp with time zone NOT NULL,
	"last_suppressed_at" timestamp with time zone NOT NULL,
	"lifted_at" timestamp with time zone,
	CONSTRAINT "platform_email_suppressions_hash" CHECK (octet_length("platform_email_suppressions"."recipient_hash") = 32),
	CONSTRAINT "platform_email_suppressions_source" CHECK ("platform_email_suppressions"."source" IN ('BOUNCE','COMPLAINT','PROVIDER','MANUAL')),
	CONSTRAINT "platform_email_suppressions_time" CHECK ("platform_email_suppressions"."last_suppressed_at" >= "platform_email_suppressions"."first_suppressed_at"),
	CONSTRAINT "platform_email_suppressions_null_only" CHECK ("platform_email_suppressions"."lifted_at" IS NULL)
);
--> statement-breakpoint
ALTER TABLE "notification_attempt_feedback" ADD CONSTRAINT "notification_attempt_feedback_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_attempt_feedback" ADD CONSTRAINT "notification_attempt_feedback_attempt_fk" FOREIGN KEY ("company_id","attempt_id") REFERENCES "public"."notification_attempts"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_email_audit" ADD CONSTRAINT "platform_email_audit_inbox_id_platform_email_feedback_inbox_id_fk" FOREIGN KEY ("inbox_id") REFERENCES "public"."platform_email_feedback_inbox"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
-- Email feedback intake (spec 075 C1a, ADR-0014 addendum). Three global tables on the notifications
-- role — hashes and identifiers only, no company, no tenant RLS — plus the tenant evidence table with
-- its own RLS. Expand-only: nothing is dropped and no existing table is touched.
ALTER TABLE "notification_attempt_feedback" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "notification_attempt_feedback" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY notification_attempt_feedback_select ON notification_attempt_feedback FOR SELECT TO pospay_app
  USING (company_id = app_company_id());
--> statement-breakpoint
CREATE POLICY notification_attempt_feedback_insert ON notification_attempt_feedback FOR INSERT TO pospay_app
  WITH CHECK (company_id = app_company_id());
--> statement-breakpoint
ALTER TABLE public.platform_email_suppressions OWNER TO pospay_owner;
--> statement-breakpoint
ALTER TABLE public.platform_email_feedback_inbox OWNER TO pospay_owner;
--> statement-breakpoint
ALTER TABLE public.platform_email_audit OWNER TO pospay_owner;
--> statement-breakpoint
REVOKE ALL ON public.platform_email_suppressions, public.platform_email_feedback_inbox, public.platform_email_audit FROM PUBLIC, pospay_app, pospay_auth, pospay_dispatcher, pospay_notifications, pospay_email_suppression_reader;
--> statement-breakpoint
REVOKE ALL ON public.notification_attempt_feedback FROM PUBLIC, pospay_auth, pospay_dispatcher, pospay_notifications;
--> statement-breakpoint
GRANT USAGE ON SCHEMA public TO pospay_email_suppression_reader;
--> statement-breakpoint
REVOKE CREATE ON SCHEMA public FROM pospay_email_suppression_reader;
--> statement-breakpoint
GRANT SELECT, INSERT ON public.platform_email_feedback_inbox TO pospay_notifications;
--> statement-breakpoint
GRANT UPDATE (raw_event,enqueue_confirmed_at,attempts,next_attempt_at,resolved_at,quarantined_at,quarantine_reason) ON public.platform_email_feedback_inbox TO pospay_notifications;
--> statement-breakpoint
GRANT SELECT, INSERT ON public.platform_email_suppressions TO pospay_notifications;
--> statement-breakpoint
GRANT UPDATE (last_suppressed_at,source) ON public.platform_email_suppressions TO pospay_notifications;
--> statement-breakpoint
GRANT INSERT ON public.platform_email_audit TO pospay_notifications;
--> statement-breakpoint
GRANT SELECT ON public.platform_email_suppressions TO pospay_email_suppression_reader;
--> statement-breakpoint
GRANT SELECT, INSERT ON public.notification_attempt_feedback TO pospay_app;
--> statement-breakpoint
CREATE FUNCTION public.platform_email_is_suppressed(recipient bytea) RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF recipient IS NULL OR octet_length(recipient) <> 32 THEN
    RAISE EXCEPTION 'SUPPRESSION_HASH_INVALID' USING ERRCODE = '22023';
  END IF;
  RETURN EXISTS (SELECT 1 FROM public.platform_email_suppressions
    WHERE recipient_hash = recipient AND lifted_at IS NULL);
END $$;
--> statement-breakpoint
ALTER FUNCTION public.platform_email_is_suppressed(bytea) OWNER TO pospay_email_suppression_reader;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.platform_email_is_suppressed(bytea) FROM PUBLIC, pospay_auth, pospay_dispatcher, pospay_notifications, pospay_email_suppression_reader;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.platform_email_is_suppressed(bytea) TO pospay_app;