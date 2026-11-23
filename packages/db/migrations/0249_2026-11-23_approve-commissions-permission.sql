-- Custom SQL migration file, put your code below! --
-- قرار المالك CS-Q5 (2026-10-21) وCS-Q37 = PP-101.1: اعتماد كشف العمولة للمالك وحده افتراضياً، والمالك وحده يمنحها أو يسحبها؛ والأدوار النظامية global، فالإدخال يغطي كل الشركات القائمة بلا خطوة بيانات، والجهاز ممنوع.
INSERT INTO permissions(code) VALUES ('approve:commissions:business') ON CONFLICT DO NOTHING;
--> statement-breakpoint
INSERT INTO role_permissions(role_id, role_owner_key, company_id, permission_code)
SELECT r.id, 'global', NULL, 'approve:commissions:business' FROM roles r
WHERE r.company_id IS NULL AND r.code = 'owner'
ON CONFLICT DO NOTHING;
