CREATE EXTENSION IF NOT EXISTS btree_gist;
--> statement-breakpoint
ALTER TABLE "employee_branches" ADD CONSTRAINT "employee_branches_nonempty_interval" CHECK ("employee_branches"."to" IS NULL OR "employee_branches"."to" > "employee_branches"."from");
--> statement-breakpoint
ALTER TABLE employee_branches ADD CONSTRAINT employee_branches_no_overlap
  EXCLUDE USING gist (company_id WITH =, employee_id WITH =, branch_id WITH =,
    daterange("from", "to", '[)') WITH &&);
