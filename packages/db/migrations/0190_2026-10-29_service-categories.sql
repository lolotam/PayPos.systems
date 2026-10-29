CREATE TABLE "service_categories" (
	"company_id" uuid NOT NULL,
	"id" uuid NOT NULL,
	"business_id" uuid NOT NULL,
	"name_en" text NOT NULL,
	"name_ar" text NOT NULL,
	"owner_branch_id" uuid,
	"visibility" text NOT NULL,
	"closed_at" timestamp with time zone,
	"revision" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "service_categories_pkey" PRIMARY KEY("company_id","id"),
	CONSTRAINT "service_categories_company_business_id_key" UNIQUE("company_id","business_id","id"),
	CONSTRAINT "service_categories_name_en_length" CHECK (char_length(btrim("service_categories"."name_en")) BETWEEN 1 AND 100),
	CONSTRAINT "service_categories_name_ar_length" CHECK (char_length(btrim("service_categories"."name_ar")) BETWEEN 1 AND 100),
	CONSTRAINT "service_categories_name_en_controls" CHECK ("service_categories"."name_en" !~ '[[:cntrl:]]'),
	CONSTRAINT "service_categories_name_ar_controls" CHECK ("service_categories"."name_ar" !~ '[[:cntrl:]]'),
	CONSTRAINT "service_categories_name_en_normalized" CHECK ("service_categories"."name_en" = btrim(regexp_replace("service_categories"."name_en", '[[:space:]]+', ' ', 'g'))),
	CONSTRAINT "service_categories_name_ar_normalized" CHECK ("service_categories"."name_ar" = btrim(regexp_replace("service_categories"."name_ar", '[[:space:]]+', ' ', 'g'))),
	CONSTRAINT "service_categories_visibility" CHECK ("service_categories"."visibility" IN ('BUSINESS','BRANCH')),
	CONSTRAINT "service_categories_branch_owner_required" CHECK ("service_categories"."visibility" <> 'BRANCH' OR "service_categories"."owner_branch_id" IS NOT NULL),
	CONSTRAINT "service_categories_revision_positive" CHECK ("service_categories"."revision" > 0)
);
--> statement-breakpoint
ALTER TABLE "service_categories" ADD CONSTRAINT "service_categories_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_categories" ADD CONSTRAINT "service_categories_business_fk" FOREIGN KEY ("company_id","business_id") REFERENCES "public"."businesses"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_categories" ADD CONSTRAINT "service_categories_owner_branch_fk" FOREIGN KEY ("company_id","business_id","owner_branch_id") REFERENCES "public"."branches"("company_id","business_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "service_categories_business_name_uq" ON "service_categories" USING btree ("company_id","business_id",lower("name_en"));--> statement-breakpoint
CREATE INDEX "service_categories_owner_branch_idx" ON "service_categories" USING btree ("company_id","business_id","owner_branch_id");--> statement-breakpoint
ALTER TABLE service_categories ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE service_categories FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY service_categories_select ON service_categories FOR SELECT TO pospay_app
  USING (company_id=app_company_id());
--> statement-breakpoint
CREATE POLICY service_categories_insert ON service_categories FOR INSERT TO pospay_app
  WITH CHECK (company_id=app_company_id());
--> statement-breakpoint
CREATE POLICY service_categories_update ON service_categories FOR UPDATE TO pospay_app
  USING (company_id=app_company_id()) WITH CHECK (company_id=app_company_id());
--> statement-breakpoint
GRANT SELECT, INSERT ON service_categories TO pospay_app;
--> statement-breakpoint
GRANT UPDATE (name_en,name_ar,visibility,closed_at,updated_at,revision) ON service_categories TO pospay_app;
--> statement-breakpoint
INSERT INTO permissions(code) VALUES
  ('manage:service-categories:business'),
  ('read:service-categories:business'),
  ('manage:service-categories:branch'),
  ('read:service-categories:branch')
ON CONFLICT DO NOTHING;
--> statement-breakpoint
INSERT INTO role_permissions(role_id,role_owner_key,company_id,permission_code)
SELECT r.id,'global',NULL,p.code FROM roles r CROSS JOIN permissions p
WHERE r.company_id IS NULL AND
((r.code IN ('owner','general_manager','business_manager') AND p.code IN ('manage:service-categories:business','read:service-categories:business'))
OR (r.code IN ('owner','general_manager','business_manager','branch_manager') AND p.code IN ('manage:service-categories:branch','read:service-categories:branch')))
ON CONFLICT DO NOTHING;
