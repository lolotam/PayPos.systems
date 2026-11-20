CREATE TABLE "commission_blocked_corrections" (
	"company_id" uuid NOT NULL,
	"id" uuid NOT NULL,
	"business_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"source_period" char(7) NOT NULL,
	"code" text NOT NULL,
	"first_event_id" uuid NOT NULL,
	"target_period" char(7) NOT NULL,
	"target_statement_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone,
	"resolved_generation" integer,
	CONSTRAINT "commission_blocked_corrections_pkey" PRIMARY KEY("company_id","id"),
	CONSTRAINT "commission_blocked_corrections_code" CHECK ("commission_blocked_corrections"."code" IN ('NO_PLAN','NO_SALARY')),
	CONSTRAINT "commission_blocked_corrections_source_period" CHECK ("commission_blocked_corrections"."source_period" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$' AND substr("commission_blocked_corrections"."source_period", 1, 4) <> '0000'),
	CONSTRAINT "commission_blocked_corrections_target_period" CHECK ("commission_blocked_corrections"."target_period" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$' AND substr("commission_blocked_corrections"."target_period", 1, 4) <> '0000'),
	CONSTRAINT "commission_blocked_corrections_target_after_source" CHECK ("commission_blocked_corrections"."target_period" > "commission_blocked_corrections"."source_period"),
	CONSTRAINT "commission_blocked_corrections_resolution_pair" CHECK (("commission_blocked_corrections"."resolved_at" IS NULL) = ("commission_blocked_corrections"."resolved_generation" IS NULL)),
	CONSTRAINT "commission_blocked_corrections_resolution_generation" CHECK ("commission_blocked_corrections"."resolved_generation" > 0)
);
--> statement-breakpoint
ALTER TABLE "commission_blocked_corrections" ADD CONSTRAINT "commission_blocked_corrections_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commission_blocked_corrections" ADD CONSTRAINT "commission_blocked_corrections_employee_fk" FOREIGN KEY ("company_id","business_id","employee_id") REFERENCES "public"."employees"("company_id","business_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commission_blocked_corrections" ADD CONSTRAINT "commission_blocked_corrections_target_statement_fk" FOREIGN KEY ("company_id","business_id","target_period","target_statement_id") REFERENCES "public"."commission_statements"("company_id","business_id","period","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "commission_blocked_corrections_open_key" ON "commission_blocked_corrections" USING btree ("company_id","employee_id","source_period") WHERE "commission_blocked_corrections"."resolved_at" IS NULL;--> statement-breakpoint
CREATE INDEX "commission_blocked_corrections_target_statement_open_idx" ON "commission_blocked_corrections" USING btree ("company_id","target_statement_id") WHERE "commission_blocked_corrections"."resolved_at" IS NULL;--> statement-breakpoint
CREATE INDEX "commission_blocked_corrections_list_idx" ON "commission_blocked_corrections" USING btree ("company_id","business_id","created_at","id");--> statement-breakpoint
CREATE INDEX "commission_blocked_corrections_employee_idx" ON "commission_blocked_corrections" USING btree ("company_id","business_id","employee_id");--> statement-breakpoint
CREATE INDEX "commission_blocked_corrections_target_statement_idx" ON "commission_blocked_corrections" USING btree ("company_id","business_id","target_period","target_statement_id");