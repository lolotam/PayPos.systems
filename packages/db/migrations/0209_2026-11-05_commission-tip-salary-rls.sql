CREATE INDEX CONCURRENTLY "commission_salaries_employee_idx" ON "commission_salaries" USING btree ("company_id","business_id","employee_id","effective_from");--> statement-breakpoint
CREATE INDEX CONCURRENTLY "commission_tip_heads_branch_idx" ON "commission_tip_heads" USING btree ("company_id","business_id","branch_id");--> statement-breakpoint
CREATE INDEX CONCURRENTLY "commission_tip_heads_period_idx" ON "commission_tip_heads" USING btree ("company_id","business_id","period","session_id");--> statement-breakpoint
CREATE INDEX CONCURRENTLY "commission_tips_head_idx" ON "commission_tips" USING btree ("company_id","business_id","session_id");--> statement-breakpoint
CREATE INDEX CONCURRENTLY "commission_tips_employee_idx" ON "commission_tips" USING btree ("company_id","business_id","employee_id");
--> statement-breakpoint
ALTER TABLE commission_tip_heads ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE commission_tip_heads FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY commission_tip_heads_select ON commission_tip_heads FOR SELECT TO pospay_app USING (company_id = app_company_id());
--> statement-breakpoint
CREATE POLICY commission_tip_heads_insert ON commission_tip_heads FOR INSERT TO pospay_app WITH CHECK (company_id = app_company_id());
--> statement-breakpoint
CREATE POLICY commission_tip_heads_update ON commission_tip_heads FOR UPDATE TO pospay_app USING (company_id = app_company_id()) WITH CHECK (company_id = app_company_id());
--> statement-breakpoint
REVOKE ALL ON commission_tip_heads FROM PUBLIC, pospay_app, pospay_auth, pospay_dispatcher, pospay_notifications;
--> statement-breakpoint
GRANT SELECT, INSERT ON commission_tip_heads TO pospay_app;
--> statement-breakpoint
ALTER TABLE commission_tips ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE commission_tips FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY commission_tips_select ON commission_tips FOR SELECT TO pospay_app USING (company_id = app_company_id());
--> statement-breakpoint
CREATE POLICY commission_tips_insert ON commission_tips FOR INSERT TO pospay_app WITH CHECK (company_id = app_company_id());
--> statement-breakpoint
CREATE POLICY commission_tips_delete ON commission_tips FOR DELETE TO pospay_app USING (company_id = app_company_id());
--> statement-breakpoint
REVOKE ALL ON commission_tips FROM PUBLIC, pospay_app, pospay_auth, pospay_dispatcher, pospay_notifications;
--> statement-breakpoint
GRANT SELECT, INSERT, DELETE ON commission_tips TO pospay_app;
--> statement-breakpoint
ALTER TABLE commission_salaries ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE commission_salaries FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY commission_salaries_select ON commission_salaries FOR SELECT TO pospay_app USING (company_id = app_company_id());
--> statement-breakpoint
CREATE POLICY commission_salaries_insert ON commission_salaries FOR INSERT TO pospay_app WITH CHECK (company_id = app_company_id());
--> statement-breakpoint
CREATE POLICY commission_salaries_update ON commission_salaries FOR UPDATE TO pospay_app USING (company_id = app_company_id()) WITH CHECK (company_id = app_company_id());
--> statement-breakpoint
REVOKE ALL ON commission_salaries FROM PUBLIC, pospay_app, pospay_auth, pospay_dispatcher, pospay_notifications;
--> statement-breakpoint
GRANT SELECT, INSERT ON commission_salaries TO pospay_app;
--> statement-breakpoint
GRANT UPDATE (revision, branch_id, business_date, period) ON commission_tip_heads TO pospay_app;
--> statement-breakpoint
GRANT UPDATE (amount, revision) ON commission_salaries TO pospay_app;
