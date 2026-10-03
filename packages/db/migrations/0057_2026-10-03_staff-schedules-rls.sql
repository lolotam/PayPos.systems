ALTER TABLE staff_schedules ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE staff_schedules FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY staff_schedules_select ON staff_schedules FOR SELECT TO pospay_app USING (company_id=app_company_id());
--> statement-breakpoint
CREATE POLICY staff_schedules_insert ON staff_schedules FOR INSERT TO pospay_app WITH CHECK (company_id=app_company_id());
--> statement-breakpoint
ALTER TABLE staff_schedule_shifts ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE staff_schedule_shifts FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY staff_schedule_shifts_select ON staff_schedule_shifts FOR SELECT TO pospay_app USING (company_id=app_company_id());
--> statement-breakpoint
CREATE POLICY staff_schedule_shifts_insert ON staff_schedule_shifts FOR INSERT TO pospay_app WITH CHECK (company_id=app_company_id());
--> statement-breakpoint
ALTER TABLE staff_shift_templates ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE staff_shift_templates FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY staff_shift_templates_select ON staff_shift_templates FOR SELECT TO pospay_app USING (company_id=app_company_id());
--> statement-breakpoint
CREATE POLICY staff_shift_templates_insert ON staff_shift_templates FOR INSERT TO pospay_app WITH CHECK (company_id=app_company_id());
--> statement-breakpoint
CREATE POLICY staff_schedules_update ON staff_schedules FOR UPDATE TO pospay_app USING (company_id=app_company_id()) WITH CHECK (company_id=app_company_id());
--> statement-breakpoint
CREATE POLICY staff_shift_templates_update ON staff_shift_templates FOR UPDATE TO pospay_app USING (company_id=app_company_id()) WITH CHECK (company_id=app_company_id());
--> statement-breakpoint
CREATE POLICY staff_schedule_shifts_delete ON staff_schedule_shifts FOR DELETE TO pospay_app USING (company_id=app_company_id());
--> statement-breakpoint
GRANT SELECT, INSERT ON staff_schedules, staff_shift_templates TO pospay_app;
--> statement-breakpoint
GRANT UPDATE (timezone, revision) ON staff_schedules TO pospay_app;
--> statement-breakpoint
GRANT UPDATE (name_en, name_ar, shifts, revision, archived_at) ON staff_shift_templates TO pospay_app;
--> statement-breakpoint
GRANT SELECT, INSERT, DELETE ON staff_schedule_shifts TO pospay_app;
--> statement-breakpoint
-- الموظف لا يعمل في فرعين في نفس اللحظة؛ btree_gist موجود منذ ADR-0021.
ALTER TABLE staff_schedule_shifts ADD CONSTRAINT staff_schedule_shifts_no_overlap EXCLUDE USING gist
(company_id WITH =, employee_id WITH =, tstzrange(starts_at, ends_at, '[)') WITH &&);
--> statement-breakpoint
INSERT INTO permissions(code) VALUES ('read:schedules:branch'),('manage:schedules:branch'),('read:schedules:business'),('manage:schedules:business') ON CONFLICT DO NOTHING;
--> statement-breakpoint
INSERT INTO role_permissions(role_id,role_owner_key,company_id,permission_code)
SELECT r.id,'global',NULL,p.code FROM roles r CROSS JOIN permissions p
WHERE r.company_id IS NULL AND
((r.code IN ('owner','general_manager','business_manager','branch_manager') AND p.code IN ('read:schedules:branch','manage:schedules:branch'))
OR (r.code IN ('owner','general_manager','business_manager') AND p.code IN ('read:schedules:business','manage:schedules:business')))
ON CONFLICT DO NOTHING;
