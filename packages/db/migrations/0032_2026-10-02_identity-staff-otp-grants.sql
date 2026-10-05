-- Custom SQL migration file, put your code below! --
REVOKE ALL ON public.auth_otp_challenges, public.auth_notification_attempts FROM PUBLIC, pospay_app, pospay_auth, pospay_dispatcher, pospay_notifications;
--> statement-breakpoint
GRANT SELECT, DELETE ON public.auth_otp_challenges, public.auth_notification_attempts TO pospay_auth;
--> statement-breakpoint
GRANT INSERT(id,recipient_hash,hash_key_id,user_id,device_context,code_mac,derivation_key_id,verification_key_id,status,failed_attempts,created_at,expires_at,consumed_at,finished_at,updated_at),
UPDATE(status,failed_attempts,code_mac,consumed_at,finished_at,updated_at) ON public.auth_otp_challenges TO pospay_auth;
--> statement-breakpoint
GRANT INSERT(id,challenge_id,recipient_hash,hash_key_id,user_id,channel,template_key,template_revision,locale,provider_template_name,status,authorized_at,send_deadline,preparation_deadline,execution_id,sending_at,finished_at,failure_code,outcome_known,provider_message_digest,created_at,updated_at),
UPDATE(status,authorized_at,execution_id,sending_at,finished_at,failure_code,outcome_known,provider_message_digest,updated_at) ON public.auth_notification_attempts TO pospay_auth;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.platform_whatsapp_is_suppressed(bytea) TO pospay_auth;
--> statement-breakpoint
CREATE FUNCTION public.enforce_staff_otp_challenge() RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog AS $$
BEGIN
  IF NEW.user_id IS NULL AND OLD.user_id IS NOT NULL THEN
    IF NEW.status = 'ACTIVE' THEN
      NEW.status := 'EXPIRED'; NEW.code_mac := NULL; NEW.finished_at := clock_timestamp(); NEW.updated_at := NEW.finished_at;
    END IF;
  ELSIF NEW.user_id IS DISTINCT FROM OLD.user_id THEN
    RAISE EXCEPTION 'OTP_IMMUTABLE';
  END IF;
  IF (to_jsonb(NEW) - ARRAY['status','failed_attempts','code_mac','consumed_at','finished_at','updated_at','user_id'])
      IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['status','failed_attempts','code_mac','consumed_at','finished_at','updated_at','user_id'])
    OR (OLD.status <> 'ACTIVE' AND NEW.status <> OLD.status)
    OR NEW.failed_attempts < OLD.failed_attempts OR NEW.failed_attempts > OLD.failed_attempts + 1
    OR (NEW.code_mac IS NOT NULL AND NEW.code_mac IS DISTINCT FROM OLD.code_mac)
    OR (OLD.finished_at IS NOT NULL AND NEW.finished_at IS DISTINCT FROM OLD.finished_at)
    OR (OLD.consumed_at IS NOT NULL AND NEW.consumed_at IS DISTINCT FROM OLD.consumed_at)
  THEN RAISE EXCEPTION 'OTP_IMMUTABLE'; END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.enforce_staff_otp_challenge() FROM PUBLIC;
--> statement-breakpoint
CREATE TRIGGER auth_otp_challenges_immutable BEFORE UPDATE ON public.auth_otp_challenges FOR EACH ROW EXECUTE FUNCTION public.enforce_staff_otp_challenge();
--> statement-breakpoint
CREATE FUNCTION public.enforce_staff_otp_attempt() RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog AS $$
BEGIN
  IF NEW.user_id IS DISTINCT FROM OLD.user_id AND NEW.user_id IS NOT NULL THEN RAISE EXCEPTION 'OTP_IMMUTABLE'; END IF;
  IF (to_jsonb(NEW) - ARRAY['status','authorized_at','execution_id','sending_at','finished_at','failure_code','outcome_known','provider_message_digest','updated_at','user_id'])
      IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['status','authorized_at','execution_id','sending_at','finished_at','failure_code','outcome_known','provider_message_digest','updated_at','user_id'])
    OR NOT (NEW.status = OLD.status
      OR (OLD.status = 'PREPARED' AND NEW.status IN ('PENDING','FAILED','EXPIRED','SUPPRESSED'))
      OR (OLD.status = 'PENDING' AND NEW.status IN ('SENDING','FAILED','EXPIRED'))
      OR (OLD.status = 'SENDING' AND NEW.status IN ('SENT','FAILED','EXPIRED')))
    OR (OLD.authorized_at IS NOT NULL AND NEW.authorized_at IS DISTINCT FROM OLD.authorized_at)
    OR (OLD.execution_id IS NOT NULL AND NEW.execution_id IS DISTINCT FROM OLD.execution_id)
    OR (OLD.sending_at IS NOT NULL AND NEW.sending_at IS DISTINCT FROM OLD.sending_at)
    OR (OLD.finished_at IS NOT NULL AND to_jsonb(NEW) - 'user_id' IS DISTINCT FROM to_jsonb(OLD) - 'user_id')
    OR (NEW.status = 'PENDING' AND OLD.status = 'PREPARED' AND clock_timestamp() >= NEW.preparation_deadline)
  THEN RAISE EXCEPTION 'OTP_IMMUTABLE'; END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.enforce_staff_otp_attempt() FROM PUBLIC;
