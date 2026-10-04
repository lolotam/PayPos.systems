-- هوية عامة: الاعتماد وحده يقرأ المادة المشفرة؛ ربط الموظف تحت RLS.
REVOKE ALL ON passkey FROM PUBLIC, pospay_app, pospay_auth, pospay_dispatcher, pospay_notifications;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON passkey TO pospay_auth;
--> statement-breakpoint
ALTER TABLE employee_passkeys ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE employee_passkeys FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY employee_passkeys_select ON employee_passkeys FOR SELECT TO pospay_app USING (company_id=app_company_id());
--> statement-breakpoint
CREATE POLICY employee_passkeys_insert ON employee_passkeys FOR INSERT TO pospay_app WITH CHECK (company_id=app_company_id());
--> statement-breakpoint
CREATE POLICY employee_passkeys_update ON employee_passkeys FOR UPDATE TO pospay_app USING (company_id=app_company_id()) WITH CHECK (company_id=app_company_id());
--> statement-breakpoint
REVOKE ALL ON employee_passkeys FROM PUBLIC, pospay_app, pospay_auth, pospay_dispatcher, pospay_notifications;
--> statement-breakpoint
GRANT SELECT, INSERT ON employee_passkeys TO pospay_app;
--> statement-breakpoint
GRANT UPDATE(unbound_at,unbound_by,revision) ON employee_passkeys TO pospay_app;
--> statement-breakpoint
ALTER TABLE session DROP CONSTRAINT session_staff_scope;
--> statement-breakpoint
ALTER TABLE session ADD CONSTRAINT session_staff_scope CHECK (
  (purpose IS NULL AND staff_device_context IS NULL AND staff_personal_context IS NULL
    AND staff_authenticated_at IS NULL AND staff_absolute_deadline IS NULL)
  OR (purpose='STAFF_POS' AND staff_personal_context IS NULL AND staff_device_context IS NOT NULL
    AND staff_authenticated_at IS NOT NULL AND staff_absolute_deadline=staff_authenticated_at+interval '8 hours'
    AND expires_at=staff_absolute_deadline AND jsonb_typeof(staff_device_context)='object'
    AND staff_device_context ?& ARRAY['companyId','businessId','branchId','deviceId']
    AND staff_device_context - ARRAY['companyId','businessId','branchId','deviceId']='{}'::jsonb)
  OR (purpose='STAFF_PERSONAL' AND staff_device_context IS NULL AND staff_personal_context IS NOT NULL
    AND staff_authenticated_at IS NOT NULL AND staff_absolute_deadline>staff_authenticated_at
    AND expires_at=staff_absolute_deadline AND jsonb_typeof(staff_personal_context)='object'
    AND staff_personal_context ?& ARRAY['purpose','companyId','businessId']
    AND staff_personal_context - ARRAY['purpose','companyId','businessId']='{}'::jsonb
    AND staff_personal_context->>'purpose'='STAFF_PERSONAL'
    AND (staff_personal_context->>'companyId') ~ '^[a-f0-9-]{36}$'
    AND (staff_personal_context->>'businessId') ~ '^[a-f0-9-]{36}$'));
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.enforce_staff_session() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
  IF NEW.purpose IS DISTINCT FROM OLD.purpose OR NEW.user_id IS DISTINCT FROM OLD.user_id
    OR NEW.staff_device_context IS DISTINCT FROM OLD.staff_device_context
    OR NEW.staff_personal_context IS DISTINCT FROM OLD.staff_personal_context
    OR NEW.staff_authenticated_at IS DISTINCT FROM OLD.staff_authenticated_at
    OR NEW.staff_absolute_deadline IS DISTINCT FROM OLD.staff_absolute_deadline
    OR (OLD.purpose IN ('STAFF_POS','STAFF_PERSONAL') AND NEW.expires_at IS DISTINCT FROM OLD.expires_at)
  THEN RAISE EXCEPTION 'STAFF_SESSION_IMMUTABLE'; END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.invalidate_staff_phone_binding() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
  IF NEW.phone_number IS DISTINCT FROM OLD.phone_number THEN
    NEW.phone_number_verified:=false; NEW.phone_binding_approved_at:=NULL;
    UPDATE public.auth_otp_challenges SET status='SUPERSEDED',code_mac=NULL,finished_at=clock_timestamp(),updated_at=clock_timestamp()
      WHERE user_id=OLD.id AND status='ACTIVE';
    DELETE FROM public.session WHERE user_id=OLD.id AND purpose IN ('STAFF_POS','STAFF_PERSONAL');
  END IF;
  RETURN NEW;
END $$;
