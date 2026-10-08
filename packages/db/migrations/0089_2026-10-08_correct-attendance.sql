CREATE TABLE "attendance_corrections" (
	"company_id" uuid NOT NULL,
	"id" uuid NOT NULL,
	"business_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"request_id" uuid NOT NULL,
	"field" text NOT NULL,
	"before_at" timestamp with time zone NOT NULL,
	"after_at" timestamp with time zone NOT NULL,
	"reason" text NOT NULL,
	"corrected_by" uuid NOT NULL,
	"corrected_at" timestamp with time zone NOT NULL,
	CONSTRAINT "attendance_corrections_company_id_id_pk" PRIMARY KEY("company_id","id"),
	CONSTRAINT "attendance_corrections_field" CHECK ("attendance_corrections"."field" IN ('CLOCK_IN','CLOCK_OUT')),
	CONSTRAINT "attendance_corrections_changed" CHECK ("attendance_corrections"."before_at" <> "attendance_corrections"."after_at"),
	CONSTRAINT "attendance_corrections_reason_bounds" CHECK ("attendance_corrections"."reason" = btrim("attendance_corrections"."reason") AND char_length("attendance_corrections"."reason") BETWEEN 1 AND 500)
);
--> statement-breakpoint
ALTER TABLE "attendance_sessions" ADD COLUMN "revision" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "attendance_corrections" ADD CONSTRAINT "attendance_corrections_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_corrections" ADD CONSTRAINT "attendance_corrections_corrected_by_user_id_fk" FOREIGN KEY ("corrected_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_corrections" ADD CONSTRAINT "attendance_corrections_company_id_session_id_attendance_sessions_company_id_id_fk" FOREIGN KEY ("company_id","session_id") REFERENCES "public"."attendance_sessions"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_corrections" ADD CONSTRAINT "attendance_corrections_company_id_business_id_employee_id_employees_company_id_business_id_id_fk" FOREIGN KEY ("company_id","business_id","employee_id") REFERENCES "public"."employees"("company_id","business_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_corrections" ADD CONSTRAINT "attendance_corrections_company_id_business_id_branch_id_branches_company_id_business_id_id_fk" FOREIGN KEY ("company_id","business_id","branch_id") REFERENCES "public"."branches"("company_id","business_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "attendance_corrections_session_idx" ON "attendance_corrections" USING btree ("company_id","session_id","corrected_at");--> statement-breakpoint
CREATE INDEX "attendance_corrections_board_idx" ON "attendance_corrections" USING btree ("company_id","business_id","branch_id","corrected_at");--> statement-breakpoint
CREATE INDEX "attendance_corrections_employee_idx" ON "attendance_corrections" USING btree ("company_id","employee_id","corrected_at");--> statement-breakpoint
CREATE INDEX "attendance_corrections_actor_idx" ON "attendance_corrections" USING btree ("company_id","corrected_by");--> statement-breakpoint
ALTER TABLE "attendance_sessions" ADD CONSTRAINT "attendance_sessions_revision" CHECK ("attendance_sessions"."revision" >= 0);
--> statement-breakpoint
ALTER TABLE attendance_corrections ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE attendance_corrections FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY attendance_corrections_select ON attendance_corrections FOR SELECT TO pospay_app USING (company_id=app_company_id());
--> statement-breakpoint
CREATE POLICY attendance_corrections_insert ON attendance_corrections FOR INSERT TO pospay_app WITH CHECK (company_id=app_company_id());
--> statement-breakpoint
REVOKE ALL ON attendance_corrections FROM PUBLIC, pospay_app, pospay_auth, pospay_dispatcher, pospay_notifications;
--> statement-breakpoint
GRANT SELECT, INSERT ON attendance_corrections TO pospay_app;
--> statement-breakpoint
INSERT INTO permissions(code) VALUES ('correct:attendance:branch') ON CONFLICT DO NOTHING;
--> statement-breakpoint
INSERT INTO role_permissions(role_id,role_owner_key,company_id,permission_code)
SELECT r.id,'global',NULL,p.code FROM roles r CROSS JOIN permissions p
WHERE r.company_id IS NULL AND r.code IN ('owner','general_manager','business_manager','branch_manager')
AND p.code = 'correct:attendance:branch' ON CONFLICT DO NOTHING;