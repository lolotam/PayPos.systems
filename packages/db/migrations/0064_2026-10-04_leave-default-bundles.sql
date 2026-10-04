INSERT INTO permissions(code) VALUES ('create:leave:own'),('read:leave:own'),('cancel:leave:own'),
('create:leave:branch'),('read:leave:branch'),('cancel:leave:branch') ON CONFLICT DO NOTHING;
--> statement-breakpoint
INSERT INTO role_permissions(role_id,role_owner_key,company_id,permission_code)
SELECT r.id,'global',NULL,p.code FROM roles r CROSS JOIN permissions p
WHERE r.company_id IS NULL AND
((r.code IN ('owner','general_manager','accountant','business_manager','branch_manager','shift_supervisor','cashier','waiter','kitchen','storekeeper','staff','marketing','viewer')
AND p.code IN ('create:leave:own','read:leave:own','cancel:leave:own'))
OR (r.code IN ('owner','general_manager','business_manager','branch_manager') AND p.code IN ('create:leave:branch','read:leave:branch','cancel:leave:branch')))
ON CONFLICT DO NOTHING;
