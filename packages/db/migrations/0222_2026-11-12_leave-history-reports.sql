CREATE TABLE "leave_history_report_rows" (
	"company_id" uuid NOT NULL,
	"report_id" uuid NOT NULL,
	"seq" integer NOT NULL,
	"employee_id" uuid NOT NULL,
	"record" jsonb NOT NULL,
	CONSTRAINT "leave_history_report_rows_pkey" PRIMARY KEY("company_id","report_id","seq"),
	CONSTRAINT "leave_history_report_rows_seq_check" CHECK ("leave_history_report_rows"."seq" >= 1)
);
--> statement-breakpoint
CREATE TABLE "leave_history_reports" (
	"company_id" uuid NOT NULL,
	"id" uuid NOT NULL,
	"business_id" uuid NOT NULL,
	"created_by" uuid NOT NULL,
	"query" jsonb NOT NULL,
	"fingerprint" text NOT NULL,
	"scope" jsonb NOT NULL,
	"as_of" timestamp with time zone NOT NULL,
	"deadline_at" timestamp with time zone NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"error_code" text,
	"row_count" integer DEFAULT 0 NOT NULL,
	"computed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "leave_history_reports_pkey" PRIMARY KEY("company_id","id"),
	CONSTRAINT "leave_history_reports_status_check" CHECK ("leave_history_reports"."status" IN ('pending', 'ready', 'failed')),
	CONSTRAINT "leave_history_reports_row_count_check" CHECK ("leave_history_reports"."row_count" BETWEEN 0 AND 25000),
	CONSTRAINT "leave_history_reports_shape_check" CHECK (("leave_history_reports"."status" = 'pending' AND "leave_history_reports"."error_code" IS NULL AND "leave_history_reports"."computed_at" IS NULL AND "leave_history_reports"."row_count" = 0)
      OR ("leave_history_reports"."status" = 'ready' AND "leave_history_reports"."error_code" IS NULL AND "leave_history_reports"."computed_at" IS NOT NULL)
      OR ("leave_history_reports"."status" = 'failed' AND "leave_history_reports"."error_code" IS NOT NULL AND "leave_history_reports"."row_count" = 0)),
	CONSTRAINT "leave_history_reports_error_code_check" CHECK ("leave_history_reports"."error_code" IS NULL OR "leave_history_reports"."error_code" IN ('LEAVE_HISTORY_REPORT_FAILED', 'LEAVE_HISTORY_REPORT_TOO_LARGE')),
	CONSTRAINT "leave_history_reports_fingerprint_check" CHECK ("leave_history_reports"."fingerprint" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "leave_history_reports_json_size_check" CHECK (octet_length("leave_history_reports"."query"::text) <= 8192 AND octet_length("leave_history_reports"."scope"::text) <= 65536),
	CONSTRAINT "leave_history_reports_deadline_at_check" CHECK ("leave_history_reports"."deadline_at" > "leave_history_reports"."as_of"),
	CONSTRAINT "leave_history_reports_expires_at_check" CHECK ("leave_history_reports"."expires_at" > "leave_history_reports"."as_of")
);
--> statement-breakpoint
ALTER TABLE "leave_history_report_rows" ADD CONSTRAINT "leave_history_report_rows_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_history_report_rows" ADD CONSTRAINT "leave_history_report_rows_report_fk" FOREIGN KEY ("company_id","report_id") REFERENCES "public"."leave_history_reports"("company_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_history_reports" ADD CONSTRAINT "leave_history_reports_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_history_reports" ADD CONSTRAINT "leave_history_reports_business_fk" FOREIGN KEY ("company_id","business_id") REFERENCES "public"."businesses"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_history_reports" ADD CONSTRAINT "leave_history_reports_creator_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "leave_history_reports_business_fk_idx" ON "leave_history_reports" USING btree ("company_id","business_id");--> statement-breakpoint
CREATE INDEX "leave_history_reports_creator_fk_idx" ON "leave_history_reports" USING btree ("created_by");--> statement-breakpoint
CREATE INDEX "leave_history_reports_dedupe_idx" ON "leave_history_reports" USING btree ("company_id","business_id","created_by","fingerprint","deadline_at");--> statement-breakpoint
CREATE INDEX "leave_history_reports_expiry_idx" ON "leave_history_reports" USING btree ("company_id","expires_at");
--> statement-breakpoint
-- تفعيل وفَرض سياسات أمان مستوى الصفوف لعزل تقارير الإجازات وصفوفها لكل شركة.
ALTER TABLE "leave_history_reports" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "leave_history_reports" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "leave_history_report_rows" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "leave_history_report_rows" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
-- سياسات وصول pospay_app المحصورة بمعرف الشركة الحالي.
CREATE POLICY "leave_history_reports_select" ON "leave_history_reports" FOR SELECT TO pospay_app USING (company_id = app_company_id());
--> statement-breakpoint
CREATE POLICY "leave_history_reports_insert" ON "leave_history_reports" FOR INSERT TO pospay_app WITH CHECK (company_id = app_company_id());
--> statement-breakpoint
CREATE POLICY "leave_history_reports_update" ON "leave_history_reports" FOR UPDATE TO pospay_app USING (company_id = app_company_id()) WITH CHECK (company_id = app_company_id());
--> statement-breakpoint
CREATE POLICY "leave_history_reports_delete" ON "leave_history_reports" FOR DELETE TO pospay_app USING (company_id = app_company_id());
--> statement-breakpoint
CREATE POLICY "leave_history_report_rows_select" ON "leave_history_report_rows" FOR SELECT TO pospay_app USING (company_id = app_company_id());
--> statement-breakpoint
CREATE POLICY "leave_history_report_rows_insert" ON "leave_history_report_rows" FOR INSERT TO pospay_app WITH CHECK (company_id = app_company_id());
--> statement-breakpoint
-- دالة حراسة وتتبع حالات تقرير سجل الإجازات ومنع التعديل على بيانات الاستعلام بعد إنشائه.
CREATE OR REPLACE FUNCTION leave_history_report_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'pending' OR NEW.row_count <> 0 OR NEW.error_code IS NOT NULL OR NEW.computed_at IS NOT NULL THEN
      RAISE EXCEPTION 'LEAVE_HISTORY_REPORT_INITIAL_STATE_INVALID' USING ERRCODE = '23514';
    END IF;
  ELSIF TG_OP = 'UPDATE' THEN
    IF OLD.status <> 'pending' OR NEW.status NOT IN ('ready', 'failed') THEN
      RAISE EXCEPTION 'LEAVE_HISTORY_REPORT_TRANSITION_INVALID' USING ERRCODE = '23514';
    END IF;
    IF (to_jsonb(NEW) - ARRAY['status', 'error_code', 'row_count', 'computed_at'])
       IS DISTINCT FROM
       (to_jsonb(OLD) - ARRAY['status', 'error_code', 'row_count', 'computed_at']) THEN
      RAISE EXCEPTION 'LEAVE_HISTORY_REPORT_BODY_IMMUTABLE' USING ERRCODE = '23514';
    END IF;
    IF NEW.status = 'ready' THEN
      IF NEW.error_code IS NOT NULL OR NEW.computed_at IS NULL OR NEW.row_count <> (
        SELECT count(*) FROM leave_history_report_rows
        WHERE company_id = NEW.company_id AND report_id = NEW.id
      ) THEN
        RAISE EXCEPTION 'LEAVE_HISTORY_REPORT_ROW_COUNT_MISMATCH' USING ERRCODE = '23514';
      END IF;
    ELSIF NEW.status = 'failed' THEN
      IF NEW.error_code IS NULL OR NEW.row_count <> 0 OR EXISTS (
        SELECT 1 FROM leave_history_report_rows
        WHERE company_id = NEW.company_id AND report_id = NEW.id
      ) THEN
        RAISE EXCEPTION 'LEAVE_HISTORY_REPORT_FAILED_HAS_ROWS' USING ERRCODE = '23514';
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER leave_history_report_guard
BEFORE INSERT OR UPDATE ON leave_history_reports
FOR EACH ROW EXECUTE FUNCTION leave_history_report_guard();
--> statement-breakpoint
-- دالة حراسة منع إدخال صفوف إلا لتقرير معلق وقفل التقرير أثناء الإدخال.
CREATE OR REPLACE FUNCTION leave_history_report_row_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE
  v_status text;
BEGIN
  SELECT status INTO v_status
  FROM leave_history_reports
  WHERE company_id = NEW.company_id AND id = NEW.report_id
  FOR SHARE;

  IF v_status IS NULL OR v_status <> 'pending' THEN
    RAISE EXCEPTION 'LEAVE_HISTORY_REPORT_NOT_PENDING' USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER leave_history_report_row_guard
BEFORE INSERT ON leave_history_report_rows
FOR EACH ROW EXECUTE FUNCTION leave_history_report_row_guard();
--> statement-breakpoint
-- قصر صلاحية تنفيذ دوال الحراسة على تطبيق pospay_app وسحبها من العامة.
REVOKE ALL ON FUNCTION leave_history_report_guard() FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION leave_history_report_guard() TO pospay_app;
--> statement-breakpoint
REVOKE ALL ON FUNCTION leave_history_report_row_guard() FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION leave_history_report_row_guard() TO pospay_app;
--> statement-breakpoint
-- سحب كل الصلاحيات ومنح pospay_app صلاحيات القراءة والإدخال والحذف والتحديث المحدود.
REVOKE ALL ON leave_history_reports FROM PUBLIC, pospay_app, pospay_auth, pospay_dispatcher, pospay_notifications;
--> statement-breakpoint
GRANT SELECT, INSERT, DELETE ON leave_history_reports TO pospay_app;
--> statement-breakpoint
GRANT UPDATE (status, error_code, row_count, computed_at) ON leave_history_reports TO pospay_app;
--> statement-breakpoint
REVOKE ALL ON leave_history_report_rows FROM PUBLIC, pospay_app, pospay_auth, pospay_dispatcher, pospay_notifications;
--> statement-breakpoint
GRANT SELECT, INSERT ON leave_history_report_rows TO pospay_app;
