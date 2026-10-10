CREATE INDEX CONCURRENTLY "employee_passkeys_active_installation_idx" ON "employee_passkeys" USING btree ("company_id","installation_hash") WHERE "unbound_at" IS NULL AND "installation_hash" IS NOT NULL;
--> statement-breakpoint
ALTER TABLE attendance_device_refusals ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE attendance_device_refusals FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY attendance_device_refusals_select ON attendance_device_refusals FOR SELECT TO pospay_app USING (company_id=app_company_id());
--> statement-breakpoint
CREATE POLICY attendance_device_refusals_insert ON attendance_device_refusals FOR INSERT TO pospay_app WITH CHECK (company_id=app_company_id());
--> statement-breakpoint
REVOKE ALL ON attendance_device_refusals FROM PUBLIC, pospay_app, pospay_auth, pospay_dispatcher, pospay_notifications;
--> statement-breakpoint
GRANT SELECT, INSERT ON attendance_device_refusals TO pospay_app;
--> statement-breakpoint
GRANT UPDATE (installation_hash) ON employee_passkeys TO pospay_app;
--> statement-breakpoint
CREATE FUNCTION enforce_passkey_installation_set_once() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.installation_hash IS NOT NULL AND NEW.installation_hash IS DISTINCT FROM OLD.installation_hash THEN
    RAISE EXCEPTION 'employee_passkeys installation_hash is immutable once set' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER employee_passkeys_installation_set_once BEFORE UPDATE OF installation_hash ON employee_passkeys
FOR EACH ROW EXECUTE FUNCTION enforce_passkey_installation_set_once();
