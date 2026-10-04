CREATE INDEX CONCURRENTLY "leave_requests_company_revoked_by_idx" ON "leave_requests" USING btree ("company_id","revoked_by");--> statement-breakpoint
CREATE INDEX CONCURRENTLY "leave_requests_company_business_branch_dates_idx" ON "leave_requests" USING btree ("company_id","business_id","branch_id","from","to","id");--> statement-breakpoint
GRANT UPDATE (decided_by,decided_at,rejection_reason,decision_reason,revoked_by,revoked_at,revocation_reason) ON leave_requests TO pospay_app;
--> statement-breakpoint
INSERT INTO permissions(code) VALUES ('decide:leave:branch'),('revoke:leave:branch') ON CONFLICT DO NOTHING;
--> statement-breakpoint
INSERT INTO role_permissions(role_id,role_owner_key,company_id,permission_code)
SELECT r.id,'global',NULL,p.code FROM roles r CROSS JOIN permissions p
WHERE r.company_id IS NULL AND r.code IN ('owner','general_manager','business_manager','branch_manager')
AND p.code IN ('decide:leave:branch','revoke:leave:branch') ON CONFLICT DO NOTHING;
