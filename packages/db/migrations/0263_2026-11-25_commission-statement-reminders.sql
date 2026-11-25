CREATE TABLE "commission_statement_reminders" (
	"company_id" uuid NOT NULL,
	"id" uuid NOT NULL,
	"business_id" uuid NOT NULL,
	"statement_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"reminder_date" date NOT NULL,
	"recipient_count" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "commission_statement_reminders_pkey" PRIMARY KEY("company_id","id"),
	CONSTRAINT "commission_statement_reminders_once_key" UNIQUE("company_id","statement_id","kind","reminder_date"),
	CONSTRAINT "commission_statement_reminders_kind" CHECK ("commission_statement_reminders"."kind" IN ('REVIEW_DAY3','APPROVAL_DAY3','APPROVAL_DAY5')),
	CONSTRAINT "commission_statement_reminders_recipient_count" CHECK ("commission_statement_reminders"."recipient_count" >= 0)
);
--> statement-breakpoint
CREATE TABLE "operational_recovery_flags" (
	"id" uuid PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"raised_at" timestamp with time zone NOT NULL,
	"cleared_at" timestamp with time zone,
	"cleared_by" uuid,
	CONSTRAINT "operational_recovery_flags_code" CHECK ("operational_recovery_flags"."code" ~ '^[A-Z][A-Z0-9_]{1,99}$'),
	CONSTRAINT "operational_recovery_flags_cleared_pair" CHECK (("operational_recovery_flags"."cleared_at" IS NULL) = ("operational_recovery_flags"."cleared_by" IS NULL))
);
--> statement-breakpoint
ALTER TABLE "commission_statement_reminders" ADD CONSTRAINT "commission_statement_reminders_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commission_statement_reminders" ADD CONSTRAINT "commission_statement_reminders_statement_fk" FOREIGN KEY ("company_id","business_id","statement_id") REFERENCES "public"."commission_statements"("company_id","business_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commission_statement_reminders" ADD CONSTRAINT "commission_statement_reminders_business_fk" FOREIGN KEY ("company_id","business_id") REFERENCES "public"."businesses"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "commission_statement_reminders_statement_idx" ON "commission_statement_reminders" USING btree ("company_id","business_id","statement_id");--> statement-breakpoint
CREATE INDEX "commission_statement_reminders_date_idx" ON "commission_statement_reminders" USING btree ("company_id","reminder_date");--> statement-breakpoint
CREATE UNIQUE INDEX "operational_recovery_flags_open_code_idx" ON "operational_recovery_flags" USING btree ("code") WHERE "operational_recovery_flags"."cleared_at" IS NULL;
--> statement-breakpoint
-- ADR-0061 §1–§3 (إضافة 2026-11-25): جدول التذكيرات وجدول الأعلام التشغيلية ودولا الـdefiner ودوراها.
-- المهلة تجعل الهجرة تفشل سريعًا وتُعاد بدل ما تنتظر معاملة حيّة (CREATE POLICY يأخذ قفلًا قويًا على جدوله)،
-- وSET LOCAL بيخلص مع المعاملة. نقل ملكية الدوال يحتاج منفّذ الهجرة هو الـbootstrap superuser
-- (ADR-0003 §3، كما في 0030 و0242).
SET LOCAL lock_timeout = '5s';
--> statement-breakpoint
-- جدول تذكيرات كشف العمولة: جدول مستأجر (RLS مفروض) للإضافة بس — مفيش UPDATE ولا DELETE لأي دور.
ALTER TABLE public.commission_statement_reminders ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.commission_statement_reminders FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY commission_statement_reminders_app_select ON public.commission_statement_reminders
  FOR SELECT TO pospay_app USING (company_id = public.app_company_id());
--> statement-breakpoint
CREATE POLICY commission_statement_reminders_app_insert ON public.commission_statement_reminders
  FOR INSERT TO pospay_app WITH CHECK (company_id = public.app_company_id());
--> statement-breakpoint
REVOKE ALL ON public.commission_statement_reminders FROM PUBLIC, pospay_app, pospay_auth, pospay_dispatcher;
--> statement-breakpoint
GRANT SELECT, INSERT ON public.commission_statement_reminders TO pospay_app;
--> statement-breakpoint
-- سجل الأعلام التشغيلية: جدول عام بلا RLS. CS-Q31 (و Waleed و أبو سليم، 2026-10-23): دور المرسّل يقرأ ويرفع
-- العلامات، وما فيش UPDATE ولا DELETE ولا TRUNCATE لأي دور تشغيل؛ المسح بدالة definer وحدها (ADR-0061 §1).
REVOKE ALL ON public.operational_recovery_flags FROM PUBLIC, pospay_app, pospay_auth, pospay_dispatcher,
  pospay_notifications, pospay_suppression_reader, pospay_email_suppression_reader,
  pospay_approval_reader, pospay_coverage_issuer;
--> statement-breakpoint
GRANT SELECT, INSERT (id, code, raised_at) ON public.operational_recovery_flags TO pospay_dispatcher;
--> statement-breakpoint
-- دور قراءة معرّفات الشركات (ADR-0061 §1): مالك دالة recovery_company_ids وحده. يقرأ عمود id بس،
-- وما فيهوش SELECT على deleted_at إطلاقًا — الفلتر الوحيد على deleted_at هو في سياسة RLS.
GRANT USAGE ON SCHEMA public TO pospay_recovery_company_reader;
--> statement-breakpoint
REVOKE CREATE ON SCHEMA public FROM pospay_recovery_company_reader;
--> statement-breakpoint
GRANT SELECT (id) ON public.companies TO pospay_recovery_company_reader;
--> statement-breakpoint
CREATE POLICY companies_recovery_select ON public.companies FOR SELECT TO pospay_recovery_company_reader
  USING (deleted_at IS NULL);
--> statement-breakpoint
CREATE FUNCTION public.recovery_company_ids(after_id uuid, page_size integer) RETURNS TABLE(id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp SET row_security = on AS $$
  SELECT c.id FROM public.companies c
  WHERE (after_id IS NULL OR c.id > after_id)
  ORDER BY c.id ASC
  LIMIT GREATEST(1, LEAST(COALESCE(page_size, 1000), 1000))
$$;
--> statement-breakpoint
ALTER FUNCTION public.recovery_company_ids(uuid, integer) OWNER TO pospay_recovery_company_reader;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.recovery_company_ids(uuid, integer) FROM PUBLIC, pospay_app, pospay_auth,
  pospay_notifications, pospay_suppression_reader, pospay_email_suppression_reader,
  pospay_approval_reader, pospay_coverage_issuer;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.recovery_company_ids(uuid, integer) TO pospay_dispatcher;
--> statement-breakpoint
-- دور مسح العلامة (ADR-0061 §1): مالك دالة clear_reminder_schedules_lost_flag وحده. يحدّث عمودين من جدول
-- العلامات ويسجّل سطر تدقيق واحد؛ وما عندوش أي صلاحية على غير كده.
GRANT USAGE ON SCHEMA public TO pospay_recovery_flag_clearer;
--> statement-breakpoint
REVOKE CREATE ON SCHEMA public FROM pospay_recovery_flag_clearer;
--> statement-breakpoint
GRANT SELECT, UPDATE (cleared_at, cleared_by) ON public.operational_recovery_flags TO pospay_recovery_flag_clearer;
--> statement-breakpoint
GRANT INSERT ON public.platform_audit_log TO pospay_recovery_flag_clearer;
--> statement-breakpoint
-- الدالة بترفض المعاملات اللي مش بالشكل قبل أي تعديل (22023): شكل البيانات، مش إثبات إن الاستعادة نجحت (ADR-0061 §1).
CREATE FUNCTION public.clear_reminder_schedules_lost_flag(
  flag_id uuid, rebuilt_run_id text, rebuilt_pass_id uuid, companies_rebuilt integer, audit_id uuid)
RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp SET row_security = on AS $$
BEGIN
  IF flag_id IS NULL OR rebuilt_run_id IS NULL OR rebuilt_pass_id IS NULL
     OR companies_rebuilt IS NULL OR audit_id IS NULL THEN
    RAISE EXCEPTION 'INVALID_RECOVERY_CLEAR_ARGUMENT' USING ERRCODE = '22023';
  END IF;
  IF rebuilt_run_id !~ '^[0-9a-f]{40}$' OR companies_rebuilt < 0 THEN
    RAISE EXCEPTION 'INVALID_RECOVERY_CLEAR_ARGUMENT' USING ERRCODE = '22023';
  END IF;
  UPDATE public.operational_recovery_flags
  SET cleared_at = pg_catalog.now(), cleared_by = '00000000-0000-7000-8000-000000000061'::uuid
  WHERE id = flag_id AND code = 'COMMISSION_REMINDER_SCHEDULES_LOST' AND cleared_at IS NULL;
  IF NOT FOUND THEN
    RETURN false;
  END IF;
  INSERT INTO public.platform_audit_log (id, actor, action, details)
  VALUES (audit_id, 'system:worker', 'recovery.flag_cleared',
    pg_catalog.jsonb_build_object('flag_id', flag_id, 'code', 'COMMISSION_REMINDER_SCHEDULES_LOST',
      'rebuilt_run_id', rebuilt_run_id, 'rebuilt_pass_id', rebuilt_pass_id,
      'companies_rebuilt', companies_rebuilt));
  RETURN true;
END $$;
--> statement-breakpoint
ALTER FUNCTION public.clear_reminder_schedules_lost_flag(uuid, text, uuid, integer, uuid) OWNER TO pospay_recovery_flag_clearer;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.clear_reminder_schedules_lost_flag(uuid, text, uuid, integer, uuid) FROM PUBLIC,
  pospay_app, pospay_auth, pospay_notifications, pospay_suppression_reader,
  pospay_email_suppression_reader, pospay_approval_reader, pospay_coverage_issuer;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.clear_reminder_schedules_lost_flag(uuid, text, uuid, integer, uuid) TO pospay_dispatcher;