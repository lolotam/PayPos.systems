-- ترقية الصفوف المنشورة القديمة أيضاً؛ موعد الإنشاء بعد إصدار PUT، والمهلة 120 ثانية.
INSERT INTO file_cleanup_objects(company_id,id,file_id,object_key,kind,expiry_at,cleanup_after)
SELECT company_id,id,id,staging_key,'STAGING',created_at + interval '121 seconds',CURRENT_TIMESTAMP
FROM file_objects WHERE status = 'READY' ON CONFLICT DO NOTHING;
--> statement-breakpoint
ALTER TABLE file_cleanup_objects ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE file_cleanup_objects FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY file_cleanup_objects_select ON file_cleanup_objects FOR SELECT TO pospay_app USING (company_id = app_company_id());
--> statement-breakpoint
CREATE POLICY file_cleanup_objects_insert ON file_cleanup_objects FOR INSERT TO pospay_app WITH CHECK (company_id = app_company_id());
--> statement-breakpoint
CREATE POLICY file_cleanup_objects_update ON file_cleanup_objects FOR UPDATE TO pospay_app USING (company_id = app_company_id()) WITH CHECK (company_id = app_company_id());
--> statement-breakpoint
GRANT SELECT, INSERT ON file_cleanup_objects TO pospay_app;
--> statement-breakpoint
GRANT UPDATE (state,cleaned_at,cleanup_after,lease_id,lease_until) ON file_cleanup_objects TO pospay_app;
