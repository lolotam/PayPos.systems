-- Custom SQL migration file, put your code below! --
ALTER TABLE leave_requests ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE leave_requests FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY leave_requests_select ON leave_requests FOR SELECT TO pospay_app USING(company_id=app_company_id());
--> statement-breakpoint
CREATE POLICY leave_requests_insert ON leave_requests FOR INSERT TO pospay_app WITH CHECK(company_id=app_company_id());
--> statement-breakpoint
CREATE POLICY leave_requests_update ON leave_requests FOR UPDATE TO pospay_app USING(company_id=app_company_id()) WITH CHECK(company_id=app_company_id());
--> statement-breakpoint
GRANT SELECT, INSERT ON leave_requests TO pospay_app;
--> statement-breakpoint
GRANT UPDATE(status, cancelled_by, cancelled_at, revision) ON leave_requests TO pospay_app;
--> statement-breakpoint
-- القيد يحمي التداخل حتى لو كاتب آخر لم يأخذ قفل الموظف في التطبيق.
ALTER TABLE leave_requests ADD CONSTRAINT leave_requests_no_overlap EXCLUDE USING gist
(company_id WITH =, employee_id WITH =, tstzrange(starts_at,ends_at,'[)') WITH &&)
WHERE (status IN ('PENDING','APPROVED'));
