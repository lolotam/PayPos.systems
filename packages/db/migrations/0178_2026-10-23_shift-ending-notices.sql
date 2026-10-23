CREATE TABLE "attendance_shift_ending_notices" (
	"company_id" uuid NOT NULL,
	"id" uuid NOT NULL,
	"business_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"shift_starts_at" timestamp with time zone NOT NULL,
	"shift_ends_at" timestamp with time zone NOT NULL,
	"remind_due_at" timestamp with time zone NOT NULL,
	"notified_at" timestamp with time zone NOT NULL,
	"recipient_count" integer NOT NULL,
	"suppressed_at" timestamp with time zone,
	CONSTRAINT "attendance_shift_ending_notices_pkey" PRIMARY KEY("company_id","id"),
	CONSTRAINT "attendance_shift_ending_notices_shift_key" UNIQUE("company_id","employee_id","shift_ends_at"),
	CONSTRAINT "attendance_shift_ending_notices_recipients" CHECK ("attendance_shift_ending_notices"."recipient_count" >= 0),
	CONSTRAINT "attendance_shift_ending_notices_span" CHECK ("attendance_shift_ending_notices"."shift_ends_at" > "attendance_shift_ending_notices"."shift_starts_at"),
	CONSTRAINT "attendance_shift_ending_notices_suppressed" CHECK ("attendance_shift_ending_notices"."suppressed_at" IS NULL OR "attendance_shift_ending_notices"."recipient_count" = 0)
);
--> statement-breakpoint
ALTER TABLE "attendance_shift_ending_notices" ADD CONSTRAINT "attendance_shift_ending_notices_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_shift_ending_notices" ADD CONSTRAINT "attendance_shift_ending_notices_employee_fk" FOREIGN KEY ("company_id","business_id","employee_id") REFERENCES "public"."employees"("company_id","business_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_shift_ending_notices" ADD CONSTRAINT "attendance_shift_ending_notices_branch_fk" FOREIGN KEY ("company_id","business_id","branch_id") REFERENCES "public"."branches"("company_id","business_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "attendance_shift_ending_notices_business_branch_idx" ON "attendance_shift_ending_notices" USING btree ("company_id","business_id","branch_id");--> statement-breakpoint
CREATE INDEX "attendance_shift_ending_notices_branch_idx" ON "attendance_shift_ending_notices" USING btree ("company_id","branch_id");--> statement-breakpoint
CREATE INDEX "attendance_shift_ending_notices_employee_idx" ON "attendance_shift_ending_notices" USING btree ("company_id","business_id","employee_id");
--> statement-breakpoint
ALTER TABLE attendance_shift_ending_notices ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE attendance_shift_ending_notices FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY attendance_shift_ending_notices_select ON attendance_shift_ending_notices FOR SELECT TO pospay_app USING (company_id = app_company_id());
--> statement-breakpoint
CREATE POLICY attendance_shift_ending_notices_insert ON attendance_shift_ending_notices FOR INSERT TO pospay_app WITH CHECK (company_id = app_company_id());
--> statement-breakpoint
REVOKE ALL ON attendance_shift_ending_notices FROM PUBLIC, pospay_app, pospay_auth, pospay_dispatcher;
--> statement-breakpoint
-- دفتر «دوامك قرب يخلص» مرة واحدة: يُدرج ولا يُعدّل ولا يُحذف.
GRANT SELECT, INSERT ON attendance_shift_ending_notices TO pospay_app;
