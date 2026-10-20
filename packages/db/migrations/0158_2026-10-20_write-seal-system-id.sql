-- الختم لازم يبقى ثابت بعد الاسترجاع: الـ xid بيتحسب من الصفر على cluster جديد، فمعرّف الـ cluster هو اللي يفرّق.
-- القفل على الجداول الحيّة هياخد مهلة قصيرة عشان الهجرة تفشل سريعاً بدل ما تعلق.
SET LOCAL lock_timeout = '5s';
--> statement-breakpoint
-- معرّف الـ cluster بيتقرأ من pg_catalog.pg_control_system() بس، وصلاحية التنفيذ دي لازم تكون موجودة قبل أي ختم.
DO $$
BEGIN
  IF NOT has_function_privilege('pospay_app', 'pg_catalog.pg_control_system()', 'EXECUTE') THEN
    RAISE EXCEPTION 'pospay_app cannot read pg_catalog.pg_control_system(); the write seal cannot be stamped';
  END IF;
END $$;
--> statement-breakpoint
-- الختم = (write_system_id, write_xid). الـ xid لوحده مش كافي: بعد استرجاع dump على cluster جديد العدّاد بيبدأ من الصفر،
-- فلما يوصل لقيمة قديمة معاملة واحدة هتشوف صفاً قديماً كأنه صفها هي.
CREATE FUNCTION public.pospay_system_id() RETURNS bigint
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = pg_catalog AS $$
  SELECT system_identifier FROM pg_catalog.pg_control_system()
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.pospay_system_id() FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.pospay_system_id() TO pospay_app;
--> statement-breakpoint
-- معرّف صفر محجوز للقيمة الافتراضية، فلو الـ cluster نفسه رجع صفر كان الختم هيتلخبط مع الصفوف القديمة.
DO $$
BEGIN
  IF public.pospay_system_id() IS NULL OR public.pospay_system_id() = 0 THEN
    RAISE EXCEPTION 'the cluster system identifier is missing or zero; the write seal cannot be stamped';
  END IF;
