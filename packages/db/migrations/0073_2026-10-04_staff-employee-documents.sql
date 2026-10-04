CREATE TABLE "document_types" (
	"company_id" uuid NOT NULL,
	"id" uuid NOT NULL,
	"code" text NOT NULL,
	"name_en" text NOT NULL,
	"name_ar" text,
	"alert_days" integer NOT NULL,
	"requires_expiry" boolean NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "document_types_pkey" PRIMARY KEY("company_id","id"),
	CONSTRAINT "document_types_company_code_key" UNIQUE("company_id","code"),
	CONSTRAINT "document_types_code_format" CHECK ("document_types"."code" ~ '^[a-z][a-z0-9_]{1,63}$'),
	CONSTRAINT "document_types_alert_days" CHECK ("document_types"."alert_days" BETWEEN 0 AND 365),
	CONSTRAINT "document_types_revision_positive" CHECK ("document_types"."revision" > 0),
	CONSTRAINT "document_types_names" CHECK (char_length("document_types"."name_en") BETWEEN 1 AND 255 AND "document_types"."name_en"=btrim("document_types"."name_en") AND ("document_types"."name_ar" IS NULL OR (char_length("document_types"."name_ar") BETWEEN 1 AND 255 AND "document_types"."name_ar"=btrim("document_types"."name_ar"))))
);
--> statement-breakpoint
CREATE TABLE "employee_documents" (
	"company_id" uuid NOT NULL,
	"id" uuid NOT NULL,
	"business_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"type_code" text NOT NULL,
	"object_key" text NOT NULL,
	"expires_on" date,
	"uploaded_by" uuid NOT NULL,
	"recorded_at" timestamp with time zone NOT NULL,
	"replaced_at" timestamp with time zone,
	CONSTRAINT "employee_documents_pkey" PRIMARY KEY("company_id","id"),
	CONSTRAINT "employee_documents_company_object_key_key" UNIQUE("company_id","object_key"),
	CONSTRAINT "employee_documents_replaced_after_record" CHECK ("employee_documents"."replaced_at" IS NULL OR "employee_documents"."replaced_at" >= "employee_documents"."recorded_at")
);
--> statement-breakpoint
ALTER TABLE "document_types" ADD CONSTRAINT "document_types_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_documents" ADD CONSTRAINT "employee_documents_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_documents" ADD CONSTRAINT "employee_documents_uploaded_by_user_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_documents" ADD CONSTRAINT "employee_documents_employee_fk" FOREIGN KEY ("company_id","business_id","employee_id") REFERENCES "public"."employees"("company_id","business_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_documents" ADD CONSTRAINT "employee_documents_type_fk" FOREIGN KEY ("company_id","type_code") REFERENCES "public"."document_types"("company_id","code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "document_types_company_active_name_idx" ON "document_types" USING btree ("company_id","active","name_en","id");--> statement-breakpoint
CREATE UNIQUE INDEX "employee_documents_current_key" ON "employee_documents" USING btree ("company_id","employee_id","type_code") WHERE "employee_documents"."replaced_at" IS NULL;--> statement-breakpoint
CREATE INDEX "employee_documents_company_expires_idx" ON "employee_documents" USING btree ("company_id","expires_on") WHERE "employee_documents"."replaced_at" IS NULL AND "employee_documents"."expires_on" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "employee_documents_company_employee_idx" ON "employee_documents" USING btree ("company_id","employee_id","type_code","recorded_at");--> statement-breakpoint
CREATE INDEX "employee_documents_company_business_idx" ON "employee_documents" USING btree ("company_id","business_id");--> statement-breakpoint
CREATE INDEX "employee_documents_company_type_idx" ON "employee_documents" USING btree ("company_id","type_code");--> statement-breakpoint
CREATE INDEX "employee_documents_uploaded_by_idx" ON "employee_documents" USING btree ("uploaded_by");