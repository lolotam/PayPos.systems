-- مفاتيح الإشعار تقفل companies وbusinesses؛ المهلة القصيرة تجعل الهجرة تفشل سريعاً وتُعاد بدل أن تعلق.
SET LOCAL lock_timeout = '5s';
--> statement-breakpoint
CREATE TABLE "discount_approval_notices" (
	"company_id" uuid NOT NULL,
	"id" uuid NOT NULL,
	"business_id" uuid NOT NULL,
	"request_id" uuid NOT NULL,
	"source_event_id" uuid NOT NULL,
	"decided_at" timestamp with time zone NOT NULL,
	"recipient_count" integer NOT NULL,
	CONSTRAINT "discount_approval_notices_pkey" PRIMARY KEY("company_id","id"),
	CONSTRAINT "discount_approval_notices_request_key" UNIQUE("company_id","request_id"),
	CONSTRAINT "discount_approval_notices_recipient_count" CHECK ("discount_approval_notices"."recipient_count" >= 0)
);
--> statement-breakpoint
ALTER TABLE "discount_approval_notices" ADD CONSTRAINT "discount_approval_notices_company_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discount_approval_notices" ADD CONSTRAINT "discount_approval_notices_business_fk" FOREIGN KEY ("company_id","business_id") REFERENCES "public"."businesses"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "discount_approval_notices_business_fk_idx" ON "discount_approval_notices" USING btree ("company_id","business_id");
--> statement-breakpoint
ALTER TABLE discount_approval_notices ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE discount_approval_notices FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY discount_approval_notices_select ON discount_approval_notices FOR SELECT TO pospay_app
  USING (company_id = app_company_id());
--> statement-breakpoint
CREATE POLICY discount_approval_notices_insert ON discount_approval_notices FOR INSERT TO pospay_app
  WITH CHECK (company_id = app_company_id());
--> statement-breakpoint
REVOKE ALL ON discount_approval_notices FROM PUBLIC, pospay_app, pospay_auth, pospay_dispatcher;
--> statement-breakpoint
GRANT SELECT, INSERT ON discount_approval_notices TO pospay_app;