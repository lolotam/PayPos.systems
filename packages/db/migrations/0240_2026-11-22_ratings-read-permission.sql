-- Custom SQL migration file, put your code below! --
-- قرار المالك RT-Q7 (spec 060، الصف 61-1c): قراءة التقييمات صلاحية افتراضية للمالك والمدير العام ومدير النشاط ومدير الفرع في نطاق عضويتهم، والجهاز ممنوع، وتفويضها بقاعدة 61-1b فقط؛ الأدوار النظامية global، فالإدخال يغطي كل الشركات القائمة بلا خطوة بيانات.
INSERT INTO permissions(code) VALUES ('read:ratings:branch') ON CONFLICT DO NOTHING;
--> statement-breakpoint
INSERT INTO role_permissions(role_id, role_owner_key, company_id, permission_code)
SELECT r.id, 'global', NULL, 'read:ratings:branch' FROM roles r
WHERE r.company_id IS NULL AND r.code IN ('owner', 'general_manager', 'business_manager', 'branch_manager')
ON CONFLICT DO NOTHING;
