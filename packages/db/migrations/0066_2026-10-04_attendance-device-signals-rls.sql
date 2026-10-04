ALTER TABLE attendance_device_signals ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE attendance_device_signals FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY attendance_device_signals_select ON attendance_device_signals FOR SELECT TO pospay_app USING (company_id=app_company_id());
--> statement-breakpoint
CREATE POLICY attendance_device_signals_insert ON attendance_device_signals FOR INSERT TO pospay_app WITH CHECK (company_id=app_company_id());
--> statement-breakpoint
REVOKE ALL ON attendance_device_signals FROM PUBLIC, pospay_app, pospay_auth, pospay_dispatcher, pospay_notifications;
--> statement-breakpoint
GRANT SELECT, INSERT ON attendance_device_signals TO pospay_app;
