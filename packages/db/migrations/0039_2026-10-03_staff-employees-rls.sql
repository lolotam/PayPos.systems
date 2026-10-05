-- Custom SQL migration file, put your code below! --
ALTER TABLE employees ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE employees FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY employees_select ON employees FOR SELECT TO pospay_app USING (company_id = app_company_id());
--> statement-breakpoint
CREATE POLICY employees_insert ON employees FOR INSERT TO pospay_app WITH CHECK (company_id = app_company_id());
--> statement-breakpoint
GRANT SELECT, INSERT ON employees TO pospay_app;
--> statement-breakpoint
ALTER TABLE employee_branches ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE employee_branches FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY employee_branches_select ON employee_branches FOR SELECT TO pospay_app USING (company_id = app_company_id());
--> statement-breakpoint
CREATE POLICY employee_branches_insert ON employee_branches FOR INSERT TO pospay_app WITH CHECK (company_id = app_company_id());
--> statement-breakpoint
GRANT SELECT, INSERT ON employee_branches TO pospay_app;
