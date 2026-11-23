CREATE TABLE "commission_coverage_proofs" (
	"company_id" uuid NOT NULL,
	"id" uuid NOT NULL,
	"generation" bigint NOT NULL,
	"version" integer NOT NULL,
	"business_ids" uuid[] NOT NULL,
	"tip_from" date NOT NULL,
	"tip_to" date NOT NULL,
	"tip_day_bound" date NOT NULL,
	"counted_types" text[] NOT NULL,
	"consumer_id" text NOT NULL,
	"report_through_id" uuid,
	"verified_through_id" uuid,
	"database_name" text NOT NULL,
	"system_id" bigint NOT NULL,
	"issued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"run_id" text NOT NULL,
	"release" text NOT NULL,
	"issued_by" text NOT NULL,
	CONSTRAINT "commission_coverage_proofs_pkey" PRIMARY KEY("company_id","id"),
	CONSTRAINT "commission_coverage_proofs_generation_key" UNIQUE("company_id","generation"),
	CONSTRAINT "commission_coverage_proofs_generation" CHECK ("commission_coverage_proofs"."generation" >= 1),
	CONSTRAINT "commission_coverage_proofs_version" CHECK ("commission_coverage_proofs"."version" >= 1),
	CONSTRAINT "commission_coverage_proofs_businesses" CHECK (cardinality("commission_coverage_proofs"."business_ids") >= 1),
	CONSTRAINT "commission_coverage_proofs_tip_range" CHECK ("commission_coverage_proofs"."tip_from" <= "commission_coverage_proofs"."tip_to"),
	CONSTRAINT "commission_coverage_proofs_labels" CHECK (char_length("commission_coverage_proofs"."run_id") BETWEEN 1 AND 100 AND char_length("commission_coverage_proofs"."release") BETWEEN 1 AND 100
        AND char_length("commission_coverage_proofs"."issued_by") BETWEEN 1 AND 100)
);
--> statement-breakpoint
CREATE TABLE "commission_coverage_state" (
	"company_id" uuid NOT NULL,
	"id" uuid NOT NULL,
	"generation" bigint DEFAULT 0 NOT NULL,
	"bumped_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reason" text DEFAULT 'ENSURE' NOT NULL,
	CONSTRAINT "commission_coverage_state_pkey" PRIMARY KEY("company_id","id"),
	CONSTRAINT "commission_coverage_state_company_key" UNIQUE("company_id"),
	CONSTRAINT "commission_coverage_state_generation" CHECK ("commission_coverage_state"."generation" >= 0),
	CONSTRAINT "commission_coverage_state_reason" CHECK ("commission_coverage_state"."reason" ~ '^[A-Z][A-Z_]{1,49}$')
);
--> statement-breakpoint
ALTER TABLE "commission_coverage_proofs" ADD CONSTRAINT "commission_coverage_proofs_state_fk" FOREIGN KEY ("company_id") REFERENCES "public"."commission_coverage_state"("company_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commission_coverage_state" ADD CONSTRAINT "commission_coverage_state_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
-- ADR-0054 (إضافة 2026-11-22): إثبات تغطية البيانات القديمة. الجدولان أعلاه والدور pospay_coverage_issuer (يُنشأ في bootstrapRoles
-- تحت القفل ولا يغيّر هذا الملف صفاته) والدوال والتريغرات هنا. نقل ملكية الدوال يحتاج منفّذ الهجرة هو الـbootstrap superuser
-- (ADR-0003 §3، كما في 0030 و0242). المهلة تجعل الهجرة تفشل سريعًا وتُعاد بدل أن تنتظر معاملة حيّة (CREATE POLICY وCREATE TRIGGER
-- يأخذان قفلًا قويًا على جدولهما)، وسياسات الجداول الحيّة بترتيب consumed_events ثم outbox كما في 0242.
SET LOCAL lock_timeout = '5s';
--> statement-breakpoint
CREATE FUNCTION public.commission_coverage_required_version() RETURNS integer
LANGUAGE sql STABLE SET search_path = pg_catalog AS $$ SELECT 1 $$;
--> statement-breakpoint
ALTER FUNCTION public.commission_coverage_required_version() OWNER TO pospay_coverage_issuer;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.commission_coverage_required_version() FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.commission_coverage_required_version() TO pospay_app, pospay_coverage_issuer;
--> statement-breakpoint
ALTER TABLE public.commission_coverage_state ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.commission_coverage_state FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.commission_coverage_proofs ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.commission_coverage_proofs FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
GRANT USAGE ON SCHEMA public TO pospay_coverage_issuer;
--> statement-breakpoint
REVOKE CREATE ON SCHEMA public FROM pospay_coverage_issuer;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.app_company_id() TO pospay_coverage_issuer;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.pospay_system_id() TO pospay_coverage_issuer;
--> statement-breakpoint
GRANT SELECT, INSERT ON public.commission_coverage_state, public.commission_coverage_proofs TO pospay_coverage_issuer;
--> statement-breakpoint
GRANT UPDATE (generation, bumped_at, reason) ON public.commission_coverage_state TO pospay_coverage_issuer;
--> statement-breakpoint
CREATE POLICY commission_coverage_state_issuer_select ON public.commission_coverage_state FOR SELECT TO pospay_coverage_issuer
  USING (company_id = public.app_company_id());
--> statement-breakpoint
CREATE POLICY commission_coverage_state_issuer_insert ON public.commission_coverage_state FOR INSERT TO pospay_coverage_issuer
  WITH CHECK (company_id = public.app_company_id());
--> statement-breakpoint
CREATE POLICY commission_coverage_state_issuer_update ON public.commission_coverage_state FOR UPDATE TO pospay_coverage_issuer
  USING (company_id = public.app_company_id()) WITH CHECK (company_id = public.app_company_id());
--> statement-breakpoint
CREATE POLICY commission_coverage_proofs_issuer_select ON public.commission_coverage_proofs FOR SELECT TO pospay_coverage_issuer
  USING (company_id = public.app_company_id());
--> statement-breakpoint
CREATE POLICY commission_coverage_proofs_issuer_insert ON public.commission_coverage_proofs FOR INSERT TO pospay_coverage_issuer
  WITH CHECK (company_id = public.app_company_id());
--> statement-breakpoint
GRANT SELECT (company_id, consumer_id, event_id) ON public.consumed_events TO pospay_coverage_issuer;
--> statement-breakpoint
CREATE POLICY consumed_events_coverage_issuer_select ON public.consumed_events FOR SELECT TO pospay_coverage_issuer
  USING (company_id = public.app_company_id());
--> statement-breakpoint
GRANT SELECT (company_id, id, event_type) ON public.outbox TO pospay_coverage_issuer;
--> statement-breakpoint
CREATE POLICY outbox_coverage_issuer_select ON public.outbox FOR SELECT TO pospay_coverage_issuer
  USING (company_id = public.app_company_id());
--> statement-breakpoint
GRANT SELECT (company_id, id) ON public.businesses TO pospay_coverage_issuer;
--> statement-breakpoint
CREATE POLICY businesses_coverage_issuer_select ON public.businesses FOR SELECT TO pospay_coverage_issuer
  USING (company_id = public.app_company_id());
--> statement-breakpoint
GRANT SELECT (id, deleted_at) ON public.companies TO pospay_coverage_issuer;
--> statement-breakpoint
CREATE POLICY companies_coverage_issuer_select ON public.companies FOR SELECT TO pospay_coverage_issuer
  USING (id = public.app_company_id());
--> statement-breakpoint
-- دوال الـdefiner. الأنواع الستة ومعرّف المستهلك مكتوبة حرفيًا هنا (دالة ثابتة بلا تنفيذ ديناميكي)؛ اختبار التكافؤ يقارنها بثوابت
-- packages/domain والدالة المثبّتة، والهجرة التي تغيّر أيًّا منها تستبدل هذه الدالة وتريغر outbox ودالة العدّ معًا (إضافة ADR-0054 §5).
CREATE FUNCTION public.current_commission_coverage_generation(p_company uuid, p_state_id uuid)
RETURNS TABLE (out_generation bigint, out_database_name text, out_system_id bigint)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp SET row_security = on AS $$
BEGIN
  PERFORM pg_catalog.set_config('app.company_id', p_company::text, true);
  IF NOT EXISTS (SELECT 1 FROM public.companies c WHERE c.id = p_company AND c.deleted_at IS NULL) THEN
    RAISE EXCEPTION 'COVERAGE_COMPANY_NOT_FOUND' USING ERRCODE = '55000';
  END IF;
  INSERT INTO public.commission_coverage_state (company_id, id) VALUES (p_company, p_state_id)
    ON CONFLICT (company_id) DO NOTHING;
  RETURN QUERY SELECT s.generation, pg_catalog.current_database()::text, public.pospay_system_id()
    FROM public.commission_coverage_state s WHERE s.company_id = p_company;
END $$;
--> statement-breakpoint
CREATE FUNCTION public.issue_commission_coverage_proof(
  p_company uuid, p_proof_id uuid, p_expected_generation bigint, p_version integer, p_business_ids uuid[],
  p_tip_from date, p_tip_to date, p_verified_tip_bound date, p_report_through_id uuid,
  p_report_database text, p_report_system_id bigint, p_run_id text, p_release text)
RETURNS bigint
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp SET row_security = on AS $$
DECLARE
  counted constant text[] := ARRAY['ServiceSessionRecorded', 'ServiceSessionLinesAdded', 'ServiceLineChanged',
    'SessionTipsChanged', 'SalaryChanged', 'PackageSaleChanged'];
  consumer constant text := 'commissions.project-inputs';
  current_generation bigint;
  verified_through uuid;
  company_businesses uuid[];
  tip_bound date;
  next_generation bigint;
BEGIN
  PERFORM pg_catalog.set_config('app.company_id', p_company::text, true);
  IF NOT EXISTS (SELECT 1 FROM public.companies c WHERE c.id = p_company AND c.deleted_at IS NULL) THEN
    RAISE EXCEPTION 'COVERAGE_COMPANY_NOT_FOUND' USING ERRCODE = '55000';
  END IF;
  SELECT s.generation INTO current_generation FROM public.commission_coverage_state s
    WHERE s.company_id = p_company FOR UPDATE;
  IF p_report_database IS DISTINCT FROM pg_catalog.current_database()::text
     OR p_report_system_id IS DISTINCT FROM public.pospay_system_id() THEN
    RAISE EXCEPTION 'COVERAGE_DATABASE_MISMATCH' USING ERRCODE = '55000';
  END IF;
  SELECT coalesce(pg_catalog.array_agg(b.id ORDER BY b.id), ARRAY[]::uuid[]) INTO company_businesses
    FROM public.businesses b WHERE b.company_id = p_company;
  IF p_business_ids IS NULL OR pg_catalog.cardinality(company_businesses) = 0
     OR company_businesses IS DISTINCT FROM (SELECT pg_catalog.array_agg(x ORDER BY x) FROM pg_catalog.unnest(p_business_ids) AS x) THEN
    RAISE EXCEPTION 'COVERAGE_SCOPE_INCOMPLETE' USING ERRCODE = '55000';
  END IF;
  SELECT o.id INTO verified_through FROM public.outbox o
    WHERE o.company_id = p_company AND o.event_type = ANY (counted) ORDER BY o.id DESC LIMIT 1;
  IF p_report_through_id IS NOT NULL AND (verified_through IS NULL OR p_report_through_id > verified_through) THEN
    RAISE EXCEPTION 'COVERAGE_REPORT_BOUND_AHEAD' USING ERRCODE = '55000';
  END IF;
  IF verified_through IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.outbox o WHERE o.company_id = p_company AND o.event_type = ANY (counted) AND o.id <= verified_through
      AND NOT EXISTS (SELECT 1 FROM public.consumed_events c WHERE c.company_id = o.company_id
        AND c.event_id = o.id AND c.consumer_id = consumer)) THEN
    RAISE EXCEPTION 'COVERAGE_UNMARKED_EVENTS' USING ERRCODE = '55000';
  END IF;
  IF p_version IS DISTINCT FROM public.commission_coverage_required_version() THEN
    RAISE EXCEPTION 'COVERAGE_VERSION_REFUSED' USING ERRCODE = '55000';
  END IF;
  IF p_tip_from IS NULL OR p_tip_to IS NULL OR p_tip_from > p_tip_to THEN
    RAISE EXCEPTION 'COVERAGE_SCOPE_INCOMPLETE' USING ERRCODE = '55000';
  END IF;
  IF current_generation IS NULL OR current_generation IS DISTINCT FROM p_expected_generation THEN
    RAISE EXCEPTION 'COVERAGE_GENERATION_MOVED' USING ERRCODE = '55000';
  END IF;
  tip_bound := (pg_catalog.clock_timestamp() AT TIME ZONE 'UTC')::date + 1;
  IF p_verified_tip_bound IS DISTINCT FROM tip_bound THEN
    RAISE EXCEPTION 'COVERAGE_TIP_BOUND_MOVED' USING ERRCODE = '55000';
  END IF;
  IF p_tip_to < tip_bound THEN
    RAISE EXCEPTION 'COVERAGE_SCOPE_INCOMPLETE' USING ERRCODE = '55000';
  END IF;
  UPDATE public.commission_coverage_state SET generation = generation + 1, bumped_at = pg_catalog.clock_timestamp(),
    reason = 'ISSUED' WHERE company_id = p_company RETURNING generation INTO next_generation;
  INSERT INTO public.commission_coverage_proofs (company_id, id, generation, version, business_ids, tip_from, tip_to,
    tip_day_bound, counted_types, consumer_id, report_through_id, verified_through_id, database_name, system_id,
    run_id, release, issued_by)
  VALUES (p_company, p_proof_id, next_generation, p_version, company_businesses, p_tip_from, p_tip_to, tip_bound,
    counted, consumer, p_report_through_id, verified_through, pg_catalog.current_database()::text,
    public.pospay_system_id(), p_run_id, p_release, session_user::text);
  RETURN next_generation;