END $$;
--> statement-breakpoint
-- القيمة الافتراضية 0: صفر معرّفٌ لا يملكه أي cluster، فالصفوف اللي قبل هذه الهجرة (وكل صفٍّ ما اتختمش) ما بتتحسبش رأس أي معاملة.
-- ثابت كده يعني إن إضافة العمود مش بتعيد كتابة الجدول.
ALTER TABLE session_tip_revisions ADD COLUMN write_system_id bigint NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE service_line_performer_changes ADD COLUMN write_system_id bigint NOT NULL DEFAULT 0;
--> statement-breakpoint
-- الختم بيتختم على كل صف؛ لو المعرّف مش موجود يبقى ده عطل بنية تحتية مش ختم ناقص.
CREATE OR REPLACE FUNCTION session_tip_revisions_begin() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public AS $$
DECLARE sid bigint;
BEGIN
  sid := public.pospay_system_id();
  IF sid IS NULL OR sid = 0 THEN
    RAISE EXCEPTION 'the cluster system identifier is unavailable' USING ERRCODE = '23514', CONSTRAINT = 'session_tip_revisions_seal_stamp';
  END IF;
  NEW.write_system_id := sid;
  NEW.write_xid := pg_current_xact_id();
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION session_tips_insert_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public AS $$
DECLARE sid bigint;
BEGIN
  IF NEW.company_id IS DISTINCT FROM public.app_company_id() THEN
    RETURN NEW;
  END IF;
  sid := public.pospay_system_id();
  IF NOT EXISTS (
    SELECT 1 FROM public.session_tip_revisions AS parent
    WHERE parent.company_id = NEW.company_id
      AND parent.id = NEW.revision_id
      AND parent.write_system_id = sid
      AND parent.write_xid = pg_current_xact_id()
  ) THEN
    RAISE EXCEPTION 'tip revision is not part of this transaction'
      USING ERRCODE = '23514', CONSTRAINT = 'session_tips_current_xact';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION slpc_validate_change(tenant uuid, change_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public AS $$
DECLARE header record; line_rev integer; sid bigint;
BEGIN
  sid := public.pospay_system_id();
  SELECT c.company_id, c.id, c.business_id, c.line_id, c.revision, c.write_xid, c.write_system_id INTO header
  FROM public.service_line_performer_changes c
  WHERE c.company_id = tenant AND c.id = slpc_validate_change.change_id;
  IF NOT FOUND OR header.write_system_id IS DISTINCT FROM sid OR header.write_xid IS DISTINCT FROM pg_current_xact_id() THEN
    RAISE EXCEPTION 'change header is not part of this transaction' USING ERRCODE = '23514', CONSTRAINT = 'slpc_complete';
  END IF;
  SELECT l.revision INTO line_rev FROM public.service_lines l
  WHERE l.company_id = header.company_id AND l.business_id = header.business_id AND l.id = header.line_id;
  IF line_rev IS DISTINCT FROM header.revision THEN
    RAISE EXCEPTION 'line is not at the change target revision' USING ERRCODE = '23514', CONSTRAINT = 'slpc_complete';
  END IF;
  IF NOT public.slpc_side_shape_ok(tenant, header.id, 'BEFORE') OR NOT public.slpc_side_shape_ok(tenant, header.id, 'AFTER') THEN
    RAISE EXCEPTION 'performer change sides are not a valid set' USING ERRCODE = '23514', CONSTRAINT = 'slpc_complete';
  END IF;
  IF NOT public.slpc_tuple_matches(tenant, header.id, 'AFTER', header.line_id) THEN
    RAISE EXCEPTION 'after side does not match the live performers' USING ERRCODE = '23514', CONSTRAINT = 'slpc_complete';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.service_line_performer_change_rows b
    JOIN public.service_line_performer_change_rows a
      ON a.company_id = b.company_id AND a.change_id = b.change_id AND a.employee_id = b.employee_id AND a.side = 'AFTER'
    WHERE b.company_id = tenant AND b.change_id = header.id AND b.side = 'BEFORE'
      AND (a.linked_user_id IS DISTINCT FROM b.linked_user_id OR a.linked_user_snapshotted IS DISTINCT FROM b.linked_user_snapshotted)
  ) THEN
    RAISE EXCEPTION 'kept performer snapshot identity changed' USING ERRCODE = '23514', CONSTRAINT = 'slpc_complete';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.service_line_performer_change_rows a
    WHERE a.company_id = tenant AND a.change_id = header.id AND a.side = 'AFTER' AND NOT a.linked_user_snapshotted
      AND NOT EXISTS (
        SELECT 1 FROM public.service_line_performer_change_rows b
        WHERE b.company_id = a.company_id AND b.change_id = a.change_id AND b.side = 'BEFORE' AND b.employee_id = a.employee_id)
  ) THEN
    RAISE EXCEPTION 'new performer was not snapshotted' USING ERRCODE = '23514', CONSTRAINT = 'slpc_complete';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.service_line_performer_change_rows b
    WHERE b.company_id = tenant AND b.change_id = header.id AND b.side = 'BEFORE' AND NOT b.linked_user_snapshotted
      AND NOT EXISTS (
        SELECT 1 FROM public.service_line_performer_change_rows a
        WHERE a.company_id = b.company_id AND b.change_id = b.change_id AND a.side = 'AFTER' AND a.employee_id = b.employee_id)
  ) THEN
    RAISE EXCEPTION 'removed performer was not snapshotted' USING ERRCODE = '23514', CONSTRAINT = 'slpc_complete';
  END IF;
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION slpc_change_complete() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public AS $$
DECLARE header uuid; sid bigint;
BEGIN
  sid := public.pospay_system_id();
  IF TG_TABLE_NAME = 'service_line_performer_changes' THEN
    PERFORM public.slpc_validate_change(NEW.company_id, NEW.id);
  ELSIF TG_TABLE_NAME = 'service_line_performer_change_rows' THEN
    PERFORM public.slpc_validate_change(NEW.company_id, NEW.change_id);
  ELSIF TG_OP = 'DELETE' THEN
    SELECT c.id INTO header FROM public.service_line_performer_changes c
    WHERE c.company_id = OLD.company_id AND c.line_id = OLD.line_id
      AND c.write_system_id = sid AND c.write_xid = pg_current_xact_id();
    IF NOT FOUND THEN
      RAISE EXCEPTION 'deleting a performer requires a change header at the line target revision'
        USING ERRCODE = '23514', CONSTRAINT = 'line_performers_change_guard';
    END IF;
    PERFORM public.slpc_validate_change(OLD.company_id, header);
  ELSE
    SELECT c.id INTO header FROM public.service_line_performer_changes c
    WHERE c.company_id = NEW.company_id AND c.line_id = NEW.line_id
      AND c.write_system_id = sid AND c.write_xid = pg_current_xact_id();
    IF FOUND THEN PERFORM public.slpc_validate_change(NEW.company_id, header); END IF;
  END IF;
  RETURN NULL;
