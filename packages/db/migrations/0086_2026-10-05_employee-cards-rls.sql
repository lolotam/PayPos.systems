-- Custom SQL migration file, put your code below! --
ALTER TABLE employee_cards ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE employee_cards FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY employee_cards_select ON employee_cards FOR SELECT TO pospay_app USING (company_id=app_company_id());
--> statement-breakpoint
CREATE POLICY employee_cards_insert ON employee_cards FOR INSERT TO pospay_app WITH CHECK (company_id=app_company_id());
--> statement-breakpoint
CREATE POLICY employee_cards_update ON employee_cards FOR UPDATE TO pospay_app USING (company_id=app_company_id()) WITH CHECK (company_id=app_company_id());
--> statement-breakpoint
REVOKE ALL ON employee_cards FROM PUBLIC, pospay_app, pospay_auth, pospay_dispatcher, pospay_notifications;
--> statement-breakpoint
GRANT SELECT, INSERT ON employee_cards TO pospay_app;
--> statement-breakpoint
GRANT UPDATE(revoked_at,revoked_by) ON employee_cards TO pospay_app;
--> statement-breakpoint
INSERT INTO permissions(code) VALUES ('clock:attendance:branch') ON CONFLICT DO NOTHING;
--> statement-breakpoint
INSERT INTO role_permissions(role_id,role_owner_key,company_id,permission_code)
SELECT id,'global',NULL,'clock:attendance:branch' FROM roles
WHERE company_id IS NULL AND code IN ('owner','general_manager','business_manager','branch_manager','shift_supervisor','cashier')
ON CONFLICT DO NOTHING;
--> statement-breakpoint
INSERT INTO role_permissions(role_id,role_owner_key,company_id,permission_code)
SELECT id,'global',NULL,'login:staff:branch' FROM roles WHERE company_id IS NULL AND code='cashier'
ON CONFLICT DO NOTHING;
