-- رأس البند ولقطة أنصبته لا يظهران ولا يتغيران إلا داخل شركة المعاملة الحالية.
ALTER TABLE commission_line_heads ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE commission_line_heads FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY commission_line_heads_select ON commission_line_heads FOR SELECT TO pospay_app
  USING (company_id = app_company_id());
--> statement-breakpoint
CREATE POLICY commission_line_heads_insert ON commission_line_heads FOR INSERT TO pospay_app
  WITH CHECK (company_id = app_company_id());
--> statement-breakpoint
CREATE POLICY commission_line_heads_update ON commission_line_heads FOR UPDATE TO pospay_app
  USING (company_id = app_company_id()) WITH CHECK (company_id = app_company_id());
--> statement-breakpoint
REVOKE ALL ON commission_line_heads FROM PUBLIC, pospay_app, pospay_auth, pospay_dispatcher, pospay_notifications;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON commission_line_heads TO pospay_app;
--> statement-breakpoint
ALTER TABLE commission_lines ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE commission_lines FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY commission_lines_select ON commission_lines FOR SELECT TO pospay_app
  USING (company_id = app_company_id());
--> statement-breakpoint
CREATE POLICY commission_lines_insert ON commission_lines FOR INSERT TO pospay_app
  WITH CHECK (company_id = app_company_id());
--> statement-breakpoint
CREATE POLICY commission_lines_update ON commission_lines FOR UPDATE TO pospay_app
  USING (company_id = app_company_id()) WITH CHECK (company_id = app_company_id());
--> statement-breakpoint
CREATE POLICY commission_lines_delete ON commission_lines FOR DELETE TO pospay_app
  USING (company_id = app_company_id());
--> statement-breakpoint
REVOKE ALL ON commission_lines FROM PUBLIC, pospay_app, pospay_auth, pospay_dispatcher, pospay_notifications;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON commission_lines TO pospay_app;
