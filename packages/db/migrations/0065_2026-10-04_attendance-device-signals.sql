CREATE TABLE "attendance_device_signals" (
	"company_id" uuid NOT NULL,
	"id" uuid NOT NULL,
	"business_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"clock_event_id" uuid NOT NULL,
	"installation_hash" text NOT NULL,
	"clocked_at" timestamp with time zone NOT NULL,
	CONSTRAINT "attendance_device_signals_pkey" PRIMARY KEY("company_id","id"),
	CONSTRAINT "attendance_device_signals_hash_format" CHECK ("attendance_device_signals"."installation_hash" ~ '^[a-f0-9]{64}$')
);
--> statement-breakpoint
ALTER TABLE "attendance_device_signals" ADD CONSTRAINT "attendance_device_signals_employee_fk" FOREIGN KEY ("company_id","business_id","employee_id") REFERENCES "public"."employees"("company_id","business_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_device_signals" ADD CONSTRAINT "attendance_device_signals_branch_fk" FOREIGN KEY ("company_id","business_id","branch_id") REFERENCES "public"."branches"("company_id","business_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "attendance_device_signals_clock_key" ON "attendance_device_signals" USING btree ("company_id","clock_event_id");--> statement-breakpoint
CREATE INDEX "attendance_device_signals_hash_time_idx" ON "attendance_device_signals" USING btree ("company_id","installation_hash","clocked_at","id");--> statement-breakpoint
CREATE INDEX "attendance_device_signals_branch_time_idx" ON "attendance_device_signals" USING btree ("company_id","business_id","branch_id","clocked_at","id");--> statement-breakpoint
CREATE INDEX "attendance_device_signals_employee_idx" ON "attendance_device_signals" USING btree ("company_id","business_id","employee_id");