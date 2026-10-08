CREATE TABLE "package_type_components" (
	"company_id" uuid NOT NULL,
	"id" uuid NOT NULL,
	"package_type_id" uuid NOT NULL,
	"business_id" uuid NOT NULL,
	"service_id" uuid NOT NULL,
	"sessions" integer NOT NULL,
	"position" smallint NOT NULL,
	CONSTRAINT "package_type_components_pkey" PRIMARY KEY("company_id","id"),
	CONSTRAINT "package_type_components_type_service_key" UNIQUE("company_id","package_type_id","service_id"),
	CONSTRAINT "package_type_components_type_position_key" UNIQUE("company_id","package_type_id","position"),
	CONSTRAINT "package_type_components_sessions" CHECK ("package_type_components"."sessions" BETWEEN 1 AND 365),
	CONSTRAINT "package_type_components_position" CHECK ("package_type_components"."position" BETWEEN 1 AND 20)
);
--> statement-breakpoint
CREATE TABLE "package_types" (
	"company_id" uuid NOT NULL,
	"id" uuid NOT NULL,
	"business_id" uuid NOT NULL,
	"name_en" text NOT NULL,
	"name_ar" text,
	"price" numeric(14, 3) NOT NULL,
	"validity_days" integer NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "package_types_pkey" PRIMARY KEY("company_id","id"),
	CONSTRAINT "package_types_company_business_id_key" UNIQUE("company_id","business_id","id"),
	CONSTRAINT "package_types_name_en_length" CHECK (char_length(trim("package_types"."name_en")) BETWEEN 1 AND 255),
	CONSTRAINT "package_types_name_ar_length" CHECK ("package_types"."name_ar" IS NULL OR char_length(trim("package_types"."name_ar")) BETWEEN 1 AND 255),
	CONSTRAINT "package_types_name_en_controls" CHECK ("package_types"."name_en" !~ '[[:cntrl:]]'),
	CONSTRAINT "package_types_name_ar_controls" CHECK ("package_types"."name_ar" IS NULL OR "package_types"."name_ar" !~ '[[:cntrl:]]'),
	CONSTRAINT "package_types_price_nonnegative" CHECK ("package_types"."price" BETWEEN 0 AND 99999999999.999),
	CONSTRAINT "package_types_validity_days" CHECK ("package_types"."validity_days" BETWEEN 1 AND 730),
	CONSTRAINT "package_types_revision_positive" CHECK ("package_types"."revision" > 0)
);
--> statement-breakpoint
ALTER TABLE "package_type_components" ADD CONSTRAINT "package_type_components_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "package_type_components" ADD CONSTRAINT "package_type_components_type_fk" FOREIGN KEY ("company_id","business_id","package_type_id") REFERENCES "public"."package_types"("company_id","business_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "package_type_components" ADD CONSTRAINT "package_type_components_service_fk" FOREIGN KEY ("company_id","business_id","service_id") REFERENCES "public"."services"("company_id","business_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "package_types" ADD CONSTRAINT "package_types_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "package_types" ADD CONSTRAINT "package_types_business_fk" FOREIGN KEY ("company_id","business_id") REFERENCES "public"."businesses"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "package_type_components_service_idx" ON "package_type_components" USING btree ("company_id","service_id");--> statement-breakpoint
CREATE INDEX "package_type_components_type_idx" ON "package_type_components" USING btree ("company_id","business_id","package_type_id");--> statement-breakpoint
CREATE UNIQUE INDEX "package_types_name_en_key" ON "package_types" USING btree ("company_id","business_id",lower(trim("name_en")));--> statement-breakpoint
CREATE UNIQUE INDEX "package_types_name_ar_key" ON "package_types" USING btree ("company_id","business_id",lower(trim("name_ar"))) WHERE "package_types"."name_ar" IS NOT NULL;
