CREATE TABLE "commission_corrections" (
	"company_id" uuid NOT NULL,
	"id" uuid NOT NULL,
	"business_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"source_period" char(7) NOT NULL,
	"target_period" char(7) NOT NULL,
	"target_statement_id" uuid NOT NULL,
	"source_ref" text NOT NULL,
	"kind" text NOT NULL,
	"amount" numeric(14, 3) NOT NULL,
	"previous_amount" numeric(14, 3) NOT NULL,
	"new_amount" numeric(14, 3) NOT NULL,
	"generation" integer NOT NULL,
	"event_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"source_branch_id" uuid NOT NULL,
	"source_business_date" date NOT NULL,
	"attached_branch_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	CONSTRAINT "commission_corrections_pkey" PRIMARY KEY("company_id","id"),
	CONSTRAINT "commission_corrections_source_key" UNIQUE("company_id","source_period","employee_id","source_ref","generation"),
	CONSTRAINT "commission_corrections_kind" CHECK ("commission_corrections"."kind" IN ('COMMISSION','SALE','TIP_CARD','TIP_CASH')),
	CONSTRAINT "commission_corrections_amounts" CHECK ("commission_corrections"."amount" <> 'NaN'::numeric
        AND "commission_corrections"."previous_amount" <> 'NaN'::numeric
        AND "commission_corrections"."new_amount" <> 'NaN'::numeric),
	CONSTRAINT "commission_corrections_amount" CHECK ("commission_corrections"."amount" = "commission_corrections"."new_amount" - "commission_corrections"."previous_amount"),
	CONSTRAINT "commission_corrections_generation" CHECK ("commission_corrections"."generation" > 0),
	CONSTRAINT "commission_corrections_source_period" CHECK ("commission_corrections"."source_period" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$' AND substr("commission_corrections"."source_period", 1, 4) <> '0000'),
	CONSTRAINT "commission_corrections_target_period" CHECK ("commission_corrections"."target_period" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$' AND substr("commission_corrections"."target_period", 1, 4) <> '0000'),
	CONSTRAINT "commission_corrections_target_after_source" CHECK ("commission_corrections"."target_period" > "commission_corrections"."source_period")
);
--> statement-breakpoint
CREATE TABLE "commission_period_generations" (
	"company_id" uuid NOT NULL,
	"id" uuid NOT NULL,
	"business_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"period" char(7) NOT NULL,
	"generation" integer NOT NULL,
	CONSTRAINT "commission_period_generations_pkey" PRIMARY KEY("company_id","id"),
	CONSTRAINT "commission_period_generations_employee_period_unique" UNIQUE("company_id","employee_id","period"),
	CONSTRAINT "commission_period_generations_period" CHECK ("commission_period_generations"."period" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$' AND substr("commission_period_generations"."period", 1, 4) <> '0000'),
	CONSTRAINT "commission_period_generations_generation" CHECK ("commission_period_generations"."generation" > 0)
);
--> statement-breakpoint
ALTER TABLE "commission_corrections" ADD CONSTRAINT "commission_corrections_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commission_corrections" ADD CONSTRAINT "commission_corrections_employee_fk" FOREIGN KEY ("company_id","business_id","employee_id") REFERENCES "public"."employees"("company_id","business_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commission_corrections" ADD CONSTRAINT "commission_corrections_target_statement_fk" FOREIGN KEY ("company_id","business_id","target_period","target_statement_id") REFERENCES "public"."commission_statements"("company_id","business_id","period","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commission_corrections" ADD CONSTRAINT "commission_corrections_source_branch_fk" FOREIGN KEY ("company_id","business_id","source_branch_id") REFERENCES "public"."branches"("company_id","business_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commission_period_generations" ADD CONSTRAINT "commission_period_generations_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commission_period_generations" ADD CONSTRAINT "commission_period_generations_employee_fk" FOREIGN KEY ("company_id","business_id","employee_id") REFERENCES "public"."employees"("company_id","business_id","id") ON DELETE no action ON UPDATE no action;
