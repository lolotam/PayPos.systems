-- مفاتيح الإشعار وقيد الأنواع تقفل companies وbusinesses وalert_rules؛ المهلة القصيرة تجعل الهجرة تفشل سريعاً وتُعاد بدل أن تعلق.
SET LOCAL lock_timeout = '5s';
--> statement-breakpoint
CREATE TABLE "discount_self_approval_notices" (
	"company_id" uuid NOT NULL,
	"id" uuid NOT NULL,
	"business_id" uuid NOT NULL,
	"source_event_id" uuid NOT NULL,
	"decided_at" timestamp with time zone NOT NULL,
	"recipient_count" integer NOT NULL,
	CONSTRAINT "discount_self_approval_notices_pkey" PRIMARY KEY("company_id","id"),
	CONSTRAINT "discount_self_approval_notices_source_event_key" UNIQUE("company_id","source_event_id"),
	CONSTRAINT "discount_self_approval_notices_recipient_count" CHECK ("discount_self_approval_notices"."recipient_count" >= 0)
);
--> statement-breakpoint
ALTER TABLE "alert_rules" DROP CONSTRAINT "alert_rules_kind";--> statement-breakpoint
ALTER TABLE "discount_self_approval_notices" ADD CONSTRAINT "discount_self_approval_notices_company_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discount_self_approval_notices" ADD CONSTRAINT "discount_self_approval_notices_business_fk" FOREIGN KEY ("company_id","business_id") REFERENCES "public"."businesses"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "discount_self_approval_notices_business_fk_idx" ON "discount_self_approval_notices" USING btree ("company_id","business_id");--> statement-breakpoint
ALTER TABLE "alert_rules" ADD CONSTRAINT "alert_rules_kind" CHECK ("alert_rules"."kind" IN ('SHIFT_NOT_CLOCKED_IN','SHIFT_BREAK_NOT_RETURNED','SHIFT_BREAK_RETURNED_OTHER_BRANCH','SHIFT_ENDS_SOON','ATTENDANCE_EXCEPTION','DOCUMENT_EXPIRING','LATE_SERVICE_SESSION','SERVICE_LINE_EDITED','SERVICE_LINE_CANCELLED','SERVICE_LINE_PERFORMERS_CHANGED','ATTENDANCE_CHANGE_REQUESTED','ATTENDANCE_CHANGE_DECIDED','STATEMENT_AWAITING_REVIEW','STATEMENT_AWAITING_APPROVAL','DISCOUNT_SELF_APPROVED'));
--> statement-breakpoint
ALTER TABLE discount_self_approval_notices ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE discount_self_approval_notices FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY discount_self_approval_notices_select ON discount_self_approval_notices FOR SELECT TO pospay_app
  USING (company_id = app_company_id());
--> statement-breakpoint
CREATE POLICY discount_self_approval_notices_insert ON discount_self_approval_notices FOR INSERT TO pospay_app
  WITH CHECK (company_id = app_company_id());
--> statement-breakpoint
REVOKE ALL ON discount_self_approval_notices FROM PUBLIC, pospay_app, pospay_auth, pospay_dispatcher;
--> statement-breakpoint
GRANT SELECT, INSERT ON discount_self_approval_notices TO pospay_app;