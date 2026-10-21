-- قواعد التنبيه (spec 060 D-B13): DELETE لصفوف الفروع بس (رجوع الفرع لقاعدة النشاط)، والتعديل على أعمدة القاعدة بس.
CREATE TABLE "alert_rules" (
	"company_id" uuid NOT NULL,
	"id" uuid NOT NULL,
	"business_id" uuid NOT NULL,
	"branch_id" uuid,
	"kind" text NOT NULL,
	"enabled" boolean NOT NULL,
	"recipient_roles" text[] NOT NULL,
	"channels" text[] NOT NULL,
	"delay_minutes" integer,
	"lead_minutes" integer,
	"updated_by" uuid NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revision" integer NOT NULL,
	CONSTRAINT "alert_rules_pkey" PRIMARY KEY("company_id","id"),
	CONSTRAINT "alert_rules_kind" CHECK ("alert_rules"."kind" IN ('SHIFT_NOT_CLOCKED_IN','SHIFT_BREAK_NOT_RETURNED','SHIFT_BREAK_RETURNED_OTHER_BRANCH','SHIFT_ENDS_SOON','ATTENDANCE_EXCEPTION','DOCUMENT_EXPIRING','LATE_SERVICE_SESSION','SERVICE_LINE_EDITED','SERVICE_LINE_CANCELLED','SERVICE_LINE_PERFORMERS_CHANGED','ATTENDANCE_CHANGE_REQUESTED','ATTENDANCE_CHANGE_DECIDED','STATEMENT_AWAITING_REVIEW','STATEMENT_AWAITING_APPROVAL')),
	CONSTRAINT "alert_rules_recipient_roles" CHECK ("alert_rules"."recipient_roles" <@ ARRAY['owner','general_manager','business_manager','branch_manager']::text[]),
	CONSTRAINT "alert_rules_channels" CHECK ("alert_rules"."channels" <@ ARRAY['IN_APP']::text[]),
	CONSTRAINT "alert_rules_delay_minutes" CHECK ("alert_rules"."delay_minutes" IS NULL OR "alert_rules"."delay_minutes" BETWEEN 1 AND 1440),
	CONSTRAINT "alert_rules_lead_minutes" CHECK ("alert_rules"."lead_minutes" IS NULL OR "alert_rules"."lead_minutes" BETWEEN 1 AND 1440),
	CONSTRAINT "alert_rules_document_lead" CHECK ("alert_rules"."kind" <> 'DOCUMENT_EXPIRING' OR "alert_rules"."lead_minutes" IS NULL),
	CONSTRAINT "alert_rules_revision" CHECK ("alert_rules"."revision" >= 1)
);
--> statement-breakpoint
ALTER TABLE "business_settings" ADD COLUMN "alerts_enabled" boolean;--> statement-breakpoint
ALTER TABLE "alert_rules" ADD CONSTRAINT "alert_rules_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alert_rules" ADD CONSTRAINT "alert_rules_business_fk" FOREIGN KEY ("company_id","business_id") REFERENCES "public"."businesses"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alert_rules" ADD CONSTRAINT "alert_rules_branch_fk" FOREIGN KEY ("company_id","business_id","branch_id") REFERENCES "public"."branches"("company_id","business_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "alert_rules_business_kind_key" ON "alert_rules" USING btree ("company_id","business_id","kind") WHERE "alert_rules"."branch_id" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "alert_rules_branch_kind_key" ON "alert_rules" USING btree ("company_id","branch_id","kind") WHERE "alert_rules"."branch_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "alert_rules_branch_fk_idx" ON "alert_rules" USING btree ("company_id","business_id","branch_id");--> statement-breakpoint
CREATE INDEX "alert_rules_updated_by_idx" ON "alert_rules" USING btree ("updated_by");--> statement-breakpoint
ALTER TABLE alert_rules ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE alert_rules FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY alert_rules_select ON alert_rules FOR SELECT TO pospay_app
  USING (company_id = app_company_id());
--> statement-breakpoint
CREATE POLICY alert_rules_insert ON alert_rules FOR INSERT TO pospay_app
  WITH CHECK (company_id = app_company_id());
--> statement-breakpoint
CREATE POLICY alert_rules_update ON alert_rules FOR UPDATE TO pospay_app
  USING (company_id = app_company_id()) WITH CHECK (company_id = app_company_id());
--> statement-breakpoint
CREATE POLICY alert_rules_delete ON alert_rules FOR DELETE TO pospay_app
  USING (company_id = app_company_id() AND branch_id IS NOT NULL);
--> statement-breakpoint
REVOKE ALL ON alert_rules FROM PUBLIC, pospay_app, pospay_auth, pospay_dispatcher;
--> statement-breakpoint
GRANT SELECT, INSERT, DELETE ON alert_rules TO pospay_app;
--> statement-breakpoint
GRANT UPDATE (enabled, recipient_roles, channels, delay_minutes, lead_minutes, updated_by, updated_at, revision)
  ON alert_rules TO pospay_app;
