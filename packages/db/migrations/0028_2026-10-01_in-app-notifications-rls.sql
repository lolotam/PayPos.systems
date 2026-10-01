ALTER TABLE in_app_notifications ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE in_app_notifications FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY in_app_notifications_select ON in_app_notifications FOR SELECT TO pospay_app
  USING (company_id = app_company_id());
--> statement-breakpoint
CREATE POLICY in_app_notifications_insert ON in_app_notifications FOR INSERT TO pospay_app
  WITH CHECK (company_id = app_company_id());
--> statement-breakpoint
CREATE POLICY in_app_notifications_update ON in_app_notifications FOR UPDATE TO pospay_app
  USING (company_id = app_company_id()) WITH CHECK (company_id = app_company_id());
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON in_app_notifications TO pospay_app;
--> statement-breakpoint
CREATE FUNCTION in_app_notifications_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF (NEW.company_id, NEW.id, NEW.recipient_user_id, NEW.business_id, NEW.branch_id,
        NEW.source_event_id, NEW.template_key, NEW.template_revision, NEW.locale, NEW.safe_parameters, NEW.created_at)
       IS DISTINCT FROM
       (OLD.company_id, OLD.id, OLD.recipient_user_id, OLD.business_id, OLD.branch_id,
        OLD.source_event_id, OLD.template_key, OLD.template_revision, OLD.locale, OLD.safe_parameters, OLD.created_at)
       OR (OLD.read_at IS NOT NULL AND NEW.read_at IS DISTINCT FROM OLD.read_at) THEN
      RAISE EXCEPTION 'in-app notification identity and read time are immutable' USING ERRCODE = '23514';
    END IF;
  END IF;
  IF NEW.branch_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM branches WHERE company_id = NEW.company_id AND id = NEW.branch_id AND business_id = NEW.business_id
  ) THEN
    RAISE EXCEPTION 'in-app notification scope refused' USING ERRCODE = '23503';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION in_app_notifications_guard() FROM PUBLIC;
--> statement-breakpoint
CREATE TRIGGER in_app_notifications_guard BEFORE INSERT OR UPDATE ON in_app_notifications
  FOR EACH ROW EXECUTE FUNCTION in_app_notifications_guard();
