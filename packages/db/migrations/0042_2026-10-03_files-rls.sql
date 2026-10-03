ALTER TABLE file_objects ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE file_objects FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY file_objects_select ON file_objects FOR SELECT TO pospay_app USING (company_id = app_company_id());
--> statement-breakpoint
CREATE POLICY file_objects_insert ON file_objects FOR INSERT TO pospay_app WITH CHECK (company_id = app_company_id());
--> statement-breakpoint
CREATE POLICY file_objects_update ON file_objects FOR UPDATE TO pospay_app USING (company_id = app_company_id()) WITH CHECK (company_id = app_company_id());
--> statement-breakpoint
GRANT SELECT, INSERT ON file_objects TO pospay_app;
--> statement-breakpoint
GRANT UPDATE (status, lease_id, lease_until, storage_key, content_type, size_bytes, rejection_code) ON file_objects TO pospay_app;
--> statement-breakpoint
ALTER TABLE file_access_audit ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE file_access_audit FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY file_access_audit_select ON file_access_audit FOR SELECT TO pospay_app USING (company_id = app_company_id());
--> statement-breakpoint
CREATE POLICY file_access_audit_insert ON file_access_audit FOR INSERT TO pospay_app WITH CHECK (company_id = app_company_id() AND actor_user_id = app_user_id());
--> statement-breakpoint
GRANT SELECT, INSERT ON file_access_audit TO pospay_app;
--> statement-breakpoint
INSERT INTO permissions (code) VALUES ('manage:files:business'), ('read:files:business') ON CONFLICT DO NOTHING;
