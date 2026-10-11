CREATE TABLE "employee_default_shifts" (
	"company_id" uuid NOT NULL,
	"business_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"day" smallint NOT NULL,
	"start" time NOT NULL,
	"end" time NOT NULL,
	"break_start" time,
	"break_end" time,
	"updated_by" uuid NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "employee_default_shifts_pkey" PRIMARY KEY("company_id","employee_id","branch_id","day"),
	CONSTRAINT "employee_default_shifts_day" CHECK ("employee_default_shifts"."day" BETWEEN 0 AND 6),
	CONSTRAINT "employee_default_shifts_break_pair" CHECK (("employee_default_shifts"."break_start" IS NULL AND "employee_default_shifts"."break_end" IS NULL) OR ("employee_default_shifts"."break_start" IS NOT NULL AND "employee_default_shifts"."break_end" IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "employee_default_shifts" ADD CONSTRAINT "employee_default_shifts_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_default_shifts" ADD CONSTRAINT "employee_default_shifts_employee_fk" FOREIGN KEY ("company_id","business_id","employee_id") REFERENCES "public"."employees"("company_id","business_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_default_shifts" ADD CONSTRAINT "employee_default_shifts_branch_fk" FOREIGN KEY ("company_id","business_id","branch_id") REFERENCES "public"."branches"("company_id","business_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "employee_default_shifts_company_business_branch_idx" ON "employee_default_shifts" USING btree ("company_id","business_id","branch_id");--> statement-breakpoint
CREATE INDEX "employee_default_shifts_updated_by_idx" ON "employee_default_shifts" USING btree ("updated_by");