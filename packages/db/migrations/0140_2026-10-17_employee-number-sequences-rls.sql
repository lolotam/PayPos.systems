ALTER TABLE employee_number_sequences ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE employee_number_sequences FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY employee_number_sequences_select ON employee_number_sequences FOR SELECT TO pospay_app USING (company_id = app_company_id());
--> statement-breakpoint
CREATE POLICY employee_number_sequences_insert ON employee_number_sequences FOR INSERT TO pospay_app WITH CHECK (company_id = app_company_id());
--> statement-breakpoint
CREATE POLICY employee_number_sequences_update ON employee_number_sequences FOR UPDATE TO pospay_app USING (company_id = app_company_id()) WITH CHECK (company_id = app_company_id());
--> statement-breakpoint
GRANT SELECT, INSERT ON employee_number_sequences TO pospay_app;
--> statement-breakpoint
GRANT UPDATE (next_number, start_number, start_set_by, start_set_at, updated_at) ON employee_number_sequences TO pospay_app;
--> statement-breakpoint
GRANT UPDATE (employee_number) ON employees TO pospay_app;
