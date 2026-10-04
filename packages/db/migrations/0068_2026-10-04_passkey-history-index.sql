CREATE INDEX CONCURRENTLY "employee_passkeys_employee_cursor_idx" ON "employee_passkeys" USING btree ("company_id","employee_id","id");
