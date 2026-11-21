CREATE TABLE "commission_sales" (
	"company_id" uuid NOT NULL,
	"id" uuid NOT NULL,
	"business_id" uuid NOT NULL,
	"sale_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"seller_employee_id" uuid,
	"business_date" date NOT NULL,
	"period" text NOT NULL,
	"price_paid" numeric(14, 3) NOT NULL,
	"refunded_amount" numeric(14, 3) NOT NULL,
	"status" text NOT NULL,
	"revision" integer NOT NULL,
	CONSTRAINT "commission_sales_company_id_id_pk" PRIMARY KEY("company_id","id"),
	CONSTRAINT "commission_sales_sale_unique" UNIQUE("company_id","sale_id"),
	CONSTRAINT "commission_sales_revision_positive" CHECK ("commission_sales"."revision" > 0),
	CONSTRAINT "commission_sales_period_format" CHECK ("commission_sales"."period" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
	CONSTRAINT "commission_sales_period_date" CHECK ("commission_sales"."period" = to_char("commission_sales"."business_date", 'YYYY-MM')),
	CONSTRAINT "commission_sales_price_paid" CHECK ("commission_sales"."price_paid" BETWEEN 0 AND 99999999999.999),
	CONSTRAINT "commission_sales_refunded_amount" CHECK ("commission_sales"."refunded_amount" BETWEEN 0 AND "commission_sales"."price_paid"),
	CONSTRAINT "commission_sales_status" CHECK ("commission_sales"."status" IN ('SOLD'))
);
--> statement-breakpoint
ALTER TABLE "commission_sales" ADD CONSTRAINT "commission_sales_company_id_business_id_businesses_company_id_id_fk" FOREIGN KEY ("company_id","business_id") REFERENCES "public"."businesses"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commission_sales" ADD CONSTRAINT "commission_sales_company_id_business_id_branch_id_branches_company_id_business_id_id_fk" FOREIGN KEY ("company_id","business_id","branch_id") REFERENCES "public"."branches"("company_id","business_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commission_sales" ADD CONSTRAINT "commission_sales_company_id_business_id_seller_employee_id_employees_company_id_business_id_id_fk" FOREIGN KEY ("company_id","business_id","seller_employee_id") REFERENCES "public"."employees"("company_id","business_id","id") ON DELETE no action ON UPDATE no action;