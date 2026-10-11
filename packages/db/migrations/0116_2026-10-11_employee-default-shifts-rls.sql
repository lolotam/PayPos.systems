ALTER TABLE employee_default_shifts ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE employee_default_shifts FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY employee_default_shifts_select ON employee_default_shifts FOR SELECT TO pospay_app USING (company_id = app_company_id());
--> statement-breakpoint
CREATE POLICY employee_default_shifts_insert ON employee_default_shifts FOR INSERT TO pospay_app WITH CHECK (company_id = app_company_id());
--> statement-breakpoint
CREATE POLICY employee_default_shifts_delete ON employee_default_shifts FOR DELETE TO pospay_app USING (company_id = app_company_id());
--> statement-breakpoint
GRANT SELECT, INSERT, DELETE ON employee_default_shifts TO pospay_app;
