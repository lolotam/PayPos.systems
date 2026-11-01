CREATE TABLE "commission_service_overrides" (
	"company_id" uuid NOT NULL,
	"id" uuid NOT NULL,
	"business_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"service_id" uuid NOT NULL,
	"rule_kind" text NOT NULL,
	"rule_pct_bps" integer,
	"rule_fixed_amount" numeric(14, 3),
	"effective_from" date NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"created_by" uuid NOT NULL,
	CONSTRAINT "commission_service_overrides_pkey" PRIMARY KEY("company_id","id"),
	CONSTRAINT "commission_service_overrides_rule_kind" CHECK ("commission_service_overrides"."rule_kind" IN ('FOLLOW_PLAN','FOLLOW_SERVICE','ZERO','PCT','FIXED')),
	CONSTRAINT "commission_service_overrides_rule_pct_present" CHECK (("commission_service_overrides"."rule_kind" = 'PCT') = ("commission_service_overrides"."rule_pct_bps" IS NOT NULL)),
	CONSTRAINT "commission_service_overrides_rule_pct_bounds" CHECK ("commission_service_overrides"."rule_pct_bps" IS NULL OR "commission_service_overrides"."rule_pct_bps" BETWEEN 0 AND 10000),
	CONSTRAINT "commission_service_overrides_rule_fixed_present" CHECK (("commission_service_overrides"."rule_kind" = 'FIXED') = ("commission_service_overrides"."rule_fixed_amount" IS NOT NULL)),
	CONSTRAINT "commission_service_overrides_rule_fixed_nonnegative" CHECK ("commission_service_overrides"."rule_fixed_amount" IS NULL OR "commission_service_overrides"."rule_fixed_amount" BETWEEN 0 AND 99999999999.999)
);
--> statement-breakpoint
ALTER TABLE "commission_service_overrides" ADD CONSTRAINT "commission_service_overrides_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commission_service_overrides" ADD CONSTRAINT "commission_service_overrides_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commission_service_overrides" ADD CONSTRAINT "commission_service_overrides_business_fk" FOREIGN KEY ("company_id","business_id") REFERENCES "public"."businesses"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commission_service_overrides" ADD CONSTRAINT "commission_service_overrides_employee_fk" FOREIGN KEY ("company_id","business_id","employee_id") REFERENCES "public"."employees"("company_id","business_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commission_service_overrides" ADD CONSTRAINT "commission_service_overrides_service_fk" FOREIGN KEY ("company_id","business_id","service_id") REFERENCES "public"."services"("company_id","business_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "commission_service_overrides_employee_service_idx" ON "commission_service_overrides" USING btree ("company_id","business_id","employee_id","service_id","created_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "commission_service_overrides_service_idx" ON "commission_service_overrides" USING btree ("company_id","business_id","service_id");--> statement-breakpoint
CREATE INDEX "commission_service_overrides_created_by_idx" ON "commission_service_overrides" USING btree ("created_by");