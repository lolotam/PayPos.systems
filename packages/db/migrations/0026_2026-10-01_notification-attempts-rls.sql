-- Custom SQL migration file, put your code below! --
-- Rebuild generated indexes concurrently before exposing the fresh ledger to runtime roles.
-- DROP/CREATE are restartable even after a partial concurrent build or a failed transactional suffix.
DROP INDEX CONCURRENTLY IF EXISTS notification_attempts_business_idx;
--> statement-breakpoint
DROP INDEX CONCURRENTLY IF EXISTS notification_attempts_branch_idx;
--> statement-breakpoint
DROP INDEX CONCURRENTLY IF EXISTS notification_attempts_log_idx;
--> statement-breakpoint
DROP INDEX CONCURRENTLY IF EXISTS notification_attempts_status_idx;
--> statement-breakpoint
CREATE INDEX CONCURRENTLY notification_attempts_business_idx ON notification_attempts (company_id, business_id);
--> statement-breakpoint
CREATE INDEX CONCURRENTLY notification_attempts_branch_idx ON notification_attempts (company_id, branch_id);
--> statement-breakpoint
CREATE INDEX CONCURRENTLY notification_attempts_log_idx ON notification_attempts (company_id, created_at DESC NULLS LAST, id DESC NULLS LAST);
--> statement-breakpoint
CREATE INDEX CONCURRENTLY notification_attempts_status_idx ON notification_attempts (company_id, status, created_at, id);
--> statement-breakpoint
ALTER TABLE notification_attempts ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE notification_attempts FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY notification_attempts_select ON notification_attempts FOR SELECT TO pospay_app
  USING (company_id = app_company_id());
--> statement-breakpoint
CREATE POLICY notification_attempts_insert ON notification_attempts FOR INSERT TO pospay_app
  WITH CHECK (company_id = app_company_id());
--> statement-breakpoint
CREATE POLICY notification_attempts_update ON notification_attempts FOR UPDATE TO pospay_app
  USING (company_id = app_company_id()) WITH CHECK (company_id = app_company_id());
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON notification_attempts TO pospay_app;
--> statement-breakpoint
CREATE FUNCTION notification_attempts_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF (NEW.company_id, NEW.id, NEW.source_event_id, NEW.business_id, NEW.branch_id, NEW.channel,
        NEW.template_key, NEW.template_revision, NEW.locale, NEW.provider_template_name,
        NEW.recipient_hash, NEW.hash_key_id, NEW.phone_last3, NEW.safe_parameters, NEW.authorized_at,
        NEW.send_deadline, NEW.created_at)
       IS DISTINCT FROM
       (OLD.company_id, OLD.id, OLD.source_event_id, OLD.business_id, OLD.branch_id, OLD.channel,
        OLD.template_key, OLD.template_revision, OLD.locale, OLD.provider_template_name,
        OLD.recipient_hash, OLD.hash_key_id, OLD.phone_last3, OLD.safe_parameters, OLD.authorized_at,
        OLD.send_deadline, OLD.created_at) THEN
      RAISE EXCEPTION 'notification identity is immutable' USING ERRCODE = '23514';
    END IF;
    IF OLD.status IN ('SENT','FAILED','EXPIRED','SUPPRESSED') AND NEW IS DISTINCT FROM OLD THEN
      RAISE EXCEPTION 'notification terminal state is immutable' USING ERRCODE = '23514';
    END IF;
    IF NEW.status <> OLD.status AND NOT (
      (OLD.status = 'PENDING' AND NEW.status IN ('SENDING','FAILED','EXPIRED')) OR
      (OLD.status = 'SENDING' AND NEW.status IN ('SENT','FAILED','EXPIRED'))
    ) THEN
      RAISE EXCEPTION 'notification transition refused' USING ERRCODE = '23514';
    END IF;
    IF OLD.status = 'SENDING' AND (NEW.execution_id, NEW.sending_at) IS DISTINCT FROM (OLD.execution_id, OLD.sending_at) THEN
      RAISE EXCEPTION 'notification execution is immutable' USING ERRCODE = '23514';
    END IF;
    IF NEW.recipient_phone IS DISTINCT FROM OLD.recipient_phone AND NEW.recipient_phone IS NOT NULL THEN
      RAISE EXCEPTION 'notification destination cannot be repopulated' USING ERRCODE = '23514';
    END IF;
  ELSIF NEW.status NOT IN ('PENDING','FAILED','EXPIRED','SUPPRESSED') THEN
    RAISE EXCEPTION 'notification initial state refused' USING ERRCODE = '23514';
  END IF;
  IF NEW.branch_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM branches WHERE company_id = NEW.company_id AND id = NEW.branch_id AND business_id = NEW.business_id
  ) THEN
    RAISE EXCEPTION 'notification scope refused' USING ERRCODE = '23503';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION notification_attempts_guard() FROM PUBLIC;
--> statement-breakpoint
CREATE TRIGGER notification_attempts_guard BEFORE INSERT OR UPDATE ON notification_attempts
  FOR EACH ROW EXECUTE FUNCTION notification_attempts_guard();
--> statement-breakpoint
INSERT INTO permissions (code) VALUES ('view:notifications:business') ON CONFLICT DO NOTHING;
--> statement-breakpoint
INSERT INTO role_permissions (role_id, role_owner_key, company_id, permission_code)
  SELECT id, 'global', NULL, 'view:notifications:business' FROM roles
  WHERE company_id IS NULL AND code IN ('owner','general_manager','business_manager','branch_manager')
  ON CONFLICT DO NOTHING;
