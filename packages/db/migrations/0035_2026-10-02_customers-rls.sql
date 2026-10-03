-- Custom SQL migration file, put your code below! --
ALTER TABLE customers ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE customers FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY customers_select ON customers FOR SELECT TO pospay_app
  USING (company_id = app_company_id());
--> statement-breakpoint
CREATE POLICY customers_insert ON customers FOR INSERT TO pospay_app
  WITH CHECK (company_id = app_company_id());
--> statement-breakpoint
GRANT SELECT, INSERT ON customers TO pospay_app;
--> statement-breakpoint
INSERT INTO permissions (code) VALUES ('create:customers:company') ON CONFLICT DO NOTHING;
