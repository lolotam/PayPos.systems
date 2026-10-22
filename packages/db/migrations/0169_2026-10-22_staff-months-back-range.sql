-- pospay:data-step staff-months-back
ALTER TABLE "business_settings" DROP CONSTRAINT "business_settings_staff_months_back";--> statement-breakpoint
ALTER TABLE "business_settings" ADD CONSTRAINT "business_settings_staff_months_back" CHECK ("business_settings"."staff_months_back" IS NULL OR "business_settings"."staff_months_back" BETWEEN 1 AND 12) NOT VALID;
