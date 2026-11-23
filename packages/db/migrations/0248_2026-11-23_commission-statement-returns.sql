CREATE TABLE "commission_statement_returns" (
	"company_id" uuid NOT NULL,
	"id" uuid NOT NULL,
	"business_id" uuid NOT NULL,
	"statement_id" uuid NOT NULL,
	"returned_by" uuid NOT NULL,
	"returned_membership_id" uuid NOT NULL,
	"reason" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "commission_statement_returns_pkey" PRIMARY KEY("company_id","id"),
	CONSTRAINT "commission_statement_returns_reason" CHECK (char_length("commission_statement_returns"."reason") BETWEEN 1 AND 500)
);
--> statement-breakpoint
ALTER TABLE "commission_statement_returns" ADD CONSTRAINT "commission_statement_returns_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commission_statement_returns" ADD CONSTRAINT "commission_statement_returns_returned_by_user_id_fk" FOREIGN KEY ("returned_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commission_statement_returns" ADD CONSTRAINT "commission_statement_returns_statement_fk" FOREIGN KEY ("company_id","business_id","statement_id") REFERENCES "public"."commission_statements"("company_id","business_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commission_statement_returns" ADD CONSTRAINT "commission_statement_returns_membership_fk" FOREIGN KEY ("company_id","returned_by","returned_membership_id") REFERENCES "public"."memberships"("company_id","user_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "commission_statement_returns_statement_idx" ON "commission_statement_returns" USING btree ("company_id","business_id","statement_id");--> statement-breakpoint
CREATE INDEX "commission_statement_returns_membership_idx" ON "commission_statement_returns" USING btree ("company_id","returned_by","returned_membership_id");--> statement-breakpoint
-- إرجاعات الكشوف للإضافة والقراءة بس (FR-031): ما فيش UPDATE ولا DELETE ولا منح لدور تاني ولا لـ PUBLIC.
ALTER TABLE commission_statement_returns ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE commission_statement_returns FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY commission_statement_returns_select ON commission_statement_returns FOR SELECT TO pospay_app USING (company_id = app_company_id());
--> statement-breakpoint
CREATE POLICY commission_statement_returns_insert ON commission_statement_returns FOR INSERT TO pospay_app WITH CHECK (company_id = app_company_id());
--> statement-breakpoint
REVOKE ALL ON commission_statement_returns FROM PUBLIC, pospay_app, pospay_auth, pospay_dispatcher, pospay_notifications;
--> statement-breakpoint
GRANT SELECT, INSERT ON commission_statement_returns TO pospay_app;