CREATE UNIQUE INDEX CONCURRENTLY "employee_branches_active_key" ON "employee_branches" USING btree ("company_id","employee_id","branch_id") WHERE "employee_branches"."to" IS NULL;--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN "revision" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "employees" ADD CONSTRAINT "employees_revision_positive" CHECK ("employees"."revision" > 0);
