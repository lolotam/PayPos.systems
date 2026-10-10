CREATE TABLE "attendance_device_refusals" (
	"company_id" uuid NOT NULL,
	"id" uuid NOT NULL,
	"business_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"holder_employee_id" uuid,
	"step" text NOT NULL,
	"reason" text NOT NULL,
	"installation_hash" text NOT NULL,
	"attempted_at" timestamp with time zone NOT NULL,
	CONSTRAINT "attendance_device_refusals_pkey" PRIMARY KEY("company_id","id"),
	CONSTRAINT "attendance_device_refusals_step" CHECK ("attendance_device_refusals"."step" IN ('CHALLENGE','CLOCK','ENROL')),
	CONSTRAINT "attendance_device_refusals_reason" CHECK ("attendance_device_refusals"."reason" IN ('DEVICE_LOCKED','NOT_ENROLLED','DEVICE_TAKEN','OTHER_DEVICE')),
	CONSTRAINT "attendance_device_refusals_holder_reason" CHECK (("attendance_device_refusals"."holder_employee_id" IS NOT NULL) = ("attendance_device_refusals"."reason" IN ('DEVICE_LOCKED','DEVICE_TAKEN'))),
	CONSTRAINT "attendance_device_refusals_hash_format" CHECK ("attendance_device_refusals"."installation_hash" ~ '^[a-f0-9]{64}$')
);
--> statement-breakpoint
ALTER TABLE "employee_passkeys" ADD COLUMN "installation_hash" text;--> statement-breakpoint
ALTER TABLE "attendance_device_refusals" ADD CONSTRAINT "attendance_device_refusals_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_device_refusals" ADD CONSTRAINT "attendance_device_refusals_employee_fk" FOREIGN KEY ("company_id","business_id","employee_id") REFERENCES "public"."employees"("company_id","business_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_device_refusals" ADD CONSTRAINT "attendance_device_refusals_branch_fk" FOREIGN KEY ("company_id","business_id","branch_id") REFERENCES "public"."branches"("company_id","business_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_device_refusals" ADD CONSTRAINT "attendance_device_refusals_holder_fk" FOREIGN KEY ("company_id","holder_employee_id") REFERENCES "public"."employees"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "attendance_device_refusals_branch_time_idx" ON "attendance_device_refusals" USING btree ("company_id","business_id","branch_id","attempted_at","id");--> statement-breakpoint
CREATE INDEX "attendance_device_refusals_employee_idx" ON "attendance_device_refusals" USING btree ("company_id","business_id","employee_id");--> statement-breakpoint
CREATE INDEX "attendance_device_refusals_holder_idx" ON "attendance_device_refusals" USING btree ("company_id","holder_employee_id") WHERE "attendance_device_refusals"."holder_employee_id" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "employee_passkeys" ADD CONSTRAINT "employee_passkeys_installation_hash_format" CHECK ("employee_passkeys"."installation_hash" ~ '^[a-f0-9]{64}$');