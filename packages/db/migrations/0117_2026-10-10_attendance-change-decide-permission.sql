INSERT INTO permissions(code) VALUES ('decide:attendance-change:company') ON CONFLICT DO NOTHING;
--> statement-breakpoint
INSERT INTO role_permissions(role_id,role_owner_key,company_id,permission_code)
SELECT r.id,'global',NULL,'decide:attendance-change:company' FROM roles r
WHERE r.id='01920000-0000-7000-8000-000000000101' AND r.owner_key='global'
  AND r.company_id IS NULL AND r.code='owner'
ON CONFLICT DO NOTHING;
