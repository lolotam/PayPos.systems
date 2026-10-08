ALTER TABLE package_types ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE package_types FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY package_types_select ON package_types FOR SELECT TO pospay_app USING (company_id=app_company_id());
--> statement-breakpoint
CREATE POLICY package_types_insert ON package_types FOR INSERT TO pospay_app WITH CHECK (company_id=app_company_id());
--> statement-breakpoint
CREATE POLICY package_types_update ON package_types FOR UPDATE TO pospay_app USING (company_id=app_company_id()) WITH CHECK (company_id=app_company_id());
--> statement-breakpoint
GRANT SELECT, INSERT ON package_types TO pospay_app;
--> statement-breakpoint
ALTER TABLE package_type_components ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE package_type_components FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY package_type_components_select ON package_type_components FOR SELECT TO pospay_app USING (company_id=app_company_id());
--> statement-breakpoint
CREATE POLICY package_type_components_insert ON package_type_components FOR INSERT TO pospay_app WITH CHECK (company_id=app_company_id());
--> statement-breakpoint
CREATE POLICY package_type_components_delete ON package_type_components FOR DELETE TO pospay_app USING (company_id=app_company_id());
--> statement-breakpoint
GRANT SELECT, INSERT, DELETE ON package_type_components TO pospay_app;
--> statement-breakpoint
GRANT UPDATE (name_en,name_ar,price,validity_days,revision,updated_at) ON package_types TO pospay_app;
--> statement-breakpoint
INSERT INTO permissions(code) VALUES ('read:package-types:business'),('manage:package-types:business') ON CONFLICT DO NOTHING;
--> statement-breakpoint
INSERT INTO role_permissions(role_id,role_owner_key,company_id,permission_code) VALUES
  ('01920000-0000-7000-8000-000000000101','global',NULL,'read:package-types:business'),
  ('01920000-0000-7000-8000-000000000101','global',NULL,'manage:package-types:business'),
  ('01920000-0000-7000-8000-000000000102','global',NULL,'read:package-types:business'),
  ('01920000-0000-7000-8000-000000000102','global',NULL,'manage:package-types:business'),
  ('01920000-0000-7000-8000-000000000104','global',NULL,'read:package-types:business'),
  ('01920000-0000-7000-8000-000000000104','global',NULL,'manage:package-types:business')
ON CONFLICT DO NOTHING;
