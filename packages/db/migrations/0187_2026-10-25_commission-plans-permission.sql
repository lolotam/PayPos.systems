-- Custom SQL migration file, put your code below! --
-- قرارا CS-Q1 وCS-Q27 (أبو سالم 2026-10-22/23): المالك والمحاسب يحملان صلاحية الخطط افتراضياً، والمالك وحده يمنحها أو يسحبها والجهاز لا يحملها؛ والأدوار النظامية global، لذلك يغطي هذا الإدخال كل الشركات القائمة بلا خطوة بيانات.
INSERT INTO permissions(code) VALUES ('manage:commission-plans:business') ON CONFLICT DO NOTHING;
--> statement-breakpoint
INSERT INTO role_permissions(role_id, role_owner_key, company_id, permission_code)
SELECT r.id, 'global', NULL, 'manage:commission-plans:business' FROM roles r
WHERE r.company_id IS NULL AND r.code IN ('owner', 'accountant')
ON CONFLICT DO NOTHING;
