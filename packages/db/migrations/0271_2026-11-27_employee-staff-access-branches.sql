-- جدول employee_staff_access صغير (سجل واحد لكل موظفة كحد أقصى) والجدول الفرعي employee_staff_access_branches جديد وفارغ، فتُبنى القيود الفريدة والفهارس في نفس المعاملة بدون CONCURRENTLY.
ALTER TABLE "employee_staff_access" ADD CONSTRAINT "employee_staff_access_identity_key" UNIQUE("company_id","id","business_id","employee_id");--> statement-breakpoint
CREATE TABLE "employee_staff_access_branches" (
	"company_id" uuid NOT NULL,
	"id" uuid NOT NULL,
	"business_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"access_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"role_code" text NOT NULL,
	"membership_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "employee_staff_access_branches_pkey" PRIMARY KEY("company_id","id"),
	CONSTRAINT "employee_staff_access_branches_access_branch_key" UNIQUE("company_id","access_id","branch_id"),
	CONSTRAINT "employee_staff_access_branches_role_code" CHECK ("employee_staff_access_branches"."role_code" IN ('staff', 'reception'))
);
--> statement-breakpoint
ALTER TABLE "employee_staff_access_branches" ADD CONSTRAINT "employee_staff_access_branches_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_staff_access_branches" ADD CONSTRAINT "employee_staff_access_branches_access_fk" FOREIGN KEY ("company_id","access_id","business_id","employee_id") REFERENCES "public"."employee_staff_access"("company_id","id","business_id","employee_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_staff_access_branches" ADD CONSTRAINT "employee_staff_access_branches_employee_fk" FOREIGN KEY ("company_id","business_id","employee_id") REFERENCES "public"."employees"("company_id","business_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_staff_access_branches" ADD CONSTRAINT "employee_staff_access_branches_branch_fk" FOREIGN KEY ("company_id","business_id","branch_id") REFERENCES "public"."branches"("company_id","business_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_staff_access_branches" ADD CONSTRAINT "employee_staff_access_branches_membership_fk" FOREIGN KEY ("company_id","membership_id") REFERENCES "public"."memberships"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "employee_staff_access_branches_employee_idx" ON "employee_staff_access_branches" USING btree ("company_id","employee_id");--> statement-breakpoint
CREATE INDEX "employee_staff_access_branches_branch_idx" ON "employee_staff_access_branches" USING btree ("company_id","business_id","branch_id");--> statement-breakpoint
CREATE UNIQUE INDEX "employee_staff_access_branches_membership_uidx" ON "employee_staff_access_branches" USING btree ("company_id","membership_id") WHERE "employee_staff_access_branches"."membership_id" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "employee_staff_access_branches" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "employee_staff_access_branches" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "employee_staff_access_branches_select" ON "employee_staff_access_branches" FOR SELECT TO pospay_app USING (company_id = app_company_id());
--> statement-breakpoint
CREATE POLICY "employee_staff_access_branches_insert" ON "employee_staff_access_branches" FOR INSERT TO pospay_app WITH CHECK (company_id = app_company_id());
--> statement-breakpoint
CREATE POLICY "employee_staff_access_branches_update" ON "employee_staff_access_branches" FOR UPDATE TO pospay_app USING (company_id = app_company_id()) WITH CHECK (company_id = app_company_id());
--> statement-breakpoint
CREATE POLICY "employee_staff_access_branches_delete" ON "employee_staff_access_branches" FOR DELETE TO pospay_app USING (company_id = app_company_id());
--> statement-breakpoint
REVOKE ALL ON "employee_staff_access_branches" FROM PUBLIC, pospay_app, pospay_auth, pospay_dispatcher, pospay_notifications;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "employee_staff_access_branches" TO pospay_app;
