-- ADR-0012 §1–§2 (تعديل 2026-10-22: ستة أنواع): عدّاد أحداث العمولة المعلّقة الذي يقرؤه الاعتماد.
-- pospay_app لا يقرأ outbox أبدًا (لا SELECT عليه)، ويقرأ consumed_events تحت RLS بصلاحياته المعتادة؛ الجديد هنا أن يحصل
-- على عدد واحد يربط الاثنين من دالة SECURITY DEFINER يملكها دور مخصّص، بلا قراءة صفوف outbox.
-- المعامل approval_started_at يجب أن يصل نصًّا بلا فقد دقة ويُحوَّل داخل SQL (`$1::text::timestamptz`): معامل من نوع timestamptz يمرّ
-- في السائق عبر Date الذي يقص الميكروثواني إلى ميلي ثانية، فترفضه الدالة لأنه لا يساوي توقيت معاملتها.
-- الدور pospay_approval_reader يُنشأ وتُثبَّت صفاته وتُشال عضوياته في bootstrapRoles تحت قفل الـ bootstrap قبل أي migration
-- (NOLOGIN، عضو في لا شيء، بلا أعضاء)، ولا يغيّر هذا الملف أي صفة له.
-- ALTER FUNCTION ... OWNER TO في آخر الملف يحتاج أن يكون منفّذ الـ migration هو مالك الـ bootstrap superuser المسجّل استثناءً في
-- ADR-0003 §3 (نفس تسلسل الهجرة 0030 مع pospay_suppression_reader)؛ لا يعمل بدور بلا superuser.
-- CREATE POLICY يأخذ ACCESS EXCLUSIVE على جدوله. المسارات الحيّة التي تكتب في الجدولين في معاملة واحدة تسجّل consumed_events أولًا ثم تكتب في outbox
-- (apps/worker/src/outbox/deliver.ts:73 ثم معالج المستهلك؛ لا كاتب في الـAPI يلمس consumed_events)، فالسياستان هنا بنفس الترتيب كي لا يتبادل قفلا الهجرة والمعاملة الحيّة الانتظار؛ والمهلة القصيرة تجعل الهجرة تفشل سريعًا وتُعاد.
SET LOCAL lock_timeout = '5s';
--> statement-breakpoint
GRANT USAGE ON SCHEMA public TO pospay_approval_reader;
REVOKE CREATE ON SCHEMA public FROM pospay_approval_reader;
GRANT EXECUTE ON FUNCTION public.app_company_id() TO pospay_approval_reader;
GRANT SELECT (company_id, consumer_id, event_id) ON public.consumed_events TO pospay_approval_reader;
GRANT SELECT (company_id, id, event_type, created_at) ON public.outbox TO pospay_approval_reader;
--> statement-breakpoint
CREATE POLICY consumed_events_approval_reader_select ON public.consumed_events FOR SELECT TO pospay_approval_reader
  USING (company_id = public.app_company_id());
--> statement-breakpoint
CREATE POLICY outbox_approval_reader_select ON public.outbox FOR SELECT TO pospay_approval_reader
  USING (company_id = public.app_company_id());
--> statement-breakpoint
-- الأنواع الستة ومعرّف المستهلك مكتوبان هنا حرفيًا لأن الدالة SQL ثابتة بلا تنفيذ ديناميكي؛ اختبار الدالة المثبّتة
-- يقارنها بالثوابت في packages/domain (commission-input-events.ts) حتى لا تنحرف القائمتان.
CREATE FUNCTION public.statement_pending_commission_events(approval_started_at timestamptz) RETURNS bigint
LANGUAGE plpgsql STABLE SECURITY DEFINER NOT LEAKPROOF
SET search_path = pg_catalog, pg_temp SET row_security = on AS $$
DECLARE tenant uuid;
BEGIN
  IF approval_started_at IS NULL OR approval_started_at IS DISTINCT FROM pg_catalog.transaction_timestamp() THEN
    RAISE EXCEPTION 'APPROVAL_CUTOFF_INVALID' USING ERRCODE = '22023';
  END IF;
  tenant := public.app_company_id();
  IF tenant IS NULL THEN
    RAISE EXCEPTION 'TENANT_CONTEXT_MISSING' USING ERRCODE = '22023';
  END IF;
  RETURN (SELECT pg_catalog.count(*) FROM public.outbox o
    WHERE o.company_id = tenant AND o.created_at < approval_started_at
      AND o.event_type IN ('ServiceSessionRecorded', 'ServiceSessionLinesAdded', 'ServiceLineChanged',
        'SessionTipsChanged', 'SalaryChanged', 'PackageSaleChanged')
      AND NOT EXISTS (SELECT 1 FROM public.consumed_events c
        WHERE c.company_id = o.company_id AND c.event_id = o.id
          AND c.consumer_id = 'commissions.project-inputs'));
END $$;
--> statement-breakpoint
ALTER FUNCTION public.statement_pending_commission_events(timestamptz) OWNER TO pospay_approval_reader;
REVOKE ALL ON FUNCTION public.statement_pending_commission_events(timestamptz)
  FROM PUBLIC, pospay_auth, pospay_dispatcher, pospay_notifications, pospay_suppression_reader;
GRANT EXECUTE ON FUNCTION public.statement_pending_commission_events(timestamptz) TO pospay_app;
