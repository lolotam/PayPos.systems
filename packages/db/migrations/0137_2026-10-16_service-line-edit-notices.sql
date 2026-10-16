CREATE TABLE "service_line_edit_notices" (
	"company_id" uuid NOT NULL,
	"id" uuid NOT NULL,
	"business_id" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"line_id" uuid NOT NULL,
	"revision" integer NOT NULL,
	"source_event_id" uuid NOT NULL,
	"decided_at" timestamp with time zone NOT NULL,
	"recipient_count" integer NOT NULL,
	CONSTRAINT "service_line_edit_notices_company_id_id_pk" PRIMARY KEY("company_id","id"),
	CONSTRAINT "service_line_edit_notices_line_revision_key" UNIQUE("company_id","line_id","revision"),
	CONSTRAINT "service_line_edit_notices_recipient_count" CHECK ("service_line_edit_notices"."recipient_count" >= 0)
);
--> statement-breakpoint
ALTER TABLE "service_line_edit_notices" ADD CONSTRAINT "service_line_edit_notices_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_line_edit_notices" ADD CONSTRAINT "service_line_edit_notices_session_fk" FOREIGN KEY ("company_id","business_id","session_id") REFERENCES "public"."service_sessions"("company_id","business_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_line_edit_notices" ADD CONSTRAINT "service_line_edit_notices_line_fk" FOREIGN KEY ("company_id","business_id","line_id") REFERENCES "public"."service_lines"("company_id","business_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "service_line_edit_notices_session_fk_idx" ON "service_line_edit_notices" USING btree ("company_id","business_id","session_id");--> statement-breakpoint
CREATE INDEX "service_line_edit_notices_line_fk_idx" ON "service_line_edit_notices" USING btree ("company_id","business_id","line_id");
--> statement-breakpoint
ALTER TABLE service_line_edit_notices ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE service_line_edit_notices FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY service_line_edit_notices_tenant ON service_line_edit_notices FOR ALL TO pospay_app
USING (company_id = app_company_id()) WITH CHECK (company_id = app_company_id());
--> statement-breakpoint
REVOKE ALL ON service_line_edit_notices FROM PUBLIC, pospay_app, pospay_auth, pospay_dispatcher;
--> statement-breakpoint
GRANT SELECT, INSERT ON service_line_edit_notices TO pospay_app;