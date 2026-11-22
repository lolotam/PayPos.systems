-- سجل قرارات تنبيه التقييم الواطي وقيد الأنواع (61-1d): القيد يقفل alert_rules؛ المهلة القصيرة تجعل الهجرة تفشل سريعاً وتُعاد بدل أن تعلق.
SET LOCAL lock_timeout = '5s';
--> statement-breakpoint
CREATE TABLE "low_rating_notices" (
	"company_id" uuid NOT NULL,
	"id" uuid NOT NULL,
	"business_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"rating_id" uuid NOT NULL,
	"source_event_id" uuid NOT NULL,
	"decided_at" timestamp with time zone NOT NULL,
	"recipient_count" integer NOT NULL,
	CONSTRAINT "low_rating_notices_pkey" PRIMARY KEY("company_id","id"),
	CONSTRAINT "low_rating_notices_rating_key" UNIQUE("company_id","rating_id"),
	CONSTRAINT "low_rating_notices_recipient_count" CHECK ("low_rating_notices"."recipient_count" >= 0)
);
--> statement-breakpoint
ALTER TABLE "low_rating_notices" ADD CONSTRAINT "low_rating_notices_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "low_rating_notices" ADD CONSTRAINT "low_rating_notices_rating_fk" FOREIGN KEY ("company_id","rating_id") REFERENCES "public"."ratings"("company_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE low_rating_notices ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE low_rating_notices FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY low_rating_notices_select ON low_rating_notices FOR SELECT TO pospay_app
  USING (company_id = app_company_id());
--> statement-breakpoint
CREATE POLICY low_rating_notices_insert ON low_rating_notices FOR INSERT TO pospay_app
  WITH CHECK (company_id = app_company_id());
--> statement-breakpoint
-- القرار نهائي: لا تعديل ولا حذف، فالمنح SELECT وINSERT فقط.
REVOKE ALL ON low_rating_notices FROM PUBLIC, pospay_app, pospay_auth, pospay_dispatcher;
--> statement-breakpoint
GRANT SELECT, INSERT ON low_rating_notices TO pospay_app;
--> statement-breakpoint
-- قفل ACCESS EXCLUSIVE على alert_rules يُؤخذ في الآخر ليُمسك لأقصر وقت ممكن.
-- القيد المُعاد يوسّع القائمة فقط وalert_rules جدول إعدادات صغير، فيُفحص في مكانه دون NOT VALID كـ 0219.
ALTER TABLE "alert_rules" DROP CONSTRAINT "alert_rules_kind";
--> statement-breakpoint
ALTER TABLE "alert_rules" ADD CONSTRAINT "alert_rules_kind" CHECK ("alert_rules"."kind" IN ('SHIFT_NOT_CLOCKED_IN','SHIFT_BREAK_NOT_RETURNED','SHIFT_BREAK_RETURNED_OTHER_BRANCH','SHIFT_ENDS_SOON','ATTENDANCE_EXCEPTION','DOCUMENT_EXPIRING','LATE_SERVICE_SESSION','SERVICE_LINE_EDITED','SERVICE_LINE_CANCELLED','SERVICE_LINE_PERFORMERS_CHANGED','ATTENDANCE_CHANGE_REQUESTED','ATTENDANCE_CHANGE_DECIDED','STATEMENT_AWAITING_REVIEW','STATEMENT_AWAITING_APPROVAL','DISCOUNT_SELF_APPROVED','LOW_RATING'));
