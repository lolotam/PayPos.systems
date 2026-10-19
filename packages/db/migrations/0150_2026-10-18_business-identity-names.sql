ALTER TABLE "business_settings" ADD COLUMN "official_name_ar" text;--> statement-breakpoint
ALTER TABLE "business_settings" ADD COLUMN "official_name_en" text;--> statement-breakpoint
ALTER TABLE "business_settings" ADD COLUMN "logo_file_id" uuid;--> statement-breakpoint
ALTER TABLE "business_settings" ADD CONSTRAINT "business_settings_logo_file_fk" FOREIGN KEY ("company_id","logo_file_id") REFERENCES "public"."file_objects"("company_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "business_settings" ADD CONSTRAINT "business_settings_official_name_ar" CHECK ("business_settings"."official_name_ar" IS NULL OR char_length("business_settings"."official_name_ar") BETWEEN 1 AND 255);--> statement-breakpoint
ALTER TABLE "business_settings" ADD CONSTRAINT "business_settings_official_name_en" CHECK ("business_settings"."official_name_en" IS NULL OR char_length("business_settings"."official_name_en") BETWEEN 1 AND 255);
