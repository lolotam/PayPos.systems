-- Custom SQL migration file, put your code below! --
-- القفل يوقف إدراج الموظفين حتى يكتمل backfill وتركيب trigger في نفس المعاملة.
LOCK TABLE employees IN SHARE ROW EXCLUSIVE MODE;
--> statement-breakpoint
ALTER TABLE attendance_states ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE attendance_states FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY attendance_states_tenant ON attendance_states TO pospay_app USING (company_id=app_company_id()) WITH CHECK (company_id=app_company_id());
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON attendance_states TO pospay_app;
--> statement-breakpoint
ALTER TABLE attendance_sessions ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE attendance_sessions FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY attendance_sessions_tenant ON attendance_sessions TO pospay_app USING (company_id=app_company_id()) WITH CHECK (company_id=app_company_id());
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON attendance_sessions TO pospay_app;
--> statement-breakpoint
ALTER TABLE attendance_exceptions ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE attendance_exceptions FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY attendance_exceptions_tenant ON attendance_exceptions TO pospay_app USING (company_id=app_company_id()) WITH CHECK (company_id=app_company_id());
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON attendance_exceptions TO pospay_app;
--> statement-breakpoint
ALTER TABLE attendance_clock_challenges ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE attendance_clock_challenges FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY attendance_clock_challenges_select ON attendance_clock_challenges FOR SELECT TO pospay_app USING (company_id=app_company_id());
--> statement-breakpoint
CREATE POLICY attendance_clock_challenges_insert ON attendance_clock_challenges FOR INSERT TO pospay_app WITH CHECK (company_id=app_company_id());
--> statement-breakpoint
GRANT SELECT, INSERT ON attendance_clock_challenges TO pospay_app;
--> statement-breakpoint
INSERT INTO attendance_states(company_id,id,business_id,employee_id) SELECT company_id,id,business_id,id FROM employees;
--> statement-breakpoint
CREATE FUNCTION initialize_attendance_state() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public AS $$
BEGIN
  INSERT INTO public.attendance_states(company_id,id,business_id,employee_id)
  VALUES(NEW.company_id,NEW.id,NEW.business_id,NEW.id);
  RETURN NEW;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION initialize_attendance_state() FROM PUBLIC;
--> statement-breakpoint
CREATE TRIGGER employee_attendance_state AFTER INSERT ON employees FOR EACH ROW EXECUTE FUNCTION initialize_attendance_state();
--> statement-breakpoint
ALTER TABLE attendance_sessions ADD CONSTRAINT attendance_sessions_location_pair CHECK ((latitude IS NULL)=(longitude IS NULL) AND (latitude IS NULL)=(accuracy IS NULL));
--> statement-breakpoint
ALTER TABLE attendance_sessions ADD CONSTRAINT attendance_sessions_out_location_pair CHECK ((out_latitude IS NULL)=(out_longitude IS NULL) AND (out_latitude IS NULL)=(out_accuracy IS NULL));
--> statement-breakpoint
ALTER TABLE attendance_sessions ADD CONSTRAINT attendance_sessions_closed_fields CHECK ((status='OPEN')=(clock_out IS NULL) AND (status='OPEN')=(closed_by IS NULL));
