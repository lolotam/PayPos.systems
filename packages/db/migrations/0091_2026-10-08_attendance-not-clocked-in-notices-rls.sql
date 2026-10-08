-- Custom SQL migration file, put your code below! --
ALTER TABLE attendance_not_clocked_in_notices ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE attendance_not_clocked_in_notices FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY attendance_not_clocked_in_notices_select ON attendance_not_clocked_in_notices FOR SELECT TO pospay_app USING (company_id = app_company_id());
--> statement-breakpoint
CREATE POLICY attendance_not_clocked_in_notices_insert ON attendance_not_clocked_in_notices FOR INSERT TO pospay_app WITH CHECK (company_id = app_company_id());
--> statement-breakpoint
-- دفتر مرة واحدة: يُدرج ولا يُعدّل ولا يُحذف.
GRANT SELECT, INSERT ON attendance_not_clocked_in_notices TO pospay_app;
