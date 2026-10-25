CREATE TABLE "commission_plan_versions" (
	"company_id" uuid NOT NULL,
	"id" uuid NOT NULL,
	"business_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"effective_from" date NOT NULL,
	"whole_period" boolean DEFAULT false NOT NULL,
	"repair_period" char(7),
	"plan" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	CONSTRAINT "commission_plan_versions_pkey" PRIMARY KEY("company_id","id"),
	CONSTRAINT "commission_plan_versions_version_key" UNIQUE("company_id","employee_id","version"),
	CONSTRAINT "commission_plan_versions_version" CHECK ("commission_plan_versions"."version" >= 1),
	CONSTRAINT "commission_plan_versions_whole_or_repair" CHECK (NOT ("commission_plan_versions"."whole_period" AND "commission_plan_versions"."repair_period" IS NOT NULL)),
	CONSTRAINT "commission_plan_versions_repair_period" CHECK ("commission_plan_versions"."repair_period" IS NULL OR ("commission_plan_versions"."repair_period" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$' AND substr("commission_plan_versions"."repair_period",1,4) <> '0000')),
	CONSTRAINT "commission_plan_versions_plan_object" CHECK (jsonb_typeof("commission_plan_versions"."plan") = 'object')
);
--> statement-breakpoint
ALTER TABLE "commission_plan_versions" ADD CONSTRAINT "commission_plan_versions_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commission_plan_versions" ADD CONSTRAINT "commission_plan_versions_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commission_plan_versions" ADD CONSTRAINT "commission_plan_versions_business_fk" FOREIGN KEY ("company_id","business_id") REFERENCES "public"."businesses"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commission_plan_versions" ADD CONSTRAINT "commission_plan_versions_employee_fk" FOREIGN KEY ("company_id","business_id","employee_id") REFERENCES "public"."employees"("company_id","business_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "commission_plan_versions_employee_idx" ON "commission_plan_versions" USING btree ("company_id","business_id","employee_id","version");--> statement-breakpoint
CREATE INDEX "commission_plan_versions_created_by_idx" ON "commission_plan_versions" USING btree ("created_by");
--> statement-breakpoint
-- عزل شركة كل خطة هو آخر خط دفاع، حتى لو وصل معرّف موظف من شركة أخرى.
ALTER TABLE commission_plan_versions ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
-- فرض السياسة يمنع أي مسار تشغيلي من تجاوز عزل المستأجر.
ALTER TABLE commission_plan_versions FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
-- القراءة لا تعرض إلا إصدارات الشركة المرتبطة بالمعاملة الحالية.
CREATE POLICY commission_plan_versions_select ON commission_plan_versions FOR SELECT TO pospay_app
  USING (company_id = app_company_id());
--> statement-breakpoint
-- الإدراج يقبل فقط صفاً يخص الشركة نفسها، فلا يمكن زرع خطة لمستأجر آخر.
CREATE POLICY commission_plan_versions_insert ON commission_plan_versions FOR INSERT TO pospay_app
  WITH CHECK (company_id = app_company_id());
--> statement-breakpoint
-- سجل الخطط تاريخي: لا تعديل ولا حذف؛ كل تغيير يصبح إصداراً جديداً وفق FR-008.
REVOKE ALL ON commission_plan_versions FROM PUBLIC, pospay_app, pospay_auth, pospay_dispatcher;
--> statement-breakpoint
-- التطبيق يحتاج قراءة السجل وإضافة إصدارات فقط، ولا يحصل أي دور آخر على منح.
GRANT SELECT, INSERT ON commission_plan_versions TO pospay_app;