CREATE TABLE "staff_schedule_settings" (
	"company_id" uuid NOT NULL,
	"business_id" uuid NOT NULL,
	"max_shifts_per_day" smallint NOT NULL,
	"updated_by" uuid NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "staff_schedule_settings_pkey" PRIMARY KEY("company_id","business_id"),
	CONSTRAINT "staff_schedule_settings_max_shifts_per_day" CHECK ("staff_schedule_settings"."max_shifts_per_day" BETWEEN 1 AND 4)
);
--> statement-breakpoint
ALTER TABLE "staff_schedule_settings" ADD CONSTRAINT "staff_schedule_settings_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_schedule_settings" ADD CONSTRAINT "staff_schedule_settings_business_fk" FOREIGN KEY ("company_id","business_id") REFERENCES "public"."businesses"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "staff_schedule_settings_updated_by_idx" ON "staff_schedule_settings" USING btree ("updated_by");