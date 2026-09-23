CREATE TABLE "business_settings" (
	"company_id" uuid NOT NULL,
	"business_id" uuid NOT NULL,
	"default_language" text,
	"calendar" text,
	"tax_rule" jsonb,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "business_settings_pkey" PRIMARY KEY("company_id","business_id"),
	CONSTRAINT "business_settings_language" CHECK ("business_settings"."default_language" IS NULL OR "business_settings"."default_language" IN ('ar', 'en')),
	CONSTRAINT "business_settings_calendar" CHECK ("business_settings"."calendar" IS NULL OR "business_settings"."calendar" IN ('gregorian', 'hijri'))
);
--> statement-breakpoint
ALTER TABLE "business_settings" ADD CONSTRAINT "business_settings_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "business_settings" ADD CONSTRAINT "business_settings_business_fk" FOREIGN KEY ("company_id","business_id") REFERENCES "public"."businesses"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "business_settings_updated_by_idx" ON "business_settings" USING btree ("updated_by");