END $$;
--> statement-breakpoint
-- معرّف الـ cluster بيتختم على كل صف، حتى الصف اللي بره tenancy: الفحص المؤجل بيشتغل على صف الـ owner كمان،
-- فلو الصف بلا معرّف كان الفحص المؤجل هيفشل دايماً ومش هيقدر يكمّل.
CREATE OR REPLACE FUNCTION slpc_begin() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public AS $$
DECLARE line_rev integer; sid bigint;
BEGIN
  sid := public.pospay_system_id();
  IF sid IS NULL OR sid = 0 THEN
    RAISE EXCEPTION 'the cluster system identifier is unavailable' USING ERRCODE = '23514', CONSTRAINT = 'slpc_seal_stamp';
  END IF;
  NEW.write_system_id := sid;
  IF NEW.company_id IS DISTINCT FROM public.app_company_id() THEN RETURN NEW; END IF;
  IF EXISTS (
    SELECT 1 FROM public.service_line_performer_changes c
    WHERE c.company_id = NEW.company_id AND c.line_id = NEW.line_id
      AND c.write_system_id = sid AND c.write_xid = pg_current_xact_id()
  ) THEN
    RAISE EXCEPTION 'only one performer change per line per transaction' USING ERRCODE = '23514', CONSTRAINT = 'slpc_one_line_per_xact';
  END IF;
  SELECT l.revision INTO line_rev FROM public.service_lines l
  WHERE l.company_id = NEW.company_id AND l.business_id = NEW.business_id AND l.id = NEW.line_id
  FOR UPDATE;
  IF NOT FOUND OR line_rev IS DISTINCT FROM NEW.previous_revision THEN
    RAISE EXCEPTION 'line revision does not match the change previous revision' USING ERRCODE = '23514', CONSTRAINT = 'slpc_begin';
  END IF;
  NEW.write_xid := pg_current_xact_id();
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION slpcr_insert_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public AS $$
DECLARE prev integer; target integer; line_rev integer; sid bigint;
BEGIN
  IF NEW.company_id IS DISTINCT FROM public.app_company_id() THEN RETURN NEW; END IF;
  sid := public.pospay_system_id();
  SELECT c.previous_revision, c.revision, l.revision INTO prev, target, line_rev
  FROM public.service_line_performer_changes c
  JOIN public.service_lines l ON l.company_id = c.company_id AND l.business_id = c.business_id AND l.id = c.line_id
  WHERE c.company_id = NEW.company_id AND c.business_id = NEW.business_id AND c.id = NEW.change_id
    AND c.write_system_id = sid AND c.write_xid = pg_current_xact_id();
  IF NOT FOUND THEN
    RAISE EXCEPTION 'side row parent is not a change header of this transaction' USING ERRCODE = '23514', CONSTRAINT = 'slpcr_current_xact';
  END IF;
  IF NEW.side = 'BEFORE' AND line_rev IS DISTINCT FROM prev THEN
    RAISE EXCEPTION 'before rows are closed once the line revision moves' USING ERRCODE = '23514', CONSTRAINT = 'slpcr_side_window';
  ELSIF NEW.side = 'AFTER' AND line_rev IS DISTINCT FROM target THEN
    RAISE EXCEPTION 'after rows open only at the target revision' USING ERRCODE = '23514', CONSTRAINT = 'slpcr_side_window';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION service_lines_performer_transition() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public AS $$
