-- مفتاح طلبات التقييم للنشاط (spec 060 D-B16، صف 59-2، RT-Q3): صف واحد لكل نشاط بيتخزّن أول ما يتبدّل.
-- requests_enabled NULL يعني مقفول، والصف نفسه ما بيتحذفش — التبديل بيتسجّل في سجل التدقيق.
CREATE TABLE "rating_settings" (
	"company_id" uuid NOT NULL,
	"id" uuid NOT NULL,
	"business_id" uuid NOT NULL,
	"requests_enabled" boolean,
	"updated_by" uuid NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "rating_settings_pkey" PRIMARY KEY("company_id","id"),
	CONSTRAINT "rating_settings_company_business_id_key" UNIQUE("company_id","business_id"),
	CONSTRAINT "rating_settings_revision" CHECK ("rating_settings"."revision" >= 1)
);
--> statement-breakpoint
ALTER TABLE "rating_settings" ADD CONSTRAINT "rating_settings_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rating_settings" ADD CONSTRAINT "rating_settings_business_fk" FOREIGN KEY ("company_id","business_id") REFERENCES "public"."businesses"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "rating_settings_updated_by_idx" ON "rating_settings" USING btree ("updated_by");
--> statement-breakpoint
ALTER TABLE rating_settings ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE rating_settings FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY rating_settings_select ON rating_settings FOR SELECT TO pospay_app
  USING (company_id = app_company_id());
--> statement-breakpoint
CREATE POLICY rating_settings_insert ON rating_settings FOR INSERT TO pospay_app
  WITH CHECK (company_id = app_company_id());
--> statement-breakpoint
CREATE POLICY rating_settings_update ON rating_settings FOR UPDATE TO pospay_app
  USING (company_id = app_company_id()) WITH CHECK (company_id = app_company_id());
--> statement-breakpoint
REVOKE ALL ON rating_settings FROM PUBLIC, pospay_app, pospay_auth, pospay_dispatcher;
--> statement-breakpoint
GRANT SELECT, INSERT ON rating_settings TO pospay_app;
--> statement-breakpoint
GRANT UPDATE (requests_enabled, updated_by, updated_at, revision) ON rating_settings TO pospay_app;
--> statement-breakpoint
-- سبب الإلغاء بيتسع لقيمة جديدة: النشاط قفل طلبات التقييم بعد ما اتجدولت (D-B16).
ALTER TABLE "rating_requests" DROP CONSTRAINT "rating_requests_cancel_reason";
--> statement-breakpoint
ALTER TABLE "rating_requests" ADD CONSTRAINT "rating_requests_cancel_reason" CHECK ("rating_requests"."cancel_reason" IS NULL OR "rating_requests"."cancel_reason" IN ('NO_ACTIVE_LINE','PAST_DEADLINE','OPTED_OUT','REQUESTS_OFF'));
--> statement-breakpoint
-- صلاحية خاصة بالمفتاح ده، مش صلاحية التنبيهات (RT-Q13): المالك وحده افتراضياً، وأي دور بشري ينالها بتفويض.
INSERT INTO permissions(code) VALUES
  ('manage:rating-requests:business')
ON CONFLICT DO NOTHING;
--> statement-breakpoint
INSERT INTO role_permissions(role_id,role_owner_key,company_id,permission_code)
SELECT r.id,'global',NULL,p.code FROM roles r CROSS JOIN permissions p
WHERE r.company_id IS NULL AND r.code='owner' AND p.code='manage:rating-requests:business'
ON CONFLICT DO NOTHING;
