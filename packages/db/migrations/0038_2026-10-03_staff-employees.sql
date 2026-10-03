CREATE UNIQUE INDEX CONCURRENTLY "branches_company_business_id_key" ON "branches" ("company_id", "business_id", "id");
--> statement-breakpoint
ALTER TABLE "branches" ADD CONSTRAINT "branches_company_business_id_key" UNIQUE USING INDEX "branches_company_business_id_key";
--> statement-breakpoint
CREATE TABLE "employee_branches" (
	"company_id" uuid NOT NULL,
	"id" uuid NOT NULL,
	"business_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"from" date NOT NULL,
	"to" date,
	CONSTRAINT "employee_branches_pkey" PRIMARY KEY("company_id","id")
);
--> statement-breakpoint
CREATE TABLE "employees" (
	"company_id" uuid NOT NULL,
	"id" uuid NOT NULL,
	"business_id" uuid NOT NULL,
	"primary_branch_id" uuid NOT NULL,
	"user_id" uuid,
	"name_ar" text,
	"name_en" text NOT NULL,
	"role_code" text NOT NULL,
	"hire_date" date NOT NULL,
	"contract_end" date,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "employees_pkey" PRIMARY KEY("company_id","id"),
	CONSTRAINT "employees_company_business_id_key" UNIQUE("company_id","business_id","id"),
	CONSTRAINT "employees_name_en_length" CHECK (char_length(trim("employees"."name_en")) BETWEEN 1 AND 255),
	CONSTRAINT "employees_name_ar_length" CHECK ("employees"."name_ar" IS NULL OR char_length(trim("employees"."name_ar")) BETWEEN 1 AND 255),
	CONSTRAINT "employees_role_code" CHECK ("employees"."role_code" IN ('owner','general_manager','accountant','business_manager','branch_manager','shift_supervisor','cashier','waiter','kitchen','storekeeper','staff','marketing','viewer'))
);
--> statement-breakpoint
ALTER TABLE "employee_branches" ADD CONSTRAINT "employee_branches_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_branches" ADD CONSTRAINT "employee_branches_employee_fk" FOREIGN KEY ("company_id","business_id","employee_id") REFERENCES "public"."employees"("company_id","business_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_branches" ADD CONSTRAINT "employee_branches_branch_fk" FOREIGN KEY ("company_id","business_id","branch_id") REFERENCES "public"."branches"("company_id","business_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employees" ADD CONSTRAINT "employees_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employees" ADD CONSTRAINT "employees_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employees" ADD CONSTRAINT "employees_business_fk" FOREIGN KEY ("company_id","business_id") REFERENCES "public"."businesses"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employees" ADD CONSTRAINT "employees_primary_branch_fk" FOREIGN KEY ("company_id","business_id","primary_branch_id") REFERENCES "public"."branches"("company_id","business_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "employee_branches_company_employee_from_idx" ON "employee_branches" USING btree ("company_id","employee_id","from");--> statement-breakpoint
CREATE INDEX "employee_branches_company_branch_from_idx" ON "employee_branches" USING btree ("company_id","branch_id","from");--> statement-breakpoint
CREATE INDEX "employee_branches_company_business_idx" ON "employee_branches" USING btree ("company_id","business_id");--> statement-breakpoint
CREATE INDEX "employees_company_business_id_idx" ON "employees" USING btree ("company_id","business_id","id");--> statement-breakpoint
CREATE INDEX "employees_company_primary_branch_idx" ON "employees" USING btree ("company_id","primary_branch_id","id");--> statement-breakpoint
CREATE INDEX "employees_company_user_idx" ON "employees" USING btree ("company_id","user_id","business_id");--> statement-breakpoint
CREATE INDEX "employees_user_id_idx" ON "employees" USING btree ("user_id");--> statement-breakpoint
-- التاريخ قبل وجود staff لا يتحول لموظفين افتراضيين؛ NOT VALID يفرض المرجع على كل كتابة جديدة.
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_employee_fk" FOREIGN KEY ("company_id","employee_id") REFERENCES "public"."employees"("company_id","id") ON DELETE no action ON UPDATE no action NOT VALID;--> statement-breakpoint
ALTER TABLE "cashier_pins" ADD CONSTRAINT "cashier_pins_employee_fk" FOREIGN KEY ("company_id","employee_id") REFERENCES "public"."employees"("company_id","id") ON DELETE no action ON UPDATE no action NOT VALID;
