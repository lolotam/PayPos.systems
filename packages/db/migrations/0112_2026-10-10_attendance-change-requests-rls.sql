ALTER TABLE attendance_change_requests ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE attendance_change_requests FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY attendance_change_requests_tenant ON attendance_change_requests FOR ALL TO pospay_app
USING (company_id=app_company_id()) WITH CHECK (company_id=app_company_id());
--> statement-breakpoint
REVOKE ALL ON attendance_change_requests FROM PUBLIC, pospay_app, pospay_auth, pospay_dispatcher, pospay_notifications;
--> statement-breakpoint
GRANT SELECT, INSERT ON attendance_change_requests TO pospay_app;
--> statement-breakpoint
GRANT UPDATE(status, decided_by, decided_at, decision_reason, cancelled_by, cancelled_at, session_id, revision)
ON attendance_change_requests TO pospay_app;
--> statement-breakpoint
INSERT INTO permissions(code) VALUES ('request:attendance-change:branch') ON CONFLICT DO NOTHING;
--> statement-breakpoint
INSERT INTO role_permissions(role_id,role_owner_key,company_id,permission_code)
SELECT r.id,'global',NULL,p.code FROM roles r CROSS JOIN permissions p
WHERE r.company_id IS NULL AND r.code IN ('owner','general_manager','business_manager','branch_manager')
AND p.code = 'request:attendance-change:branch' ON CONFLICT DO NOTHING;
