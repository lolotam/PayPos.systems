ALTER TABLE employee_ibans ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE employee_ibans FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY employee_ibans_select ON employee_ibans FOR SELECT TO pospay_app USING (company_id = app_company_id());
--> statement-breakpoint
CREATE POLICY employee_ibans_insert ON employee_ibans FOR INSERT TO pospay_app WITH CHECK (company_id = app_company_id());
--> statement-breakpoint
GRANT SELECT, INSERT ON employee_ibans TO pospay_app;
