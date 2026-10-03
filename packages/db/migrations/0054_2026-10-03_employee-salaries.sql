CREATE TABLE "employee_salaries" (
	"company_id" uuid NOT NULL,
	"id" uuid NOT NULL,
	"business_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"effective_from" date NOT NULL,
	"amount" numeric(14, 3) NOT NULL,
	"set_by" uuid NOT NULL,
	"revision" integer NOT NULL,
	"reason" text NOT NULL,
	CONSTRAINT "employee_salaries_pkey" PRIMARY KEY("company_id","id"),
	CONSTRAINT "employee_salaries_employee_date_key" UNIQUE("company_id","employee_id","effective_from"),
	CONSTRAINT "employee_salaries_amount_nonnegative" CHECK ("employee_salaries"."amount" >= 0),
	CONSTRAINT "employee_salaries_revision_positive" CHECK ("employee_salaries"."revision" > 0),
	CONSTRAINT "employee_salaries_reason_length" CHECK (char_length(trim("employee_salaries"."reason")) BETWEEN 1 AND 500)
);
--> statement-breakpoint
ALTER TABLE "employee_salaries" ADD CONSTRAINT "employee_salaries_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_salaries" ADD CONSTRAINT "employee_salaries_set_by_user_id_fk" FOREIGN KEY ("set_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_salaries" ADD CONSTRAINT "employee_salaries_employee_fk" FOREIGN KEY ("company_id","business_id","employee_id") REFERENCES "public"."employees"("company_id","business_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "employee_salaries_company_business_idx" ON "employee_salaries" USING btree ("company_id","business_id");--> statement-breakpoint
CREATE INDEX "employee_salaries_set_by_idx" ON "employee_salaries" USING btree ("set_by");