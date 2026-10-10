CREATE TABLE "staff_branch_schedule_settings" (
	"company_id" uuid NOT NULL,
	"business_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"max_shifts_per_day" smallint NOT NULL,
	"updated_by" uuid NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "staff_branch_schedule_settings_pkey" PRIMARY KEY("company_id","branch_id"),
	CONSTRAINT "staff_branch_schedule_settings_max_shifts_per_day" CHECK ("staff_branch_schedule_settings"."max_shifts_per_day" BETWEEN 1 AND 4)
);
--> statement-breakpoint
ALTER TABLE "staff_branch_schedule_settings" ADD CONSTRAINT "staff_branch_schedule_settings_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_branch_schedule_settings" ADD CONSTRAINT "staff_branch_schedule_settings_branch_fk" FOREIGN KEY ("company_id","business_id","branch_id") REFERENCES "public"."branches"("company_id","business_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "staff_branch_schedule_settings_updated_by_idx" ON "staff_branch_schedule_settings" USING btree ("updated_by");
--> statement-breakpoint
CREATE INDEX "staff_branch_schedule_settings_company_business_idx" ON "staff_branch_schedule_settings" USING btree ("company_id","business_id");
