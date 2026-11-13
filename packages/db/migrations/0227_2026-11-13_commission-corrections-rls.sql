-- الفهارس بتتبني بالتوازي عشان ما تقفلش الكتابة أثناء بنائها، ولازم تكون أول الملف لأن الـ runner
-- بينفّذ بادئة الفهارس خارج الـ transaction بس؛ الـ migration المولّد للجداول لازم ما يكرّرش السطور دي.
CREATE INDEX CONCURRENTLY "commission_period_generations_employee_idx" ON "commission_period_generations" USING btree ("company_id","business_id","employee_id");--> statement-breakpoint
CREATE INDEX CONCURRENTLY "commission_corrections_target_period_idx" ON "commission_corrections" USING btree ("company_id","business_id","target_period");--> statement-breakpoint
CREATE INDEX CONCURRENTLY "commission_corrections_target_statement_idx" ON "commission_corrections" USING btree ("company_id","business_id","target_period","target_statement_id");--> statement-breakpoint
CREATE INDEX CONCURRENTLY "commission_corrections_employee_idx" ON "commission_corrections" USING btree ("company_id","business_id","employee_id");--> statement-breakpoint
CREATE INDEX CONCURRENTLY "commission_corrections_source_branch_idx" ON "commission_corrections" USING btree ("company_id","business_id","source_branch_id");--> statement-breakpoint
CREATE INDEX CONCURRENTLY "commission_corrections_attached_branches_idx" ON "commission_corrections" USING gin ("attached_branch_ids");--> statement-breakpoint
ALTER TABLE commission_period_generations ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE commission_period_generations FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY commission_period_generations_select ON commission_period_generations FOR SELECT TO pospay_app USING (company_id = app_company_id());
--> statement-breakpoint
CREATE POLICY commission_period_generations_insert ON commission_period_generations FOR INSERT TO pospay_app WITH CHECK (company_id = app_company_id());
--> statement-breakpoint
CREATE POLICY commission_period_generations_update ON commission_period_generations FOR UPDATE TO pospay_app USING (company_id = app_company_id()) WITH CHECK (company_id = app_company_id());
--> statement-breakpoint
REVOKE ALL ON commission_period_generations FROM PUBLIC, pospay_app, pospay_auth, pospay_dispatcher, pospay_notifications;
--> statement-breakpoint
GRANT SELECT, INSERT ON commission_period_generations TO pospay_app;
--> statement-breakpoint
ALTER TABLE commission_corrections ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE commission_corrections FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY commission_corrections_select ON commission_corrections FOR SELECT TO pospay_app USING (company_id = app_company_id());
--> statement-breakpoint
CREATE POLICY commission_corrections_insert ON commission_corrections FOR INSERT TO pospay_app WITH CHECK (company_id = app_company_id());
--> statement-breakpoint
REVOKE ALL ON commission_corrections FROM PUBLIC, pospay_app, pospay_auth, pospay_dispatcher, pospay_notifications;
--> statement-breakpoint
GRANT SELECT, INSERT ON commission_corrections TO pospay_app;
--> statement-breakpoint
GRANT UPDATE (generation) ON commission_period_generations TO pospay_app;
