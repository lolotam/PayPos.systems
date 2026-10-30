CREATE TABLE "service_category_branch_settings" (
	"company_id" uuid NOT NULL,
	"id" uuid NOT NULL,
	"business_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"category_id" uuid NOT NULL,
	"state" text NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "service_category_branch_settings_pkey" PRIMARY KEY("company_id","id"),
	CONSTRAINT "service_category_branch_settings_state" CHECK ("service_category_branch_settings"."state" IN ('ENABLED','HIDDEN')),
	CONSTRAINT "service_category_branch_settings_revision_positive" CHECK ("service_category_branch_settings"."revision" > 0)
);
--> statement-breakpoint
ALTER TABLE "service_category_branch_settings" ADD CONSTRAINT "service_category_branch_settings_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_category_branch_settings" ADD CONSTRAINT "service_category_branch_settings_branch_fk" FOREIGN KEY ("company_id","business_id","branch_id") REFERENCES "public"."branches"("company_id","business_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_category_branch_settings" ADD CONSTRAINT "service_category_branch_settings_category_fk" FOREIGN KEY ("company_id","business_id","category_id") REFERENCES "public"."service_categories"("company_id","business_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "service_category_branch_settings_branch_category_uq" ON "service_category_branch_settings" USING btree ("company_id","branch_id","category_id");--> statement-breakpoint
CREATE INDEX "service_category_branch_settings_branch_idx" ON "service_category_branch_settings" USING btree ("company_id","business_id","branch_id");--> statement-breakpoint
CREATE INDEX "service_category_branch_settings_category_idx" ON "service_category_branch_settings" USING btree ("company_id","business_id","category_id");--> statement-breakpoint
ALTER TABLE service_category_branch_settings ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE service_category_branch_settings FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY service_category_branch_settings_select ON service_category_branch_settings FOR SELECT TO pospay_app
  USING (company_id=app_company_id());
--> statement-breakpoint
CREATE POLICY service_category_branch_settings_insert ON service_category_branch_settings FOR INSERT TO pospay_app
  WITH CHECK (company_id=app_company_id());
--> statement-breakpoint
CREATE POLICY service_category_branch_settings_update ON service_category_branch_settings FOR UPDATE TO pospay_app
  USING (company_id=app_company_id()) WITH CHECK (company_id=app_company_id());
--> statement-breakpoint
GRANT SELECT, INSERT ON service_category_branch_settings TO pospay_app;
--> statement-breakpoint
GRANT UPDATE (state,updated_at,revision) ON service_category_branch_settings TO pospay_app;
