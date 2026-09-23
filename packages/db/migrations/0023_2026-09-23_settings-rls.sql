-- business_settings — tenant data (PRD P0-T10.1). RLS on company_id like every tenant table. No DELETE grant: a value
-- goes back to the template by being set to null, and the row's history is in the audit log.
ALTER TABLE business_settings ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE business_settings FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY business_settings_select ON business_settings FOR SELECT TO pospay_app
  USING (company_id = app_company_id());
--> statement-breakpoint
CREATE POLICY business_settings_insert ON business_settings FOR INSERT TO pospay_app
  WITH CHECK (company_id = app_company_id());
--> statement-breakpoint
CREATE POLICY business_settings_update ON business_settings FOR UPDATE TO pospay_app
  USING (company_id = app_company_id()) WITH CHECK (company_id = app_company_id());
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON business_settings TO pospay_app;
