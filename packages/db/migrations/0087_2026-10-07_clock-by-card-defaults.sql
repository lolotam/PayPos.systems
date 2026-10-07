-- Custom SQL migration file, put your code below! --
INSERT INTO permissions(code) VALUES ('clock:attendance:branch') ON CONFLICT DO NOTHING;
--> statement-breakpoint
INSERT INTO role_permissions(role_id,role_owner_key,company_id,permission_code)
SELECT id,'global',NULL,'clock:attendance:branch' FROM roles
WHERE company_id IS NULL AND code IN ('owner','general_manager','business_manager','branch_manager','shift_supervisor','cashier')
ON CONFLICT DO NOTHING;
--> statement-breakpoint
INSERT INTO role_permissions(role_id,role_owner_key,company_id,permission_code)
SELECT id,'global',NULL,'login:staff:branch' FROM roles WHERE company_id IS NULL AND code='cashier'
ON CONFLICT DO NOTHING;
