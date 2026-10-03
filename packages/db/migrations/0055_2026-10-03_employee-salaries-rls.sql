-- Custom SQL migration file, put your code below! --
ALTER TABLE employee_salaries ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE employee_salaries FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY employee_salaries_select ON employee_salaries FOR SELECT TO pospay_app USING (company_id = app_company_id());
--> statement-breakpoint
CREATE POLICY employee_salaries_insert ON employee_salaries FOR INSERT TO pospay_app WITH CHECK (company_id = app_company_id());
--> statement-breakpoint
CREATE POLICY employee_salaries_update ON employee_salaries FOR UPDATE TO pospay_app USING (company_id = app_company_id()) WITH CHECK (company_id = app_company_id());
--> statement-breakpoint
GRANT SELECT, INSERT ON employee_salaries TO pospay_app;
--> statement-breakpoint
GRANT UPDATE (amount, set_by, revision, reason) ON employee_salaries TO pospay_app;
--> statement-breakpoint
INSERT INTO permissions(code) VALUES ('read:salaries:business'), ('manage:salaries:business') ON CONFLICT DO NOTHING;
