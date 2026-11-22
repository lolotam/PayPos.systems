-- Custom SQL migration file, put your code below! --
-- قرار المالك CS-Q14 = PP-17.2 (2026-10-21): قراءة تقدير العمولة ومعاينة كشفها وتصديرها متاحة افتراضياً للمالك والمدير العام ومدير النشاط والمحاسب ومدير الفرع، والقارئ بيشوف موظفات نطاق فروعه الفعّالة بس (CS-Q20 = PP-20.1)؛ والأدوار النظامية global، فالإدخال يغطي كل الشركات القائمة بلا خطوة بيانات، والجهاز ممنوع.
INSERT INTO permissions(code) VALUES ('read:commissions:business') ON CONFLICT DO NOTHING;
--> statement-breakpoint
INSERT INTO role_permissions(role_id, role_owner_key, company_id, permission_code)
SELECT r.id, 'global', NULL, 'read:commissions:business' FROM roles r
WHERE r.company_id IS NULL AND r.code IN ('owner', 'general_manager', 'business_manager', 'accountant', 'branch_manager')
ON CONFLICT DO NOTHING;
