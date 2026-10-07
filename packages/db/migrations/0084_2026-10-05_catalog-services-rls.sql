-- خدمات النشاط: عزل المستأجر مفروض على مستوى قاعدة البيانات (ADR-0003 §2, ADR-0007).
ALTER TABLE services ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE services FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY services_select ON services FOR SELECT TO pospay_app
  USING (company_id=app_company_id());
--> statement-breakpoint
CREATE POLICY services_insert ON services FOR INSERT TO pospay_app
  WITH CHECK (company_id=app_company_id());
--> statement-breakpoint
CREATE POLICY services_update ON services FOR UPDATE TO pospay_app
  USING (company_id=app_company_id()) WITH CHECK (company_id=app_company_id());
--> statement-breakpoint
-- مفيش DELETE: الخدمة مش من جداول الحذف الناعم (CLAUDE.md §5)، والصف مش بيتشال.
GRANT SELECT, INSERT ON services TO pospay_app;
--> statement-breakpoint
GRANT UPDATE (name_en, name_ar, price, commission_rule_kind, commission_pct_bps,
  commission_fixed_amount, counts_toward_threshold, revision, updated_at) ON services TO pospay_app;
--> statement-breakpoint
-- SV-Q1 (افتراض موصى به): نفس افتراضي manage:employees:business. المديرون الثلاثة بيديروا الخدمات
-- ويقرواها؛ بقية أدوار النظام ممنوعة وفق PR 7، والجهاز لا يكتسبها من ALLOW قديم.
INSERT INTO permissions(code) VALUES ('read:services:business'),('manage:services:business') ON CONFLICT DO NOTHING;
--> statement-breakpoint
INSERT INTO role_permissions(role_id,role_owner_key,company_id,permission_code) VALUES
  ('01920000-0000-7000-8000-000000000101','global',NULL,'read:services:business'),
  ('01920000-0000-7000-8000-000000000101','global',NULL,'manage:services:business'),
  ('01920000-0000-7000-8000-000000000102','global',NULL,'read:services:business'),
  ('01920000-0000-7000-8000-000000000102','global',NULL,'manage:services:business'),
  ('01920000-0000-7000-8000-000000000104','global',NULL,'read:services:business'),
  ('01920000-0000-7000-8000-000000000104','global',NULL,'manage:services:business')
ON CONFLICT DO NOTHING;
