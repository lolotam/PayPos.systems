INSERT INTO permissions(code) VALUES ('read:attendance:branch') ON CONFLICT DO NOTHING;
--> statement-breakpoint
INSERT INTO role_permissions(role_id,role_owner_key,company_id,permission_code)
SELECT r.id,'global',NULL,p.code FROM roles r CROSS JOIN permissions p
WHERE r.company_id IS NULL AND r.code IN ('owner','general_manager','business_manager','branch_manager','accountant')
AND p.code = 'read:attendance:branch' ON CONFLICT DO NOTHING;
