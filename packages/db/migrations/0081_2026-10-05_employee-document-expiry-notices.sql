CREATE INDEX CONCURRENTLY "employee_document_expiry_scan_idx" ON "employee_documents" USING btree ("company_id","business_id","expires_on") WHERE "employee_documents"."replaced_at" IS NULL AND "employee_documents"."expires_on" IS NOT NULL;--> statement-breakpoint
CREATE TABLE "employee_document_expiry_notices" (
	"company_id" uuid NOT NULL,
	"id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"business_id" uuid NOT NULL,
	"type_code" text NOT NULL,
	"expires_on" date NOT NULL,
	"notified_at" timestamp with time zone NOT NULL,
	"recipients_attached_at" timestamp with time zone,
	CONSTRAINT "employee_document_expiry_notices_pkey" PRIMARY KEY("company_id","id"),
	CONSTRAINT "employee_document_expiry_notices_key" UNIQUE("company_id","document_id","expires_on")
);
--> statement-breakpoint
ALTER TABLE "employee_document_expiry_notices" ADD CONSTRAINT "employee_document_expiry_notices_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_document_expiry_notices" ADD CONSTRAINT "employee_document_expiry_notices_document_fk" FOREIGN KEY ("company_id","document_id") REFERENCES "public"."employee_documents"("company_id","id") ON DELETE no action ON UPDATE no action;
