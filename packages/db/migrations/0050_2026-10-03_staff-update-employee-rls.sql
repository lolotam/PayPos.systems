CREATE POLICY employees_update ON employees FOR UPDATE TO pospay_app
  USING (company_id = app_company_id()) WITH CHECK (company_id = app_company_id());
--> statement-breakpoint
GRANT UPDATE (primary_branch_id, user_id, name_ar, name_en, role_code, hire_date, contract_end, revision)
  ON employees TO pospay_app;
--> statement-breakpoint
CREATE POLICY employee_branches_update ON employee_branches FOR UPDATE TO pospay_app
  USING (company_id = app_company_id()) WITH CHECK (company_id = app_company_id());
--> statement-breakpoint
GRANT UPDATE ("to") ON employee_branches TO pospay_app;
