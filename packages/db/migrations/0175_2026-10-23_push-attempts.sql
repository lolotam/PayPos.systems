CREATE TABLE "push_attempts" (
	"company_id" uuid NOT NULL,
	"id" uuid NOT NULL,
	"subscription_id" uuid NOT NULL,
	"subscription_generation" integer NOT NULL,
	"user_id" uuid NOT NULL,
	"business_id" uuid,
	"branch_id" uuid,
	"source_event_id" uuid NOT NULL,
	"template_key" text NOT NULL,
	"template_revision" integer NOT NULL,
	"locale" text NOT NULL,
	"safe_parameters" jsonb NOT NULL,
	"status" text NOT NULL,
	"send_deadline" timestamp with time zone,
	"execution_id" uuid,
	"sending_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"failure_code" text,
	"outcome_known" boolean,
	"http_status" smallint,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "push_attempts_pkey" PRIMARY KEY("company_id","id"),
	CONSTRAINT "push_attempts_identity" UNIQUE("company_id","source_event_id","subscription_id","template_key"),
	CONSTRAINT "push_attempts_status" CHECK ("push_attempts"."status" IN ('PENDING','SENDING','SENT','FAILED','EXPIRED')),
	CONSTRAINT "push_attempts_locale" CHECK ("push_attempts"."locale" IN ('ar','en')),
	CONSTRAINT "push_attempts_revision" CHECK ("push_attempts"."template_revision" > 0),
	CONSTRAINT "push_attempts_generation" CHECK ("push_attempts"."subscription_generation" >= 1),
	CONSTRAINT "push_attempts_parameters" CHECK (jsonb_typeof("push_attempts"."safe_parameters") = 'array'),
	CONSTRAINT "push_attempts_scope" CHECK ("push_attempts"."branch_id" IS NULL OR "push_attempts"."business_id" IS NOT NULL),
	CONSTRAINT "push_attempts_http_status" CHECK ("push_attempts"."http_status" IS NULL OR "push_attempts"."http_status" BETWEEN 100 AND 599),
	CONSTRAINT "push_attempts_failure" CHECK ("push_attempts"."failure_code" IS NULL OR "push_attempts"."failure_code" IN ('DEADLINE_EXPIRED','SUBSCRIPTION_GONE','SUBSCRIPTION_CHANGED','SUBSCRIPTION_REVOKED','KEY_ROTATED','ADMISSION_REFUSED','VAPID_REJECTED','PROVIDER_4XX','PROVIDER_429','PROVIDER_5XX','NETWORK_UNKNOWN')),
	CONSTRAINT "push_attempts_state" CHECK (("push_attempts"."status" = 'PENDING' AND "push_attempts"."execution_id" IS NULL AND "push_attempts"."sending_at" IS NULL AND "push_attempts"."finished_at" IS NULL AND "push_attempts"."failure_code" IS NULL AND "push_attempts"."outcome_known" IS NULL) OR ("push_attempts"."status" = 'SENDING' AND "push_attempts"."execution_id" IS NOT NULL AND "push_attempts"."sending_at" IS NOT NULL AND "push_attempts"."finished_at" IS NULL) OR ("push_attempts"."status" IN ('SENT','FAILED','EXPIRED') AND "push_attempts"."finished_at" IS NOT NULL AND "push_attempts"."outcome_known" IS NOT NULL)),
	CONSTRAINT "push_attempts_outcome" CHECK (("push_attempts"."status" <> 'SENT' OR "push_attempts"."failure_code" IS NULL) AND ("push_attempts"."status" NOT IN ('FAILED','EXPIRED') OR "push_attempts"."failure_code" IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "push_attempts" ADD CONSTRAINT "push_attempts_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "push_attempts" ADD CONSTRAINT "push_attempts_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "push_attempts" ADD CONSTRAINT "push_attempts_subscription_fk" FOREIGN KEY ("company_id","subscription_id") REFERENCES "public"."push_subscriptions"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "push_attempts" ADD CONSTRAINT "push_attempts_business_fk" FOREIGN KEY ("company_id","business_id") REFERENCES "public"."businesses"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "push_attempts" ADD CONSTRAINT "push_attempts_branch_fk" FOREIGN KEY ("company_id","branch_id") REFERENCES "public"."branches"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "push_attempts_status_idx" ON "push_attempts" USING btree ("company_id","status","created_at","id");--> statement-breakpoint
CREATE INDEX "push_attempts_user_idx" ON "push_attempts" USING btree ("company_id","user_id","created_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "push_attempts_subscription_idx" ON "push_attempts" USING btree ("company_id","subscription_id");--> statement-breakpoint
CREATE INDEX "push_attempts_branch_idx" ON "push_attempts" USING btree ("company_id","branch_id");--> statement-breakpoint
CREATE INDEX "push_attempts_business_idx" ON "push_attempts" USING btree ("company_id","business_id");--> statement-breakpoint
CREATE INDEX "push_attempts_user_fk_idx" ON "push_attempts" USING btree ("user_id");
--> statement-breakpoint
ALTER TABLE push_attempts ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE push_attempts FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY push_attempts_select ON push_attempts FOR SELECT TO pospay_app
  USING (company_id = app_company_id());
--> statement-breakpoint
CREATE POLICY push_attempts_insert ON push_attempts FOR INSERT TO pospay_app
  WITH CHECK (company_id = app_company_id());
--> statement-breakpoint
CREATE POLICY push_attempts_update ON push_attempts FOR UPDATE TO pospay_app
  USING (company_id = app_company_id()) WITH CHECK (company_id = app_company_id());
--> statement-breakpoint
REVOKE ALL ON push_attempts FROM PUBLIC, pospay_app, pospay_auth, pospay_dispatcher;
--> statement-breakpoint
GRANT SELECT, INSERT ON push_attempts TO pospay_app;
--> statement-breakpoint
GRANT UPDATE (status, execution_id, sending_at, finished_at, failure_code, outcome_known, http_status, updated_at)
  ON push_attempts TO pospay_app;