INSERT INTO permissions(code) VALUES
('read:service-sessions:own'), ('read:commissions:own'),
('read:attendance:own'), ('read:ratings:own')
ON CONFLICT DO NOTHING;
--> statement-breakpoint
INSERT INTO role_permissions(role_id,role_owner_key,company_id,permission_code)
SELECT r.id,'global',NULL,p.code FROM roles r CROSS JOIN permissions p
WHERE r.company_id IS NULL AND r.owner_key='global'
  AND r.code IN ('owner','general_manager','accountant','business_manager','branch_manager',
    'shift_supervisor','cashier','waiter','kitchen','storekeeper','staff','marketing','viewer')
  AND p.code IN ('read:service-sessions:own','read:commissions:own',
    'read:attendance:own','read:ratings:own')
ON CONFLICT DO NOTHING;
