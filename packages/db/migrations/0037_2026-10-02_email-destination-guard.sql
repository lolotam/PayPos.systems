-- الوجهة البريدية تتبع نفس منع إعادة التعبئة؛ بقية الهوية والسياج يحميهما الحارس الموجود.
CREATE FUNCTION notification_email_destination_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF NEW.recipient_email IS DISTINCT FROM OLD.recipient_email AND NEW.recipient_email IS NOT NULL THEN
    RAISE EXCEPTION 'notification email destination cannot be repopulated' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION notification_email_destination_guard() FROM PUBLIC;
--> statement-breakpoint
CREATE TRIGGER notification_email_destination_guard BEFORE UPDATE ON notification_attempts
  FOR EACH ROW EXECUTE FUNCTION notification_email_destination_guard();
