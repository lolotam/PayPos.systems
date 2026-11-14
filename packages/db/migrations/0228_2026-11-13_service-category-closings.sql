SET LOCAL lock_timeout = '5s';
--> statement-breakpoint
-- طلبات قفل وفتح التصنيفات الكبيرة تُحفظ مع توقع النسخة والعدد ونتيجة التنفيذ، فلا يضيع أثر العملية الخلفية.
CREATE TABLE "service_category_closings" (
	"company_id" uuid NOT NULL,
	"id" uuid NOT NULL,
	"business_id" uuid NOT NULL,
	"category_id" uuid NOT NULL,
	"action" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"expected_revision" integer NOT NULL,
	"expected_service_count" integer NOT NULL,
	"services_changed" integer,
	"error_code" text,
	"requested_by" uuid NOT NULL,
	"requested_at" timestamp with time zone NOT NULL,
	"deadline_at" timestamp with time zone NOT NULL,
	"finished_at" timestamp with time zone,
	CONSTRAINT "service_category_closings_pkey" PRIMARY KEY("company_id","id"),
	CONSTRAINT "service_category_closings_action_check" CHECK ("action" IN ('close', 'reopen')),
	CONSTRAINT "service_category_closings_status_check" CHECK ("status" IN ('pending', 'completed', 'failed')),
	CONSTRAINT "service_category_closings_expected_revision_check" CHECK ("expected_revision" >= 1),
	CONSTRAINT "service_category_closings_expected_service_count_check" CHECK ("expected_service_count" > 0),
	CONSTRAINT "service_category_closings_services_changed_check" CHECK ("services_changed" IS NULL OR "services_changed" >= 0),
	CONSTRAINT "service_category_closings_error_code_check" CHECK ("error_code" IS NULL OR "error_code" IN ('SERVICE_CATEGORY_REVISION_CONFLICT', 'SERVICE_CATEGORY_ALREADY_CLOSED', 'SERVICE_CATEGORY_NOT_CLOSED', 'SERVICE_CATEGORY_COUNT_CHANGED', 'SERVICE_CATEGORY_CLOSING_EXPIRED', 'SERVICE_CATEGORY_CLOSING_FAILED')),
	CONSTRAINT "service_category_closings_deadline_at_check" CHECK ("deadline_at" > "requested_at"),
	CONSTRAINT "service_category_closings_shape_check" CHECK (("status" = 'pending' AND "services_changed" IS NULL AND "error_code" IS NULL AND "finished_at" IS NULL)
      OR ("status" = 'completed' AND "services_changed" IS NOT NULL AND "error_code" IS NULL AND "finished_at" IS NOT NULL)
      OR ("status" = 'failed' AND "services_changed" IS NULL AND "error_code" IS NOT NULL AND "finished_at" IS NOT NULL))
);
--> statement-breakpoint
-- مفاتيح الشركة والتصنيف وطالب العملية تمنع الربط بصفوف خارج نطاقها، والفهارس تخدم سياسة العزل والبحث.
ALTER TABLE "service_category_closings" ADD CONSTRAINT "service_category_closings_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "service_category_closings" ADD CONSTRAINT "service_category_closings_category_fk" FOREIGN KEY ("company_id","business_id","category_id") REFERENCES "public"."service_categories"("company_id","business_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "service_category_closings" ADD CONSTRAINT "service_category_closings_requester_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "service_category_closings_category_idx" ON "service_category_closings" USING btree ("company_id","business_id","category_id");
--> statement-breakpoint
CREATE INDEX "service_category_closings_requester_idx" ON "service_category_closings" USING btree ("requested_by");
--> statement-breakpoint
-- الفهرس الجزئي يمنع وجود أكثر من عملية معلقة واحدة للتصنيف داخل الشركة.
CREATE UNIQUE INDEX "service_category_closings_one_pending_uq" ON "service_category_closings" USING btree ("company_id","category_id") WHERE "status" = 'pending';
--> statement-breakpoint
-- تفعيل وفَرض سياسات أمان مستوى الصفوف لعزل طلبات القفل والفتح لكل شركة.
ALTER TABLE "service_category_closings" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "service_category_closings" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
-- سياسات pospay_app محصورة بمعرف الشركة الحالي، ولا توجد سياسة حذف لأن سجل العملية محفوظ.
CREATE POLICY "service_category_closings_select" ON "service_category_closings" FOR SELECT TO pospay_app USING (company_id = app_company_id());
--> statement-breakpoint
CREATE POLICY "service_category_closings_insert" ON "service_category_closings" FOR INSERT TO pospay_app WITH CHECK (company_id = app_company_id());
--> statement-breakpoint
CREATE POLICY "service_category_closings_update" ON "service_category_closings" FOR UPDATE TO pospay_app USING (company_id = app_company_id()) WITH CHECK (company_id = app_company_id());
--> statement-breakpoint
-- حارس الانتقال يقبل الإنشاء معلقاً فقط، ويثبت بيانات الطلب عند الانتقال إلى نتيجة نهائية.
CREATE OR REPLACE FUNCTION service_category_closing_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'pending' THEN
      RAISE EXCEPTION 'SERVICE_CATEGORY_CLOSING_TRANSITION_INVALID' USING ERRCODE = '23514';
    END IF;
  ELSIF TG_OP = 'UPDATE' THEN
    IF OLD.status <> 'pending' OR NEW.status NOT IN ('completed', 'failed') THEN
      RAISE EXCEPTION 'SERVICE_CATEGORY_CLOSING_TRANSITION_INVALID' USING ERRCODE = '23514';
    END IF;
    IF NEW.company_id IS DISTINCT FROM OLD.company_id
      OR NEW.id IS DISTINCT FROM OLD.id
      OR NEW.business_id IS DISTINCT FROM OLD.business_id
      OR NEW.category_id IS DISTINCT FROM OLD.category_id
      OR NEW.action IS DISTINCT FROM OLD.action
      OR NEW.expected_revision IS DISTINCT FROM OLD.expected_revision
      OR NEW.expected_service_count IS DISTINCT FROM OLD.expected_service_count
      OR NEW.requested_by IS DISTINCT FROM OLD.requested_by
      OR NEW.requested_at IS DISTINCT FROM OLD.requested_at
      OR NEW.deadline_at IS DISTINCT FROM OLD.deadline_at THEN
      RAISE EXCEPTION 'SERVICE_CATEGORY_CLOSING_TRANSITION_INVALID' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER service_category_closing_guard
BEFORE INSERT OR UPDATE ON service_category_closings
FOR EACH ROW EXECUTE FUNCTION service_category_closing_guard();
--> statement-breakpoint
-- تنفيذ الحارس متاح للتطبيق فقط بعد سحبه من العامة، مثل حُرّاس العمليات الخلفية الأخرى.
REVOKE ALL ON FUNCTION service_category_closing_guard() FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION service_category_closing_guard() TO pospay_app;
--> statement-breakpoint
-- سحب الصلاحيات الافتراضية وقصر القراءة والإدخال والتحديث في أعمدة النتيجة على pospay_app.
REVOKE ALL ON service_category_closings FROM PUBLIC, pospay_app, pospay_auth, pospay_dispatcher, pospay_notifications;
--> statement-breakpoint
GRANT SELECT, INSERT ON service_category_closings TO pospay_app;
--> statement-breakpoint
GRANT UPDATE (status, services_changed, error_code, finished_at) ON service_category_closings TO pospay_app;
