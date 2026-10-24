CREATE TABLE "attendance_statement_requests" (
	"company_id" uuid NOT NULL,
	"id" uuid NOT NULL,
	"business_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"form" text NOT NULL,
	"employee_id" uuid,
	"period_from" date NOT NULL,
	"period_to" date NOT NULL,
	"language" text NOT NULL,
	"shift_start" time,
	"shift_end" time,
	"logo_file_id" uuid,
	"requested_by" uuid NOT NULL,
	"requested_at" timestamp with time zone NOT NULL,
	CONSTRAINT "attendance_statement_requests_pkey" PRIMARY KEY("company_id","id"),
	CONSTRAINT "attendance_statement_requests_form" CHECK ("attendance_statement_requests"."form" IN ('BRANCH','EMPLOYEE')),
	CONSTRAINT "attendance_statement_requests_language" CHECK ("attendance_statement_requests"."language" IN ('ar','en')),
	CONSTRAINT "attendance_statement_requests_period" CHECK ("attendance_statement_requests"."period_from" <= "attendance_statement_requests"."period_to" AND "attendance_statement_requests"."period_to" - "attendance_statement_requests"."period_from" <= 365),
	CONSTRAINT "attendance_statement_requests_employee" CHECK ("attendance_statement_requests"."form" <> 'EMPLOYEE' OR "attendance_statement_requests"."employee_id" IS NOT NULL),
	CONSTRAINT "attendance_statement_requests_shift" CHECK (("attendance_statement_requests"."shift_start" IS NULL) = ("attendance_statement_requests"."shift_end" IS NULL) AND ("attendance_statement_requests"."shift_start" IS NULL OR "attendance_statement_requests"."form" = 'BRANCH'))
);
--> statement-breakpoint
ALTER TABLE "attendance_statement_requests" ADD CONSTRAINT "attendance_statement_requests_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_statement_requests" ADD CONSTRAINT "attendance_statement_requests_requested_by_user_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_statement_requests" ADD CONSTRAINT "attendance_statement_requests_business_fk" FOREIGN KEY ("company_id","business_id") REFERENCES "public"."businesses"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_statement_requests" ADD CONSTRAINT "attendance_statement_requests_branch_fk" FOREIGN KEY ("company_id","business_id","branch_id") REFERENCES "public"."branches"("company_id","business_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_statement_requests" ADD CONSTRAINT "attendance_statement_requests_employee_fk" FOREIGN KEY ("company_id","business_id","employee_id") REFERENCES "public"."employees"("company_id","business_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "attendance_statement_requests_business_branch_idx" ON "attendance_statement_requests" USING btree ("company_id","business_id","branch_id","requested_at");--> statement-breakpoint
CREATE INDEX "attendance_statement_requests_employee_idx" ON "attendance_statement_requests" USING btree ("company_id","business_id","employee_id");--> statement-breakpoint
CREATE INDEX "attendance_statement_requests_requester_idx" ON "attendance_statement_requests" USING btree ("company_id","requested_by","requested_at");--> statement-breakpoint
CREATE INDEX "attendance_statement_requests_requested_by_idx" ON "attendance_statement_requests" USING btree ("requested_by");--> statement-breakpoint
ALTER TABLE attendance_statement_requests ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE attendance_statement_requests FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY attendance_statement_requests_select ON attendance_statement_requests FOR SELECT TO pospay_app USING (company_id = app_company_id());
--> statement-breakpoint
CREATE POLICY attendance_statement_requests_insert ON attendance_statement_requests FOR INSERT TO pospay_app WITH CHECK (company_id = app_company_id());
--> statement-breakpoint
REVOKE ALL ON attendance_statement_requests FROM PUBLIC, pospay_app, pospay_auth, pospay_dispatcher;
--> statement-breakpoint
-- سجل طلب البيان يُدرج مرة واحدة ولا يُعدّل ولا يُحذف.
GRANT SELECT, INSERT ON attendance_statement_requests TO pospay_app;
