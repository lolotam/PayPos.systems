CREATE TABLE "employee_ibans" (
	"company_id" uuid NOT NULL,
	"id" uuid NOT NULL,
	"business_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"revision" integer NOT NULL,
	"iban" text,
	"bank_id" text,
	"holder_name_en" text,
	"set_by" uuid NOT NULL,
	"reason" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "employee_ibans_pkey" PRIMARY KEY("company_id","id"),
	CONSTRAINT "employee_ibans_employee_revision_key" UNIQUE("company_id","employee_id","revision"),
	CONSTRAINT "employee_ibans_revision_positive" CHECK ("employee_ibans"."revision" > 0),
	CONSTRAINT "employee_ibans_fields_together" CHECK (("employee_ibans"."iban" IS NULL AND "employee_ibans"."bank_id" IS NULL AND "employee_ibans"."holder_name_en" IS NULL) OR ("employee_ibans"."iban" IS NOT NULL AND "employee_ibans"."bank_id" IS NOT NULL AND "employee_ibans"."holder_name_en" IS NOT NULL)),
	CONSTRAINT "employee_ibans_iban_shape" CHECK ("employee_ibans"."iban" ~ '^(KW[0-9]{2}[A-Z]{4}[A-Z0-9]{22}|SA[0-9]{4}[A-Z0-9]{18}|AE[0-9]{21}|BH[0-9]{2}[A-Z]{4}[A-Z0-9]{14}|QA[0-9]{2}[A-Z]{4}[A-Z0-9]{21}|OM[0-9]{5}[A-Z0-9]{16})$'),
	CONSTRAINT "employee_ibans_bank_shape" CHECK ("employee_ibans"."bank_id" ~ '^[a-z]{2}-[a-z0-9-]{1,40}$'),
	CONSTRAINT "employee_ibans_bank_country" CHECK (left("employee_ibans"."bank_id",2) = lower(left("employee_ibans"."iban",2))),
	CONSTRAINT "employee_ibans_holder_length" CHECK (char_length(trim("employee_ibans"."holder_name_en")) BETWEEN 1 AND 100),
	CONSTRAINT "employee_ibans_reason_length" CHECK (char_length(trim("employee_ibans"."reason")) BETWEEN 1 AND 500)
);
--> statement-breakpoint
ALTER TABLE "employee_ibans" ADD CONSTRAINT "employee_ibans_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_ibans" ADD CONSTRAINT "employee_ibans_set_by_user_id_fk" FOREIGN KEY ("set_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_ibans" ADD CONSTRAINT "employee_ibans_employee_fk" FOREIGN KEY ("company_id","business_id","employee_id") REFERENCES "public"."employees"("company_id","business_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "employee_ibans_company_business_idx" ON "employee_ibans" USING btree ("company_id","business_id");--> statement-breakpoint
CREATE INDEX "employee_ibans_set_by_idx" ON "employee_ibans" USING btree ("set_by");--> statement-breakpoint
CREATE INDEX "employee_ibans_company_iban_idx" ON "employee_ibans" USING btree ("company_id","iban") WHERE "employee_ibans"."iban" IS NOT NULL;