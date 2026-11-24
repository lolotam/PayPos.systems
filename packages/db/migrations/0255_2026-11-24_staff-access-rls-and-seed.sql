-- spec 076 F1 (سجل إعطاء الدخول): RLS إجباري على employee_staff_access بمنح pospay_app وحده،
-- وبذرة صلاحية إعطاء الدخول للمالك ومدير الفرع (قرار D3). كل الأوامر expand only وتكرار آمن،
-- ولا دور تشغيلي جديد ولا BYPASSRLS — منح pospay_auth على جدول المستخدم العامة من 0008 تغطي
-- الأعمدة الجديدة بدون أي منح إضافي، وpospay_dispatcher لا يرى الجدول أبداً.
ALTER TABLE employee_staff_access ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE employee_staff_access FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY employee_staff_access_select ON employee_staff_access FOR SELECT TO pospay_app USING (company_id = app_company_id());
--> statement-breakpoint
CREATE POLICY employee_staff_access_insert ON employee_staff_access FOR INSERT TO pospay_app WITH CHECK (company_id = app_company_id());
--> statement-breakpoint
CREATE POLICY employee_staff_access_update ON employee_staff_access FOR UPDATE TO pospay_app USING (company_id = app_company_id()) WITH CHECK (company_id = app_company_id());
--> statement-breakpoint
CREATE POLICY employee_staff_access_delete ON employee_staff_access FOR DELETE TO pospay_app USING (company_id = app_company_id());
--> statement-breakpoint
REVOKE ALL ON employee_staff_access FROM PUBLIC, pospay_app, pospay_auth, pospay_dispatcher, pospay_notifications;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON employee_staff_access TO pospay_app;
--> statement-breakpoint
INSERT INTO permissions(code) VALUES ('manage:staff-access:branch') ON CONFLICT DO NOTHING;
--> statement-breakpoint
INSERT INTO role_permissions(role_id, role_owner_key, company_id, permission_code)
SELECT r.id, 'global', NULL, 'manage:staff-access:branch' FROM roles r
WHERE r.company_id IS NULL AND r.code IN ('owner', 'branch_manager')
ON CONFLICT DO NOTHING;
