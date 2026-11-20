-- الـ RLS والمنح في ملف مستقل عن الجداول زي 0226/0227: حماية المستأجر إجبارية على كل الأدوار،
-- والمنح ضيقة بالعمود عشان الشهر المحتجز ما يتعدلش بالصلاحية، وما فيش DELETE ولا منح لدور تاني ولا لـ PUBLIC.
ALTER TABLE commission_blocked_corrections ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE commission_blocked_corrections FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY commission_blocked_corrections_select ON commission_blocked_corrections FOR SELECT TO pospay_app USING (company_id = app_company_id());
--> statement-breakpoint
CREATE POLICY commission_blocked_corrections_insert ON commission_blocked_corrections FOR INSERT TO pospay_app WITH CHECK (company_id = app_company_id());
--> statement-breakpoint
CREATE POLICY commission_blocked_corrections_update ON commission_blocked_corrections FOR UPDATE TO pospay_app USING (company_id = app_company_id()) WITH CHECK (company_id = app_company_id());
--> statement-breakpoint
REVOKE ALL ON commission_blocked_corrections FROM PUBLIC, pospay_app, pospay_auth, pospay_dispatcher, pospay_notifications;
--> statement-breakpoint
GRANT SELECT, INSERT ON commission_blocked_corrections TO pospay_app;
--> statement-breakpoint
-- التعديل محصور في كود التوقف وعلامات الحل؛ الشهر المحتجز وكشفه ما بيتبدلوش بالصلاحية ولا بالتريغر (CM-52b، CM-53b).
GRANT UPDATE (code, resolved_at, resolved_generation) ON commission_blocked_corrections TO pospay_app;
--> statement-breakpoint
-- الصف المحلول مجمّد، وصف مفتوح ما بيغيرش غير الكود وعلامات الحل؛ والكود بيتقلب NO_PLAN ↔ NO_SALARY ما دام مفتوح (CM-52b).
CREATE FUNCTION commission_blocked_corrections_update_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public AS $$
BEGIN
  IF OLD.resolved_at IS NOT NULL THEN
    RAISE EXCEPTION 'a resolved blocked correction never changes' USING ERRCODE = '23514', CONSTRAINT = 'commission_blocked_corrections_resolved_immutable';
  END IF;
  IF NEW.company_id IS DISTINCT FROM OLD.company_id
     OR NEW.id IS DISTINCT FROM OLD.id
     OR NEW.business_id IS DISTINCT FROM OLD.business_id
     OR NEW.employee_id IS DISTINCT FROM OLD.employee_id
     OR NEW.source_period IS DISTINCT FROM OLD.source_period
     OR NEW.first_event_id IS DISTINCT FROM OLD.first_event_id
     OR NEW.target_period IS DISTINCT FROM OLD.target_period
     OR NEW.target_statement_id IS DISTINCT FROM OLD.target_statement_id
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'the identity and the held target of a blocked correction never change' USING ERRCODE = '23514', CONSTRAINT = 'commission_blocked_corrections_target_immutable';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION commission_blocked_corrections_update_guard() FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION commission_blocked_corrections_update_guard() TO pospay_app;
--> statement-breakpoint
CREATE TRIGGER commission_blocked_corrections_update_guard BEFORE UPDATE ON commission_blocked_corrections
FOR EACH ROW EXECUTE FUNCTION commission_blocked_corrections_update_guard();
--> statement-breakpoint
-- قيد نسخة الإصلاح (Q2) بيتضاف NOT VALID عشان فحص الصفوف الموجودة يتأجل، والتحقق جملة مستقلة زي 0224/0225؛
-- VALIDATE بيمسك SHARE UPDATE EXCLUSIVE فالكتابة تفضل شغالة أثناءه. المحاذاة بتاعتنا للشهور السليمة بس:
-- الشهر المشوّه بيفضل رفض فحص الشهر القديم، و to_date ما بتشوفش نص مشكّل فما بترفعش 22008.
ALTER TABLE "commission_plan_versions" ADD CONSTRAINT "commission_plan_versions_repair_matches_effective_from"
  CHECK ("repair_period" IS NULL
    OR NOT ("repair_period" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$' AND substr("repair_period",1,4) <> '0000')
    OR "effective_from" = to_date("repair_period" || '-01', 'YYYY-MM-DD')) NOT VALID;
--> statement-breakpoint
ALTER TABLE "commission_plan_versions" VALIDATE CONSTRAINT "commission_plan_versions_repair_matches_effective_from";
