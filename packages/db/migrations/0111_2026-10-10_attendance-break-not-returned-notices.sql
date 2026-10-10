CREATE TABLE "attendance_break_not_returned_notices" (
	"company_id" uuid NOT NULL,
	"id" uuid NOT NULL,
	"business_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"shift_starts_at" timestamp with time zone NOT NULL,
	"shift_ends_at" timestamp with time zone NOT NULL,
	"break_ends_at" timestamp with time zone NOT NULL,
	"break_out_at" timestamp with time zone NOT NULL,
	"alert_due_at" timestamp with time zone NOT NULL,
	"notified_at" timestamp with time zone NOT NULL,
	"recipient_count" integer NOT NULL,
	CONSTRAINT "attendance_break_not_returned_notices_pkey" PRIMARY KEY("company_id","id"),
	CONSTRAINT "attendance_break_not_returned_notices_shift_key" UNIQUE("company_id","employee_id","shift_starts_at"),
	CONSTRAINT "attendance_break_not_returned_notices_recipients" CHECK ("attendance_break_not_returned_notices"."recipient_count" >= 0),
	CONSTRAINT "attendance_break_not_returned_notices_span" CHECK ("attendance_break_not_returned_notices"."shift_ends_at" > "attendance_break_not_returned_notices"."shift_starts_at" AND "attendance_break_not_returned_notices"."break_ends_at" > "attendance_break_not_returned_notices"."shift_starts_at" AND "attendance_break_not_returned_notices"."break_ends_at" < "attendance_break_not_returned_notices"."shift_ends_at")
);
--> statement-breakpoint
ALTER TABLE "attendance_break_not_returned_notices" ADD CONSTRAINT "attendance_break_not_returned_notices_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_break_not_returned_notices" ADD CONSTRAINT "attendance_break_not_returned_notices_employee_fk" FOREIGN KEY ("company_id","business_id","employee_id") REFERENCES "public"."employees"("company_id","business_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_break_not_returned_notices" ADD CONSTRAINT "attendance_break_not_returned_notices_branch_fk" FOREIGN KEY ("company_id","business_id","branch_id") REFERENCES "public"."branches"("company_id","business_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "attendance_break_not_returned_notices_business_branch_idx" ON "attendance_break_not_returned_notices" USING btree ("company_id","business_id","branch_id");--> statement-breakpoint
CREATE INDEX "attendance_break_not_returned_notices_branch_idx" ON "attendance_break_not_returned_notices" USING btree ("company_id","branch_id");