CREATE TABLE "staff_schedule_shifts" (
	"company_id" uuid NOT NULL,
	"id" uuid NOT NULL,
	"schedule_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"working_date" date NOT NULL,
	"day" integer NOT NULL,
	"start" text NOT NULL,
	"end" text NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	CONSTRAINT "staff_schedule_shifts_company_id_id_pk" PRIMARY KEY("company_id","id"),
	CONSTRAINT "staff_schedule_shifts_duration" CHECK ("staff_schedule_shifts"."ends_at" > "staff_schedule_shifts"."starts_at" AND "staff_schedule_shifts"."ends_at" <= "staff_schedule_shifts"."starts_at" + interval '16 hours'),
	CONSTRAINT "staff_schedule_shifts_day" CHECK ("staff_schedule_shifts"."day" BETWEEN 0 AND 6)
);
--> statement-breakpoint
CREATE TABLE "staff_schedules" (
	"company_id" uuid NOT NULL,
	"id" uuid NOT NULL,
	"business_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"week_start" date NOT NULL,
	"timezone" text NOT NULL,
	"revision" integer NOT NULL,
	CONSTRAINT "staff_schedules_company_id_id_pk" PRIMARY KEY("company_id","id"),
	CONSTRAINT "staff_schedules_week_key" UNIQUE("company_id","employee_id","branch_id","week_start"),
	CONSTRAINT "staff_schedules_employee_key" UNIQUE("company_id","id","employee_id"),
	CONSTRAINT "staff_schedules_saturday" CHECK (extract(dow from "staff_schedules"."week_start") = 6),
	CONSTRAINT "staff_schedules_revision" CHECK ("staff_schedules"."revision" > 0)
);
--> statement-breakpoint
CREATE TABLE "staff_shift_templates" (
	"company_id" uuid NOT NULL,
	"id" uuid NOT NULL,
	"business_id" uuid NOT NULL,
	"name_en" text NOT NULL,
	"name_ar" text,
	"shifts" jsonb NOT NULL,
	"revision" integer NOT NULL,
	"archived_at" timestamp with time zone,
	CONSTRAINT "staff_shift_templates_company_id_id_pk" PRIMARY KEY("company_id","id"),
	CONSTRAINT "staff_shift_templates_revision" CHECK ("staff_shift_templates"."revision" > 0)
);
--> statement-breakpoint
ALTER TABLE "staff_schedule_shifts" ADD CONSTRAINT "staff_schedule_shifts_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_schedule_shifts" ADD CONSTRAINT "staff_schedule_shifts_company_id_schedule_id_employee_id_staff_schedules_company_id_id_employee_id_fk" FOREIGN KEY ("company_id","schedule_id","employee_id") REFERENCES "public"."staff_schedules"("company_id","id","employee_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_schedules" ADD CONSTRAINT "staff_schedules_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_schedules" ADD CONSTRAINT "staff_schedules_company_id_business_id_employee_id_employees_company_id_business_id_id_fk" FOREIGN KEY ("company_id","business_id","employee_id") REFERENCES "public"."employees"("company_id","business_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_schedules" ADD CONSTRAINT "staff_schedules_company_id_business_id_branch_id_branches_company_id_business_id_id_fk" FOREIGN KEY ("company_id","business_id","branch_id") REFERENCES "public"."branches"("company_id","business_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_shift_templates" ADD CONSTRAINT "staff_shift_templates_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_shift_templates" ADD CONSTRAINT "staff_shift_templates_company_id_business_id_businesses_company_id_id_fk" FOREIGN KEY ("company_id","business_id") REFERENCES "public"."businesses"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "staff_schedule_shifts_schedule_idx" ON "staff_schedule_shifts" USING btree ("company_id","schedule_id","starts_at");--> statement-breakpoint
CREATE INDEX "staff_schedule_shifts_employee_idx" ON "staff_schedule_shifts" USING btree ("company_id","employee_id","starts_at");--> statement-breakpoint
CREATE INDEX "staff_schedules_branch_week_idx" ON "staff_schedules" USING btree ("company_id","business_id","branch_id","week_start","employee_id");--> statement-breakpoint
CREATE INDEX "staff_shift_templates_business_idx" ON "staff_shift_templates" USING btree ("company_id","business_id","id");