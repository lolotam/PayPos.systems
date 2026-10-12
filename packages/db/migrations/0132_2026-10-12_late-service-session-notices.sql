CREATE INDEX CONCURRENTLY "outbox_service_session_replay_idx" ON "outbox" USING btree ("company_id","id") WHERE "outbox"."event_type" IN ('ServiceSessionRecorded','ServiceSessionLinesAdded');
--> statement-breakpoint
CREATE TABLE "late_service_session_notices" (
	"company_id" uuid NOT NULL,
	"id" uuid NOT NULL,
	"business_id" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"source_event_id" uuid NOT NULL,
	"decided_at" timestamp with time zone NOT NULL,
	"recipient_count" integer NOT NULL,
	CONSTRAINT "late_service_session_notices_company_id_id_pk" PRIMARY KEY("company_id","id"),
	CONSTRAINT "late_service_session_notices_session_key" UNIQUE("company_id","session_id"),
	CONSTRAINT "late_service_session_notices_recipient_count" CHECK ("late_service_session_notices"."recipient_count" >= 0)
);
--> statement-breakpoint
ALTER TABLE "late_service_session_notices" ADD CONSTRAINT "late_service_session_notices_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "late_service_session_notices" ADD CONSTRAINT "late_service_session_notices_session_fk" FOREIGN KEY ("company_id","business_id","session_id") REFERENCES "public"."service_sessions"("company_id","business_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "late_service_session_notices_session_fk_idx" ON "late_service_session_notices" USING btree ("company_id","business_id","session_id");
--> statement-breakpoint
ALTER TABLE late_service_session_notices ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE late_service_session_notices FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY late_service_session_notices_tenant ON late_service_session_notices FOR ALL TO pospay_app
USING (company_id = app_company_id()) WITH CHECK (company_id = app_company_id());
--> statement-breakpoint
REVOKE ALL ON late_service_session_notices FROM PUBLIC, pospay_app, pospay_auth, pospay_dispatcher;
--> statement-breakpoint
GRANT SELECT, INSERT ON late_service_session_notices TO pospay_app;
