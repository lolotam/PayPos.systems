CREATE TABLE "commission_salaries" (
	"company_id" uuid NOT NULL,
	"id" uuid NOT NULL,
	"business_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"effective_from" date NOT NULL,
	"amount" numeric(14, 3) NOT NULL,
	"revision" integer NOT NULL,
	CONSTRAINT "commission_salaries_company_id_id_pk" PRIMARY KEY("company_id","id"),
	CONSTRAINT "commission_salaries_effective_unique" UNIQUE("company_id","employee_id","effective_from"),
	CONSTRAINT "commission_salaries_revision_positive" CHECK ("commission_salaries"."revision" > 0),
	CONSTRAINT "commission_salaries_amount" CHECK ("commission_salaries"."amount" BETWEEN 0 AND 99999999999.999)
);
--> statement-breakpoint
CREATE TABLE "commission_tip_heads" (
	"company_id" uuid NOT NULL,
	"id" uuid NOT NULL,
	"business_id" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"revision" integer NOT NULL,
	"business_date" date NOT NULL,
	"period" text NOT NULL,
	CONSTRAINT "commission_tip_heads_company_id_id_pk" PRIMARY KEY("company_id","id"),
	CONSTRAINT "commission_tip_heads_session_unique" UNIQUE("company_id","session_id"),
	CONSTRAINT "commission_tip_heads_business_session_unique" UNIQUE("company_id","business_id","session_id"),
	CONSTRAINT "commission_tip_heads_revision_positive" CHECK ("commission_tip_heads"."revision" > 0),
	CONSTRAINT "commission_tip_heads_period_format" CHECK ("commission_tip_heads"."period" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
	CONSTRAINT "commission_tip_heads_period_date" CHECK ("commission_tip_heads"."period" = to_char("commission_tip_heads"."business_date", 'YYYY-MM'))
);
--> statement-breakpoint
CREATE TABLE "commission_tips" (
	"company_id" uuid NOT NULL,
	"id" uuid NOT NULL,
	"business_id" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"method" text NOT NULL,
	"amount" numeric(14, 3) NOT NULL,
	CONSTRAINT "commission_tips_company_id_id_pk" PRIMARY KEY("company_id","id"),
	CONSTRAINT "commission_tips_entry_unique" UNIQUE("company_id","session_id","employee_id","method"),
	CONSTRAINT "commission_tips_method" CHECK ("commission_tips"."method" IN ('CASH', 'CARD')),
	CONSTRAINT "commission_tips_amount" CHECK ("commission_tips"."amount" BETWEEN 0 AND 99999999999.999)
);
--> statement-breakpoint
ALTER TABLE "commission_salaries" ADD CONSTRAINT "commission_salaries_company_id_business_id_businesses_company_id_id_fk" FOREIGN KEY ("company_id","business_id") REFERENCES "public"."businesses"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commission_salaries" ADD CONSTRAINT "commission_salaries_company_id_business_id_employee_id_employees_company_id_business_id_id_fk" FOREIGN KEY ("company_id","business_id","employee_id") REFERENCES "public"."employees"("company_id","business_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commission_tip_heads" ADD CONSTRAINT "commission_tip_heads_company_id_business_id_businesses_company_id_id_fk" FOREIGN KEY ("company_id","business_id") REFERENCES "public"."businesses"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commission_tip_heads" ADD CONSTRAINT "commission_tip_heads_company_id_business_id_branch_id_branches_company_id_business_id_id_fk" FOREIGN KEY ("company_id","business_id","branch_id") REFERENCES "public"."branches"("company_id","business_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commission_tips" ADD CONSTRAINT "commission_tips_company_id_business_id_session_id_commission_tip_heads_company_id_business_id_session_id_fk" FOREIGN KEY ("company_id","business_id","session_id") REFERENCES "public"."commission_tip_heads"("company_id","business_id","session_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commission_tips" ADD CONSTRAINT "commission_tips_company_id_business_id_employee_id_employees_company_id_business_id_id_fk" FOREIGN KEY ("company_id","business_id","employee_id") REFERENCES "public"."employees"("company_id","business_id","id") ON DELETE no action ON UPDATE no action;