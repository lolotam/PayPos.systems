CREATE TABLE "customers" (
	"company_id" uuid NOT NULL,
	"id" uuid NOT NULL,
	"name" text NOT NULL,
	"phone" text NOT NULL,
	"locale" text NOT NULL,
	"opted_out_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "customers_pkey" PRIMARY KEY("company_id","id"),
	CONSTRAINT "customers_company_phone_unique" UNIQUE("company_id","phone"),
	CONSTRAINT "customers_phone_e164" CHECK ("customers"."phone" ~ '^[+][1-9][0-9]{1,14}$'),
	CONSTRAINT "customers_locale" CHECK ("customers"."locale" IN ('ar', 'en')),
	CONSTRAINT "customers_name" CHECK (length(btrim("customers"."name")) BETWEEN 1 AND 200)
);
--> statement-breakpoint
ALTER TABLE "customers" ADD CONSTRAINT "customers_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;