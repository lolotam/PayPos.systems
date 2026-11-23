-- الفهارس هنا من غير CONCURRENTLY عن قصد: الجدول جديد وفاضي ومتعمل في نفس الملف، فمفيش قراءة ولا كتابة ممكن تتعطل (زي 0232).
CREATE TABLE "commission_carries" (
	"company_id" uuid NOT NULL,
	"id" uuid NOT NULL,
	"business_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"amount" numeric(14, 3) NOT NULL,
	"source_statement_id" uuid NOT NULL,
	"source_period" char(7) NOT NULL,
	"target_period" char(7) NOT NULL,
	"target_statement_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "commission_carries_pkey" PRIMARY KEY("company_id","id"),
	CONSTRAINT "commission_carries_source_key" UNIQUE("company_id","source_statement_id","employee_id","kind"),
	CONSTRAINT "commission_carries_kind" CHECK ("commission_carries"."kind" IN ('COMMISSION', 'TIP_CARD')),
	CONSTRAINT "commission_carries_amount" CHECK ("commission_carries"."amount" < 0),
	CONSTRAINT "commission_carries_target_after_source" CHECK ("commission_carries"."target_period" > "commission_carries"."source_period")
);
--> statement-breakpoint
ALTER TABLE "commission_carries" ADD CONSTRAINT "commission_carries_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commission_carries" ADD CONSTRAINT "commission_carries_employee_fk" FOREIGN KEY ("company_id","business_id","employee_id") REFERENCES "public"."employees"("company_id","business_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commission_carries" ADD CONSTRAINT "commission_carries_source_statement_fk" FOREIGN KEY ("company_id","business_id","source_period","source_statement_id") REFERENCES "public"."commission_statements"("company_id","business_id","period","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commission_carries" ADD CONSTRAINT "commission_carries_target_statement_fk" FOREIGN KEY ("company_id","business_id","target_period","target_statement_id") REFERENCES "public"."commission_statements"("company_id","business_id","period","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "commission_carries_employee_idx" ON "commission_carries" USING btree ("company_id","business_id","employee_id");--> statement-breakpoint
CREATE INDEX "commission_carries_source_statement_idx" ON "commission_carries" USING btree ("company_id","business_id","source_period","source_statement_id");--> statement-breakpoint
CREATE INDEX "commission_carries_target_statement_idx" ON "commission_carries" USING btree ("company_id","business_id","target_period","target_statement_id");