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
