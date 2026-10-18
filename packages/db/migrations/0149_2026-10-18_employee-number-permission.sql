-- قرار المالك EN-Q11 بتاريخ 2026-10-17 (الدفعة 27): الرقم الوظيفي للمالك افتراضياً، والمنح الشخصية للبشر بقراره فقط.
INSERT INTO permissions(code) VALUES ('manage:employee-number:company') ON CONFLICT DO NOTHING;
--> statement-breakpoint
INSERT INTO role_permissions(role_id,role_owner_key,company_id,permission_code) VALUES
 ('01920000-0000-7000-8000-000000000101','global',NULL,'manage:employee-number:company')
ON CONFLICT DO NOTHING;
