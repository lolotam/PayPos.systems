CREATE TABLE "branches" (
	"id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"business_id" uuid NOT NULL,
	"name_ar" text,
	"name_en" text NOT NULL,
	"address_ar" text,
	"address_en" text,
	"geo_lat" double precision,
	"geo_lng" double precision,
	"opening_hours" jsonb,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "branches_company_id_id_key" UNIQUE("company_id","id"),
	CONSTRAINT "branches_geo_pair" CHECK (("branches"."geo_lat" IS NULL) = ("branches"."geo_lng" IS NULL)),
	CONSTRAINT "branches_geo_lat_range" CHECK ("branches"."geo_lat" IS NULL OR "branches"."geo_lat" BETWEEN -90 AND 90),
	CONSTRAINT "branches_geo_lng_range" CHECK ("branches"."geo_lng" IS NULL OR "branches"."geo_lng" BETWEEN -180 AND 180),
	CONSTRAINT "branches_address_ar_length" CHECK ("branches"."address_ar" IS NULL OR char_length("branches"."address_ar") BETWEEN 1 AND 500),
	CONSTRAINT "branches_address_en_length" CHECK ("branches"."address_en" IS NULL OR char_length("branches"."address_en") BETWEEN 1 AND 500),
	CONSTRAINT "branches_name_en_length" CHECK (char_length("branches"."name_en") BETWEEN 1 AND 255),
	CONSTRAINT "branches_name_ar_length" CHECK ("branches"."name_ar" IS NULL OR char_length("branches"."name_ar") BETWEEN 1 AND 255)
);
--> statement-breakpoint
CREATE TABLE "businesses" (
	"id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"vertical_type" text NOT NULL,
	"name_ar" text,
	"name_en" text NOT NULL,
	"currency" text DEFAULT 'KWD' NOT NULL,
	"timezone" text DEFAULT 'Asia/Kuwait' NOT NULL,
	"settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "businesses_company_id_id_key" UNIQUE("company_id","id"),
	CONSTRAINT "businesses_vertical_type" CHECK ("businesses"."vertical_type" IN ('restaurant', 'salon', 'laundry', 'retail', 'services')),
	CONSTRAINT "businesses_currency_format" CHECK ("businesses"."currency" ~ '^[A-Z]{3}$'),
	CONSTRAINT "businesses_name_en_length" CHECK (char_length("businesses"."name_en") BETWEEN 1 AND 255),
	CONSTRAINT "businesses_name_ar_length" CHECK ("businesses"."name_ar" IS NULL OR char_length("businesses"."name_ar") BETWEEN 1 AND 255)
);
--> statement-breakpoint
CREATE TABLE "companies" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name_ar" text,
	"name_en" text NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"plan_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "companies_name_en_length" CHECK (char_length("companies"."name_en") BETWEEN 1 AND 255),
	CONSTRAINT "companies_name_ar_length" CHECK ("companies"."name_ar" IS NULL OR char_length("companies"."name_ar") BETWEEN 1 AND 255)
);
--> statement-breakpoint
CREATE TABLE "company_feature_overrides" (
	"company_id" uuid NOT NULL,
	"flag" text NOT NULL,
	"enabled" boolean NOT NULL,
	"reason" text NOT NULL,
	"set_by" uuid NOT NULL,
	"set_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone,
	CONSTRAINT "company_feature_overrides_pkey" PRIMARY KEY("company_id","flag")
);
--> statement-breakpoint
CREATE TABLE "plans" (
	"id" uuid PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"name_ar" text,
	"name_en" text NOT NULL,
	"feature_flags" jsonb DEFAULT '{}'::jsonb NOT NULL,
	CONSTRAINT "plans_code_unique" UNIQUE("code")
);
--> statement-breakpoint
ALTER TABLE "branches" ADD CONSTRAINT "branches_business_fk" FOREIGN KEY ("company_id","business_id") REFERENCES "public"."businesses"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "businesses" ADD CONSTRAINT "businesses_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "companies" ADD CONSTRAINT "companies_plan_id_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."plans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_feature_overrides" ADD CONSTRAINT "company_feature_overrides_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "branches_company_id_business_id_idx" ON "branches" USING btree ("company_id","business_id");--> statement-breakpoint
CREATE INDEX "businesses_company_id_created_at_idx" ON "businesses" USING btree ("company_id","created_at");--> statement-breakpoint
CREATE INDEX "companies_plan_id_idx" ON "companies" USING btree ("plan_id");