--> statement-breakpoint
CREATE TRIGGER auth_notification_attempts_immutable BEFORE UPDATE ON public.auth_notification_attempts FOR EACH ROW EXECUTE FUNCTION public.enforce_staff_otp_attempt();
--> statement-breakpoint
ALTER TABLE public.auth_notification_attempts ADD CONSTRAINT auth_notification_attempts_failure CHECK(failure_code IS NULL OR failure_code IN ('PROVIDER_ACCEPTED','PROVIDER_REJECTED','PROVIDER_UNKNOWN','ADMISSION_REFUSED','DESTINATION_INVALID','CHALLENGE_INVALID','CONFIG_INVALID','PREPARATION_FAILED','PREPARATION_WINDOW_ENDED'));
--> statement-breakpoint
ALTER TABLE public.session ADD CONSTRAINT session_staff_scope CHECK(
  (purpose IS NULL AND staff_device_context IS NULL AND staff_authenticated_at IS NULL AND staff_absolute_deadline IS NULL)
  OR (purpose = 'STAFF_POS' AND staff_device_context IS NOT NULL AND staff_authenticated_at IS NOT NULL
    AND staff_absolute_deadline = staff_authenticated_at + interval '8 hours' AND expires_at = staff_absolute_deadline
    AND jsonb_typeof(staff_device_context) = 'object'
    AND staff_device_context ?& ARRAY['companyId','businessId','branchId','deviceId']
    AND staff_device_context - ARRAY['companyId','businessId','branchId','deviceId'] = '{}'::jsonb));
--> statement-breakpoint
CREATE FUNCTION public.enforce_staff_session() RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog AS $$
BEGIN
  IF NEW.purpose IS DISTINCT FROM OLD.purpose OR NEW.staff_device_context IS DISTINCT FROM OLD.staff_device_context
    OR NEW.staff_authenticated_at IS DISTINCT FROM OLD.staff_authenticated_at
    OR NEW.staff_absolute_deadline IS DISTINCT FROM OLD.staff_absolute_deadline
    OR (OLD.purpose = 'STAFF_POS' AND NEW.expires_at IS DISTINCT FROM OLD.expires_at)
  THEN RAISE EXCEPTION 'STAFF_SESSION_IMMUTABLE'; END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.enforce_staff_session() FROM PUBLIC;
--> statement-breakpoint
CREATE TRIGGER session_staff_immutable BEFORE UPDATE ON public.session FOR EACH ROW EXECUTE FUNCTION public.enforce_staff_session();
--> statement-breakpoint
CREATE INDEX session_staff_device_idx ON public.session((staff_device_context->>'deviceId')) WHERE purpose = 'STAFF_POS';
--> statement-breakpoint
CREATE FUNCTION public.invalidate_staff_phone_binding() RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog AS $$
BEGIN
  IF NEW.phone_number IS DISTINCT FROM OLD.phone_number THEN
    NEW.phone_number_verified := false; NEW.phone_binding_approved_at := NULL;
    UPDATE public.auth_otp_challenges SET status='SUPERSEDED',code_mac=NULL,finished_at=clock_timestamp(),updated_at=clock_timestamp()
      WHERE user_id=OLD.id AND status='ACTIVE';
    DELETE FROM public.session WHERE user_id=OLD.id AND purpose='STAFF_POS';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.invalidate_staff_phone_binding() FROM PUBLIC;
--> statement-breakpoint
CREATE TRIGGER user_staff_phone_binding BEFORE UPDATE ON public."user" FOR EACH ROW EXECUTE FUNCTION public.invalidate_staff_phone_binding();
