CREATE TABLE "services" (
	"company_id" uuid NOT NULL,
	"id" uuid NOT NULL,
	"business_id" uuid NOT NULL,
	"name_en" text NOT NULL,
	"name_ar" text,
	"price" numeric(14, 3) NOT NULL,
	"commission_rule_kind" text NOT NULL,
	"commission_pct_bps" integer,
	"commission_fixed_amount" numeric(14, 3),
	"counts_toward_threshold" boolean DEFAULT true NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "services_pkey" PRIMARY KEY("company_id","id"),
	CONSTRAINT "services_company_business_id_key" UNIQUE("company_id","business_id","id"),
	CONSTRAINT "services_name_en_length" CHECK (char_length(trim("services"."name_en")) BETWEEN 1 AND 255),
	CONSTRAINT "services_name_ar_length" CHECK ("services"."name_ar" IS NULL OR char_length(trim("services"."name_ar")) BETWEEN 1 AND 255),
	CONSTRAINT "services_price_nonnegative" CHECK ("services"."price" BETWEEN 0 AND 99999999999.999),
	CONSTRAINT "services_rule_kind" CHECK ("services"."commission_rule_kind" IN ('FOLLOW_PLAN','ZERO','PCT','FIXED')),
	CONSTRAINT "services_rule_pct_present" CHECK (("services"."commission_rule_kind" = 'PCT') = ("services"."commission_pct_bps" IS NOT NULL)),
	CONSTRAINT "services_rule_pct_bounds" CHECK ("services"."commission_pct_bps" IS NULL OR "services"."commission_pct_bps" BETWEEN 0 AND 10000),
	CONSTRAINT "services_rule_fixed_present" CHECK (("services"."commission_rule_kind" = 'FIXED') = ("services"."commission_fixed_amount" IS NOT NULL)),
	CONSTRAINT "services_rule_fixed_nonnegative" CHECK ("services"."commission_fixed_amount" IS NULL OR "services"."commission_fixed_amount" BETWEEN 0 AND 99999999999.999),
	CONSTRAINT "services_name_en_controls" CHECK ("services"."name_en" !~ '[[:cntrl:]]'),
	CONSTRAINT "services_name_ar_controls" CHECK ("services"."name_ar" IS NULL OR "services"."name_ar" !~ '[[:cntrl:]]'),
	CONSTRAINT "services_revision_positive" CHECK ("services"."revision" > 0)
);
--> statement-breakpoint
ALTER TABLE "services" ADD CONSTRAINT "services_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "services" ADD CONSTRAINT "services_business_fk" FOREIGN KEY ("company_id","business_id") REFERENCES "public"."businesses"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "services_company_business_id_idx" ON "services" USING btree ("company_id","business_id","id");