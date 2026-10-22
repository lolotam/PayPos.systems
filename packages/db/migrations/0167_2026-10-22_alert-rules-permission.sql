-- قرار المالك AL-Q1 بتاريخ 2026-10-22 (أبو سالم، الدفعة 40): إدارة التنبيهات صلاحية مستقلة، افتراضياً للمالك والمدير العام ومدير النشاط، وتفويضها لأي دور بشري، والجهاز ممنوع.
INSERT INTO permissions(code) VALUES ('manage:alert-rules:business') ON CONFLICT DO NOTHING;
--> statement-breakpoint
INSERT INTO role_permissions(role_id, role_owner_key, company_id, permission_code)
SELECT r.id, 'global', NULL, 'manage:alert-rules:business' FROM roles r
WHERE r.company_id IS NULL AND r.code IN ('owner', 'general_manager', 'business_manager')
ON CONFLICT DO NOTHING;
