ALTER TABLE staff_schedule_settings ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE staff_schedule_settings FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY staff_schedule_settings_select ON staff_schedule_settings FOR SELECT TO pospay_app USING (company_id = app_company_id());
--> statement-breakpoint
CREATE POLICY staff_schedule_settings_insert ON staff_schedule_settings FOR INSERT TO pospay_app WITH CHECK (company_id = app_company_id());
--> statement-breakpoint
CREATE POLICY staff_schedule_settings_update ON staff_schedule_settings FOR UPDATE TO pospay_app USING (company_id = app_company_id()) WITH CHECK (company_id = app_company_id());
--> statement-breakpoint
GRANT SELECT, INSERT ON staff_schedule_settings TO pospay_app;
--> statement-breakpoint
GRANT UPDATE (max_shifts_per_day, updated_by, updated_at) ON staff_schedule_settings TO pospay_app;