END $$;
--> statement-breakpoint
CREATE FUNCTION public.read_commission_coverage_gate(p_state_id uuid)
RETURNS TABLE (out_version integer, out_business_ids uuid[], out_tip_from date, out_tip_to date, out_tip_day_bound date,
  out_counted_types text[], out_consumer_id text, out_database_name text, out_system_id bigint)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp SET row_security = on AS $$
DECLARE tenant uuid;
BEGIN
  tenant := public.app_company_id();
  IF tenant IS NULL THEN
    RAISE EXCEPTION 'TENANT_CONTEXT_MISSING' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.commission_coverage_state (company_id, id) VALUES (tenant, p_state_id)
    ON CONFLICT (company_id) DO NOTHING;
  PERFORM 1 FROM public.commission_coverage_state s WHERE s.company_id = tenant FOR SHARE;
  RETURN QUERY SELECT p.version, p.business_ids, p.tip_from, p.tip_to, p.tip_day_bound, p.counted_types,
    p.consumer_id, p.database_name, p.system_id
    FROM public.commission_coverage_proofs p
    JOIN public.commission_coverage_state s ON s.company_id = p.company_id AND s.generation = p.generation
    WHERE p.company_id = tenant;
END $$;
--> statement-breakpoint
CREATE FUNCTION public.invalidate_commission_coverage(p_state_id uuid, p_reason text) RETURNS bigint
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp SET row_security = on AS $$
DECLARE
  tenant uuid;
  next_generation bigint;
