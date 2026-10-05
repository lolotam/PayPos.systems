-- قرار المالك 2026-10-04: إذن الإنشاء يخص السياق والعميل يظل للشركة؛ الحد الشخصي مستقل عن الخصم.
INSERT INTO permissions(code) VALUES
  ('create:customers:business'), ('create:customers:branch'), ('manage:discount-limits:business')
ON CONFLICT DO NOTHING;
--> statement-breakpoint
INSERT INTO role_permissions(role_id,role_owner_key,company_id,permission_code) VALUES
  ('01920000-0000-7000-8000-000000000102','global',NULL,'create:customers:company'),
  ('01920000-0000-7000-8000-000000000101','global',NULL,'create:customers:business'),
  ('01920000-0000-7000-8000-000000000104','global',NULL,'create:customers:business'),
  ('01920000-0000-7000-8000-000000000101','global',NULL,'create:customers:branch'),
  ('01920000-0000-7000-8000-000000000105','global',NULL,'create:customers:branch'),
  ('01920000-0000-7000-8000-000000000107','global',NULL,'create:customers:branch'),
  ('01920000-0000-7000-8000-000000000101','global',NULL,'manage:discount-limits:business'),
  ('01920000-0000-7000-8000-000000000102','global',NULL,'manage:discount-limits:business'),
  ('01920000-0000-7000-8000-000000000104','global',NULL,'manage:discount-limits:business')
ON CONFLICT DO NOTHING;
