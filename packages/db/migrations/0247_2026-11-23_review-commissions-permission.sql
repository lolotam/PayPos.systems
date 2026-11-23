-- Custom SQL migration file, put your code below! --
-- قرارا المالك CS-Q2b = PP-25.1 وCS-Q37 = PP-101.1: إنشاء كشف العمولة ومراجعته افتراضياً للمالك والمدير العام ومدير النشاط، والمالك وحده يمنحها أو يسحبها؛ والأدوار النظامية global، فالإدخال يغطي كل الشركات القائمة بلا خطوة بيانات، والجهاز ممنوع.
INSERT INTO permissions(code) VALUES ('review:commissions:business') ON CONFLICT DO NOTHING;
--> statement-breakpoint
INSERT INTO role_permissions(role_id, role_owner_key, company_id, permission_code)
SELECT r.id, 'global', NULL, 'review:commissions:business' FROM roles r
WHERE r.company_id IS NULL AND r.code IN ('owner','general_manager','business_manager')
ON CONFLICT DO NOTHING;
