CREATE TABLE "commission_line_heads" (
	"company_id" uuid NOT NULL,
	"business_id" uuid NOT NULL,
	"line_id" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"service_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"revision" integer NOT NULL,
	"status" text NOT NULL,
	"business_date" date NOT NULL,
	"period" text NOT NULL,
	CONSTRAINT "commission_line_heads_pkey" PRIMARY KEY("company_id","line_id"),
	CONSTRAINT "commission_line_heads_revision_positive" CHECK ("commission_line_heads"."revision" > 0),
	CONSTRAINT "commission_line_heads_status" CHECK ("commission_line_heads"."status" IN ('ACTIVE','CANCELLED')),
	CONSTRAINT "commission_line_heads_period_format" CHECK ("commission_line_heads"."period" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
	CONSTRAINT "commission_line_heads_period_business_date" CHECK ("commission_line_heads"."period" = to_char("commission_line_heads"."business_date", 'YYYY-MM'))
);
--> statement-breakpoint
CREATE TABLE "commission_lines" (
	"company_id" uuid NOT NULL,
	"business_id" uuid NOT NULL,
	"line_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"service_id" uuid NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"recorded_at" timestamp with time zone NOT NULL,
	"business_date" date NOT NULL,
	"period" text NOT NULL,
	"net" numeric(14, 3) NOT NULL,
	"net_share" numeric(14, 3) NOT NULL,
	"share_bps" integer NOT NULL,
	"rule_kind" text NOT NULL,
	"rule_pct_bps" integer,
	"rule_fixed_amount" numeric(14, 3),
	"counts" boolean NOT NULL,
	"status" text NOT NULL,
	CONSTRAINT "commission_lines_pkey" PRIMARY KEY("company_id","line_id","employee_id"),
	CONSTRAINT "commission_lines_period_format" CHECK ("commission_lines"."period" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
	CONSTRAINT "commission_lines_period_business_date" CHECK ("commission_lines"."period" = to_char("commission_lines"."business_date", 'YYYY-MM')),
	CONSTRAINT "commission_lines_net_nonnegative" CHECK ("commission_lines"."net" >= 0),
	CONSTRAINT "commission_lines_net_share_nonnegative" CHECK ("commission_lines"."net_share" >= 0),
	CONSTRAINT "commission_lines_net_share_within_net" CHECK ("commission_lines"."net_share" <= "commission_lines"."net"),
	CONSTRAINT "commission_lines_share_bps_bounds" CHECK ("commission_lines"."share_bps" BETWEEN 1 AND 10000),
	CONSTRAINT "commission_lines_rule_kind" CHECK ("commission_lines"."rule_kind" IN ('FOLLOW_PLAN','ZERO','PCT','FIXED')),
	CONSTRAINT "commission_lines_rule_pct_present" CHECK (("commission_lines"."rule_kind" = 'PCT') = ("commission_lines"."rule_pct_bps" IS NOT NULL)),
	CONSTRAINT "commission_lines_rule_pct_bounds" CHECK ("commission_lines"."rule_pct_bps" IS NULL OR "commission_lines"."rule_pct_bps" BETWEEN 0 AND 10000),
	CONSTRAINT "commission_lines_rule_fixed_present" CHECK (("commission_lines"."rule_kind" = 'FIXED') = ("commission_lines"."rule_fixed_amount" IS NOT NULL)),
	CONSTRAINT "commission_lines_rule_fixed_nonnegative" CHECK ("commission_lines"."rule_fixed_amount" IS NULL OR "commission_lines"."rule_fixed_amount" BETWEEN 0 AND 99999999999.999),
	CONSTRAINT "commission_lines_status" CHECK ("commission_lines"."status" IN ('ACTIVE','CANCELLED'))
);
--> statement-breakpoint
ALTER TABLE "commission_line_heads" ADD CONSTRAINT "commission_line_heads_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commission_line_heads" ADD CONSTRAINT "commission_line_heads_business_fk" FOREIGN KEY ("company_id","business_id") REFERENCES "public"."businesses"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commission_line_heads" ADD CONSTRAINT "commission_line_heads_branch_fk" FOREIGN KEY ("company_id","business_id","branch_id") REFERENCES "public"."branches"("company_id","business_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commission_line_heads" ADD CONSTRAINT "commission_line_heads_service_fk" FOREIGN KEY ("company_id","business_id","service_id") REFERENCES "public"."services"("company_id","business_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commission_line_heads" ADD CONSTRAINT "commission_line_heads_customer_fk" FOREIGN KEY ("company_id","customer_id") REFERENCES "public"."customers"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commission_lines" ADD CONSTRAINT "commission_lines_head_fk" FOREIGN KEY ("company_id","line_id") REFERENCES "public"."commission_line_heads"("company_id","line_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commission_lines" ADD CONSTRAINT "commission_lines_employee_fk" FOREIGN KEY ("company_id","business_id","employee_id") REFERENCES "public"."employees"("company_id","business_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commission_lines" ADD CONSTRAINT "commission_lines_business_fk" FOREIGN KEY ("company_id","business_id") REFERENCES "public"."businesses"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "commission_line_heads_branch_idx" ON "commission_line_heads" USING btree ("company_id","business_id","branch_id");--> statement-breakpoint
CREATE INDEX "commission_line_heads_service_idx" ON "commission_line_heads" USING btree ("company_id","business_id","service_id");--> statement-breakpoint
CREATE INDEX "commission_line_heads_customer_idx" ON "commission_line_heads" USING btree ("company_id","customer_id");--> statement-breakpoint
CREATE INDEX "commission_lines_period_employee_idx" ON "commission_lines" USING btree ("company_id","business_id","period","employee_id");--> statement-breakpoint
CREATE INDEX "commission_lines_employee_idx" ON "commission_lines" USING btree ("company_id","business_id","employee_id");