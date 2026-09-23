-- Tenancy RLS and grants — ADR-0003 §2.3, §2.4, §3; plan v4 T5.
-- Every policy reads context through app_company_id() (migration 0000), never a raw cast.
-- Policies are split by command; INSERT and UPDATE declare WITH CHECK explicitly.
-- The grants below are the complete list for pospay_app; the privilege suite
-- (privileges.spec.ts) fails on anything not listed there.

-- plans: global reference data. No company_id, no RLS; the app reads it and nothing more.
GRANT SELECT ON plans TO pospay_app;
--> statement-breakpoint

-- companies: the tenant root, keyed on id. No DELETE grant — companies are closed, never deleted.
ALTER TABLE companies ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE companies FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY companies_select ON companies FOR SELECT TO pospay_app
  USING (id = app_company_id());
--> statement-breakpoint
CREATE POLICY companies_insert ON companies FOR INSERT TO pospay_app
  WITH CHECK (id = app_company_id());
--> statement-breakpoint
CREATE POLICY companies_update ON companies FOR UPDATE TO pospay_app
  USING (id = app_company_id()) WITH CHECK (id = app_company_id());
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON companies TO pospay_app;
--> statement-breakpoint

-- businesses and branches: tenant data.
ALTER TABLE businesses ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE businesses FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY businesses_select ON businesses FOR SELECT TO pospay_app
  USING (company_id = app_company_id());
--> statement-breakpoint
CREATE POLICY businesses_insert ON businesses FOR INSERT TO pospay_app
  WITH CHECK (company_id = app_company_id());
--> statement-breakpoint
CREATE POLICY businesses_update ON businesses FOR UPDATE TO pospay_app
  USING (company_id = app_company_id()) WITH CHECK (company_id = app_company_id());
--> statement-breakpoint
CREATE POLICY businesses_delete ON businesses FOR DELETE TO pospay_app
  USING (company_id = app_company_id());
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON businesses TO pospay_app;
--> statement-breakpoint

ALTER TABLE branches ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE branches FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY branches_select ON branches FOR SELECT TO pospay_app
  USING (company_id = app_company_id());
--> statement-breakpoint
CREATE POLICY branches_insert ON branches FOR INSERT TO pospay_app
  WITH CHECK (company_id = app_company_id());
--> statement-breakpoint
CREATE POLICY branches_update ON branches FOR UPDATE TO pospay_app
  USING (company_id = app_company_id()) WITH CHECK (company_id = app_company_id());
--> statement-breakpoint
CREATE POLICY branches_delete ON branches FOR DELETE TO pospay_app
  USING (company_id = app_company_id());
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON branches TO pospay_app;
--> statement-breakpoint

-- company_feature_overrides: tenant data the T9a feature guard only reads; rows are set by the platform.
ALTER TABLE company_feature_overrides ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE company_feature_overrides FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY company_feature_overrides_select ON company_feature_overrides FOR SELECT TO pospay_app
  USING (company_id = app_company_id());
--> statement-breakpoint
GRANT SELECT ON company_feature_overrides TO pospay_app;
