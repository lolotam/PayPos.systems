-- spec 060 صف 62b-1 (AL-Q6، ADR-0003 §6a، ADR-0018 §11): توسيع قنوات قواعد التنبيه بـ EMAIL وWHATSAPP، وقراءة جهات اتصال الفريق المحدودة.
-- القيد alert_rules_channels يُستبدل بنسخة أوسع NOT VALID (قفل ACCESS EXCLUSIVE قصير دون مسح)، وVALIDATE في الملف 0270 التالي (CLAUDE.md §10، V3.33).
-- الدور pospay_team_contact_reader يُنشأ وتُثبَّت صفاته وتُشال عضوياته في bootstrapRoles تحت قفل الـ bootstrap قبل أي migration
-- (NOLOGIN، عضو في لا شيء، بلا أعضاء)، ولا يغيّر هذا الملف أي صفة له.
-- الدالة تُنقل ملكيتها للدور في آخر الملف، وهذا يحتاج أن يكون منفّذ الـ migration هو مالك الـ bootstrap superuser المسجّل استثناءً في ADR-0003 §3 (كما في 0242).
-- لا صلاحية على جدول "user" كله لأي دور: الأعمدة الستة فقط، والمسار الوحيد لجهة اتصال هو الدالة عبر withTenant.
SET LOCAL lock_timeout = '5s';
--> statement-breakpoint
ALTER TABLE "alert_rules" DROP CONSTRAINT "alert_rules_channels";
--> statement-breakpoint
ALTER TABLE "alert_rules" ADD CONSTRAINT "alert_rules_channels" CHECK ("alert_rules"."channels" <@ ARRAY['IN_APP','EMAIL','WHATSAPP']::text[]) NOT VALID;
--> statement-breakpoint
GRANT USAGE ON SCHEMA public TO pospay_team_contact_reader;
REVOKE CREATE ON SCHEMA public FROM pospay_team_contact_reader;
GRANT EXECUTE ON FUNCTION public.app_company_id() TO pospay_team_contact_reader;
GRANT SELECT (id, email, email_verified, phone_number, phone_binding_approved_at, staff_access_company_id) ON public."user" TO pospay_team_contact_reader;
GRANT SELECT (company_id, user_id, starts_at, ends_at) ON public.memberships TO pospay_team_contact_reader;
--> statement-breakpoint
CREATE POLICY memberships_team_contact_select ON public.memberships FOR SELECT TO pospay_team_contact_reader
  USING (company_id = public.app_company_id());
--> statement-breakpoint
-- EXISTS لا JOIN: عضويات متعددة لنفس المستخدم (نطاقات مختلفة) تعطي سطرًا واحدًا.
-- ends_at > transaction_timestamp() يمنع p_at تاريخيًا من إرجاع جهة اتصال عضو انتهت عضويته فعلًا.
-- p_require_verified_email مفتاح GR-003(d): true = البريد غير الموثّق لا يُعرض (الافتراضي الآمن حتى يؤكد وليد).
CREATE FUNCTION public.team_alert_recipient_contacts(p_company_id uuid, p_user_ids uuid[], p_at timestamptz, p_require_verified_email boolean DEFAULT true)
RETURNS TABLE (user_id uuid, email text, phone_number text)
LANGUAGE plpgsql STABLE SECURITY DEFINER NOT LEAKPROOF
SET search_path = pg_catalog, pg_temp SET row_security = on AS $$
BEGIN
  IF p_company_id IS NULL OR public.app_company_id() IS NULL OR p_company_id IS DISTINCT FROM public.app_company_id() THEN
    RAISE EXCEPTION 'TEAM_CONTACT_TENANT_INVALID' USING ERRCODE = '22023';
  END IF;
  IF p_at IS NULL THEN
    RAISE EXCEPTION 'TEAM_CONTACT_AT_REQUIRED' USING ERRCODE = '22023';
  END IF;
  IF p_user_ids IS NULL OR pg_catalog.cardinality(p_user_ids) > 100 THEN
    RAISE EXCEPTION 'TEAM_CONTACT_USER_IDS_INVALID' USING ERRCODE = '22023';
  END IF;
  IF p_require_verified_email IS NULL THEN
    RAISE EXCEPTION 'TEAM_CONTACT_EMAIL_MODE_REQUIRED' USING ERRCODE = '22023';
  END IF;
  RETURN QUERY
  SELECT c.id, c.contact_email, c.contact_phone FROM (
    SELECT u.id AS id,
      CASE WHEN u.staff_access_company_id IS NULL
        AND pg_catalog.lower(pg_catalog.split_part(u.email, '@', 2)) <> 'staff.pospay.invalid'
        AND (NOT p_require_verified_email OR u.email_verified = true)
        THEN u.email ELSE NULL END AS contact_email,
      CASE WHEN u.phone_number IS NOT NULL AND u.phone_binding_approved_at IS NOT NULL
        THEN u.phone_number ELSE NULL END AS contact_phone
    FROM public."user" u
    WHERE u.id = ANY (p_user_ids)
      AND EXISTS (SELECT 1 FROM public.memberships m
        WHERE m.company_id = p_company_id AND m.user_id = u.id AND m.starts_at <= p_at
          AND (m.ends_at IS NULL OR (m.ends_at > p_at AND m.ends_at > pg_catalog.transaction_timestamp())))
  ) c
  WHERE c.contact_email IS NOT NULL OR c.contact_phone IS NOT NULL
  ORDER BY c.id;
END $$;
--> statement-breakpoint
ALTER FUNCTION public.team_alert_recipient_contacts(uuid, uuid[], timestamptz, boolean) OWNER TO pospay_team_contact_reader;
REVOKE ALL ON FUNCTION public.team_alert_recipient_contacts(uuid, uuid[], timestamptz, boolean)
  FROM PUBLIC, pospay_auth, pospay_dispatcher, pospay_notifications, pospay_suppression_reader, pospay_email_suppression_reader,
    pospay_approval_reader, pospay_coverage_issuer, pospay_recovery_company_reader, pospay_recovery_flag_clearer;
GRANT EXECUTE ON FUNCTION public.team_alert_recipient_contacts(uuid, uuid[], timestamptz, boolean) TO pospay_app;