BEGIN
  tenant := public.app_company_id();
  IF tenant IS NULL THEN
    RAISE EXCEPTION 'TENANT_CONTEXT_MISSING' USING ERRCODE = '22023';
  END IF;
  IF p_reason IS NULL OR p_reason !~ '^[A-Z][A-Z_]{1,49}$' THEN
    RAISE EXCEPTION 'COVERAGE_REASON_INVALID' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.commission_coverage_state (company_id, id) VALUES (tenant, p_state_id)
    ON CONFLICT (company_id) DO NOTHING;
  UPDATE public.commission_coverage_state SET generation = generation + 1, bumped_at = pg_catalog.clock_timestamp(),
    reason = p_reason WHERE company_id = tenant RETURNING generation INTO next_generation;
  RETURN next_generation;
END $$;
--> statement-breakpoint
ALTER FUNCTION public.current_commission_coverage_generation(uuid, uuid) OWNER TO pospay_coverage_issuer;
--> statement-breakpoint
ALTER FUNCTION public.issue_commission_coverage_proof(uuid, uuid, bigint, integer, uuid[], date, date, date, uuid, text, bigint, text, text) OWNER TO pospay_coverage_issuer;
--> statement-breakpoint
ALTER FUNCTION public.read_commission_coverage_gate(uuid) OWNER TO pospay_coverage_issuer;
--> statement-breakpoint
ALTER FUNCTION public.invalidate_commission_coverage(uuid, text) OWNER TO pospay_coverage_issuer;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.current_commission_coverage_generation(uuid, uuid) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.issue_commission_coverage_proof(uuid, uuid, bigint, integer, uuid[], date, date, date, uuid, text, bigint, text, text) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.read_commission_coverage_gate(uuid) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.invalidate_commission_coverage(uuid, text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.current_commission_coverage_generation(uuid, uuid) TO pospay_dispatcher;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.issue_commission_coverage_proof(uuid, uuid, bigint, integer, uuid[], date, date, date, uuid, text, bigint, text, text) TO pospay_dispatcher;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.read_commission_coverage_gate(uuid) TO pospay_app;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.invalidate_commission_coverage(uuid, text) TO pospay_app;
--> statement-breakpoint
-- تريغرات الرفض: الإثبات للإضافة فقط، وصف الحالة لا يُحذف، وصف outbox من الأنواع الستة لا يُحذف ولا يُقطع (TRUNCATE).
-- تتجاوزها جلسة المالك بـ session_replication_role = replica في تنظيف الاختبارات فقط (إضافة ADR-0054 §5).
CREATE FUNCTION public.refuse_commission_coverage_change() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  RAISE EXCEPTION 'COVERAGE_ROWS_ARE_APPEND_ONLY' USING ERRCODE = '55000';
END $$;
--> statement-breakpoint
CREATE FUNCTION public.refuse_counted_outbox_delete() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF OLD.event_type = ANY (ARRAY['ServiceSessionRecorded', 'ServiceSessionLinesAdded', 'ServiceLineChanged',
    'SessionTipsChanged', 'SalaryChanged', 'PackageSaleChanged']) THEN
    RAISE EXCEPTION 'COUNTED_OUTBOX_DELETE_REFUSED' USING ERRCODE = '55000';
  END IF;
  RETURN OLD;
END $$;
--> statement-breakpoint
CREATE FUNCTION public.refuse_outbox_truncate() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  RAISE EXCEPTION 'COUNTED_OUTBOX_DELETE_REFUSED' USING ERRCODE = '55000';
END $$;
--> statement-breakpoint
ALTER FUNCTION public.refuse_commission_coverage_change() OWNER TO pospay_coverage_issuer;
--> statement-breakpoint
ALTER FUNCTION public.refuse_counted_outbox_delete() OWNER TO pospay_coverage_issuer;
--> statement-breakpoint
ALTER FUNCTION public.refuse_outbox_truncate() OWNER TO pospay_coverage_issuer;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.refuse_commission_coverage_change() FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.refuse_counted_outbox_delete() FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.refuse_outbox_truncate() FROM PUBLIC;
--> statement-breakpoint
CREATE TRIGGER commission_coverage_proofs_append_only BEFORE UPDATE OR DELETE ON public.commission_coverage_proofs
  FOR EACH ROW EXECUTE FUNCTION public.refuse_commission_coverage_change();
--> statement-breakpoint
CREATE TRIGGER commission_coverage_proofs_no_truncate BEFORE TRUNCATE ON public.commission_coverage_proofs
  FOR EACH STATEMENT EXECUTE FUNCTION public.refuse_commission_coverage_change();
--> statement-breakpoint
CREATE TRIGGER commission_coverage_state_no_delete BEFORE DELETE ON public.commission_coverage_state
  FOR EACH ROW EXECUTE FUNCTION public.refuse_commission_coverage_change();
--> statement-breakpoint
CREATE TRIGGER commission_coverage_state_no_truncate BEFORE TRUNCATE ON public.commission_coverage_state
  FOR EACH STATEMENT EXECUTE FUNCTION public.refuse_commission_coverage_change();
--> statement-breakpoint
CREATE TRIGGER outbox_counted_no_delete BEFORE DELETE ON public.outbox
  FOR EACH ROW EXECUTE FUNCTION public.refuse_counted_outbox_delete();
--> statement-breakpoint
CREATE TRIGGER outbox_no_truncate BEFORE TRUNCATE ON public.outbox
  FOR EACH STATEMENT EXECUTE FUNCTION public.refuse_outbox_truncate();