DECLARE header record; sid bigint;
BEGIN
  sid := public.pospay_system_id();
  SELECT c.id, c.previous_revision, c.revision INTO header
  FROM public.service_line_performer_changes c
  WHERE c.company_id = OLD.company_id AND c.line_id = OLD.id
    AND c.write_system_id = sid AND c.write_xid = pg_current_xact_id();
  IF NOT FOUND THEN RETURN NEW; END IF;
  IF OLD.revision IS DISTINCT FROM header.previous_revision OR NEW.revision IS DISTINCT FROM header.revision THEN
    RAISE EXCEPTION 'service line revision does not match the change header' USING ERRCODE = '23514', CONSTRAINT = 'service_lines_performer_transition';
  END IF;
  IF to_jsonb(OLD) - 'revision' - 'has_performer_warning' IS DISTINCT FROM to_jsonb(NEW) - 'revision' - 'has_performer_warning' THEN
    RAISE EXCEPTION 'a performer change may only update revision and has_performer_warning' USING ERRCODE = '23514', CONSTRAINT = 'service_lines_performer_transition';
  END IF;
  IF NOT public.slpc_side_shape_ok(OLD.company_id, header.id, 'BEFORE')
    OR NOT public.slpc_tuple_matches(OLD.company_id, header.id, 'BEFORE', OLD.id) THEN
    RAISE EXCEPTION 'before side does not match the live performers' USING ERRCODE = '23514', CONSTRAINT = 'service_lines_performer_transition';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION line_performers_change_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public AS $$
DECLARE header uuid; line_rev integer; target integer; sid bigint;
BEGIN
  sid := public.pospay_system_id();
  IF TG_OP = 'DELETE' THEN
    IF OLD.company_id IS DISTINCT FROM public.app_company_id() THEN RETURN OLD; END IF;
    SELECT c.id INTO header FROM public.service_line_performer_changes c
    JOIN public.service_lines l ON l.company_id = c.company_id AND l.business_id = c.business_id AND l.id = c.line_id
    WHERE c.company_id = OLD.company_id AND c.line_id = OLD.line_id
      AND c.write_system_id = sid AND c.write_xid = pg_current_xact_id() AND l.revision = c.revision;
    IF NOT FOUND OR NOT EXISTS (
      SELECT 1 FROM public.service_line_performer_change_rows r
      WHERE r.company_id = OLD.company_id AND r.change_id = header AND r.side = 'BEFORE'
        AND public.slpc_same_tuple(
          r.employee_id, r.performer_ordinal, r.share_bps, r.linked_user_id, r.linked_user_snapshotted, r.name_en, r.name_ar, r.not_clocked_in_warning, r.approved_leave_warning,
          OLD.employee_id, OLD.performer_ordinal, OLD.share_bps, OLD.linked_user_id, OLD.linked_user_snapshotted, OLD.name_en, OLD.name_ar, OLD.not_clocked_in_warning, OLD.approved_leave_warning)
    ) THEN
      RAISE EXCEPTION 'deleting a performer requires a change header at the line target revision'
        USING ERRCODE = '23514', CONSTRAINT = 'line_performers_change_guard';
    END IF;
    RETURN OLD;
  END IF;
  IF NEW.company_id IS DISTINCT FROM public.app_company_id() THEN RETURN NEW; END IF;
  SELECT l.revision, c.revision INTO line_rev, target
  FROM public.service_lines l
  LEFT JOIN public.service_line_performer_changes c
    ON c.company_id = l.company_id AND c.business_id = l.business_id AND c.line_id = l.id
      AND c.write_system_id = sid AND c.write_xid = pg_current_xact_id()
  WHERE l.company_id = NEW.company_id AND l.business_id = NEW.business_id AND l.id = NEW.line_id;
  IF NOT FOUND THEN RETURN NEW; END IF;
  IF target IS NOT NULL AND line_rev IS DISTINCT FROM target THEN
    RAISE EXCEPTION 'performer insert requires the line to be at the change target revision'
      USING ERRCODE = '23514', CONSTRAINT = 'line_performers_change_guard';
  END IF;
  IF target IS NULL AND line_rev IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'recording performers after revision 1 requires a change header'
      USING ERRCODE = '23514', CONSTRAINT = 'line_performers_change_guard';
  END IF;
  RETURN NEW;
END $$;
