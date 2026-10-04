-- Custom SQL migration file, put your code below! --
ALTER TABLE document_types ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE document_types FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY document_types_select ON document_types FOR SELECT TO pospay_app USING(company_id=app_company_id());
--> statement-breakpoint
CREATE POLICY document_types_insert ON document_types FOR INSERT TO pospay_app WITH CHECK(company_id=app_company_id());
--> statement-breakpoint
CREATE POLICY document_types_update ON document_types FOR UPDATE TO pospay_app USING(company_id=app_company_id()) WITH CHECK(company_id=app_company_id());
--> statement-breakpoint
GRANT SELECT, INSERT ON document_types TO pospay_app;
--> statement-breakpoint
-- الكود والشركة ثابتان؛ لا حذف للنوع حتى لا تفقد الوثائق المسجلة اسمها.
GRANT UPDATE(name_en, name_ar, alert_days, requires_expiry, active, revision) ON document_types TO pospay_app;
--> statement-breakpoint
ALTER TABLE employee_documents ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE employee_documents FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY employee_documents_select ON employee_documents FOR SELECT TO pospay_app USING(company_id=app_company_id());
--> statement-breakpoint
CREATE POLICY employee_documents_insert ON employee_documents FOR INSERT TO pospay_app WITH CHECK(company_id=app_company_id());
--> statement-breakpoint
CREATE POLICY employee_documents_update ON employee_documents FOR UPDATE TO pospay_app USING(company_id=app_company_id()) WITH CHECK(company_id=app_company_id());
--> statement-breakpoint
GRANT SELECT, INSERT ON employee_documents TO pospay_app;
--> statement-breakpoint
-- الاستبدال وحده يعدل الوثيقة؛ المفتاح والانتهاء والموظف تبقى كما سجلت.
GRANT UPDATE(replaced_at) ON employee_documents TO pospay_app;
--> statement-breakpoint
-- البذرة تقرأ الشركات تحت FORCE RLS؛ دور هجرة بلا تجاوز سيزرع صفر صفوف بصمت، فنفشل بصوت عال.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_roles WHERE rolname = current_user AND (rolsuper OR rolbypassrls)
  ) THEN
    RAISE EXCEPTION 'document_types seed needs a superuser or BYPASSRLS migration role; % would read no companies under FORCE RLS', current_user
      USING ERRCODE = '42501';
  END IF;
END $$;
--> statement-breakpoint
-- DOC-Q1 (قرار المالك 2026-10-04، الخيار الموصى به): الأنواع الخمسة الموصى بها لكل شركة قائمة؛ الشركات الجديدة يزرعها worker عند CompanyCreated.
-- المعرف UUID v7 من وقت الهجرة وبايتات عشوائية؛ التكرار لا يضيف شيئاً بفضل الكود الفريد.
INSERT INTO document_types(company_id,id,code,name_en,name_ar,alert_days,requires_expiry)
SELECT c.id,
  encode(set_bit(set_bit(overlay(uuid_send(gen_random_uuid()) PLACING
    substring(int8send(floor(extract(epoch FROM clock_timestamp())*1000)::bigint) FROM 3) FROM 1 FOR 6),
    52, 1), 53, 1), 'hex')::uuid,
  d.code, d.name_en, d.name_ar, 30, d.requires_expiry
FROM companies c
CROSS JOIN (VALUES
  ('civil_id','Civil ID','البطاقة المدنية',true),
  ('passport','Passport','جواز السفر',true),
  ('residency','Residency','الإقامة',true),
  ('health_certificate','Health certificate','الشهادة الصحية',true),
  ('work_contract','Work contract','عقد العمل',false)
) AS d(code,name_en,name_ar,requires_expiry)
ON CONFLICT (company_id, code) DO NOTHING;
