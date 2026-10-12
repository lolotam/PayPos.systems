INSERT INTO permissions(code) VALUES ('read:service-sessions:branch') ON CONFLICT DO NOTHING;
--> statement-breakpoint
INSERT INTO role_permissions(role_id,role_owner_key,company_id,permission_code)
SELECT r.id,'global',NULL,'read:service-sessions:branch' FROM roles r
WHERE r.company_id IS NULL AND r.code IN ('owner','general_manager','business_manager','branch_manager')
ON CONFLICT DO NOTHING;
