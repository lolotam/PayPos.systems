CREATE TABLE "employee_number_sequences" (
	"company_id" uuid NOT NULL,
	"next_number" integer DEFAULT 1 NOT NULL,
	"start_number" integer,
	"start_set_by" uuid,
	"start_set_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "employee_number_sequences_pkey" PRIMARY KEY("company_id"),
	CONSTRAINT "employee_number_sequences_next_range" CHECK ("employee_number_sequences"."next_number" BETWEEN 1 AND 1000000),
	CONSTRAINT "employee_number_sequences_start_range" CHECK ("employee_number_sequences"."start_number" IS NULL OR "employee_number_sequences"."start_number" BETWEEN 1 AND 999999),
	CONSTRAINT "employee_number_sequences_start_together" CHECK (("employee_number_sequences"."start_number" IS NULL AND "employee_number_sequences"."start_set_by" IS NULL AND "employee_number_sequences"."start_set_at" IS NULL) OR ("employee_number_sequences"."start_number" IS NOT NULL AND "employee_number_sequences"."start_set_by" IS NOT NULL AND "employee_number_sequences"."start_set_at" IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN "employee_number" integer;--> statement-breakpoint
ALTER TABLE "employee_number_sequences" ADD CONSTRAINT "employee_number_sequences_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_number_sequences" ADD CONSTRAINT "employee_number_sequences_start_set_by_user_id_fk" FOREIGN KEY ("start_set_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "employee_number_sequences_start_set_by_idx" ON "employee_number_sequences" USING btree ("start_set_by");--> statement-breakpoint
ALTER TABLE "employees" ADD CONSTRAINT "employees_employee_number_range" CHECK ("employees"."employee_number" IS NULL OR "employees"."employee_number" BETWEEN 1 AND 999999) NOT VALID;