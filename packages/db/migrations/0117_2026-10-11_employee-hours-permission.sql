-- قرار المالك DH-Q5 بتاريخ 2026-10-10: الدوام الافتراضي للمالك والمنح الشخصية للبشر بقراره فقط.
INSERT INTO permissions(code) VALUES ('manage:employee-hours:business') ON CONFLICT DO NOTHING;
--> statement-breakpoint
INSERT INTO role_permissions(role_id,role_owner_key,company_id,permission_code) VALUES
 ('01920000-0000-7000-8000-000000000101','global',NULL,'manage:employee-hours:business')
ON CONFLICT DO NOTHING;
